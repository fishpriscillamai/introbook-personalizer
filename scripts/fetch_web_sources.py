#!/usr/bin/env python3
"""Archive a public IntroBook and its explicitly referenced same-directory assets."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import urljoin, urlsplit, urlunsplit, unquote, quote
from urllib.request import Request, HTTPRedirectHandler, build_opener

USER_AGENT = 'Mozilla/5.0 (compatible; IntroBookSourceArchive/1.0)'
CSS_URL = re.compile(r'url\(\s*(?:"([^"]+)"|\x27([^\x27]+)\x27|([^)]*?))\s*\)', re.I)
ASSET_STRING = re.compile(r'["\x27]([^"\x27\n]+\.(?:png|jpe?g|svg|webp|gif|avif|woff2?|ttf|otf|css|js)(?:\?[^"\x27]*)?)["\x27]', re.I)


class References(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.resources = []
        self.downloads = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for name, value in attrs.items():
            if not value:
                continue
            if tag == 'a' and name == 'href':
                if re.search(r'\.(?:pptx|ppt|key|zip|pdf)(?:[?#]|$)', value, re.I):
                    self.downloads.append(value)
                continue
            if name in ('src', 'poster', 'xlink:href') or (name == 'href' and tag in ('link', 'image', 'use')) or (name.startswith('data-') and re.match(r'(?:\.?\.?/)?assets/', value)):
                self.resources.append(value)
            if name == 'style':
                self.resources.extend(css_refs(value))

    handle_startendtag = handle_starttag


def css_refs(text):
    return [(a or b or c).strip() for a, b, c in CSS_URL.findall(text)]


def archive(entry_url, output, use_existing=False, workers=6):
    entry = urlsplit(entry_url)
    if entry.scheme != 'https' and not (entry.scheme == 'http' and entry.hostname in ('127.0.0.1', 'localhost')):
        raise ValueError('Public sources require HTTPS')
    if entry.username or entry.password or entry.query or entry.fragment or not entry.path.endswith('/'):
        raise ValueError('Use the public directory URL without credentials/query/fragment')
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    entry_key = urlunsplit((entry.scheme, entry.netloc, entry.path, '', ''))
    seen, files, skipped, downloads = set(), [], [], []

    class ScopedRedirects(HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            target = urlsplit(newurl)
            if (target.scheme, target.netloc) != (entry.scheme, entry.netloc) or not unquote(target.path).startswith(unquote(entry.path)):
                raise ValueError('Asset redirect leaves the authorized source directory')
            return super().redirect_request(request, fp, code, msg, headers, newurl)

    def resolve(ref, base):
        if not ref or ref.startswith(('#', 'data:', 'mailto:', 'tel:', 'javascript:')):
            return None
        absolute = urlsplit(urljoin(base, ref))
        if (absolute.scheme, absolute.netloc) != (entry.scheme, entry.netloc):
            raise ValueError(f'External asset requires explicit normalization: {absolute.netloc}')
        if not unquote(absolute.path).startswith(unquote(entry.path)):
            raise ValueError('Asset leaves the IntroBook directory')
        return urlunsplit((absolute.scheme, absolute.netloc, quote(absolute.path, safe='/%:@-._~'), absolute.query, ''))

    def fetch(url):
        parsed = urlsplit(url)
        relative = unquote(parsed.path[len(entry.path):]) or 'index.html'
        target = (output / relative).resolve()
        target.relative_to(output)
        if parsed.query:
            raise ValueError('Query-dependent assets require an explicit local mapping')
        if target.exists() and not (use_existing and relative == 'index.html'):
            raise FileExistsError(f'Archive is immutable; choose a new output directory: {relative}')
        if target.exists():
            body, content_type = target.read_bytes(), 'text/html'
            meta = {'entryPreviouslyDownloaded': True}
        else:
            with build_opener(ScopedRedirects()).open(Request(url, headers={'User-Agent': USER_AGENT}), timeout=40) as response:
                final = urlsplit(response.url)
                if (final.scheme, final.netloc) != (entry.scheme, entry.netloc):
                    raise ValueError('Asset redirected to a different origin')
                body = response.read()
                content_type = response.headers.get_content_type()
                meta = {k: response.headers[k] for k in ('ETag', 'Last-Modified') if response.headers.get(k)}
            if not body:
                raise ValueError(f'Empty asset: {relative}')
            if content_type == 'text/html' and relative != 'index.html':
                raise ValueError(f'Asset returned an HTML page: {relative}')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
        record = {'url': url, 'path': relative, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest(), 'contentType': content_type, **meta}
        refs = []
        if relative == 'index.html' or target.suffix.lower() == '.svg':
            parser = References()
            text = body.decode('utf-8')
            parser.feed(text)
            refs.extend(parser.resources)
            refs.extend(css_refs(text))
            if relative == 'index.html':
                downloads.extend(urljoin(url, ref) for ref in parser.downloads)
        elif target.suffix.lower() == '.css':
            text = body.decode('utf-8')
            if re.search(r'@import\b', text, re.I):
                raise ValueError('Flatten CSS imports explicitly before using this archive')
            refs.extend(css_refs(text))
        elif target.suffix.lower() == '.js':
            # Browser scripts resolve asset string literals against document.baseURI.
            refs.extend((ref, entry_url) for ref in ASSET_STRING.findall(body.decode('utf-8')) if '/' in ref)
        next_urls = []
        for ref in refs:
            ref, base = ref if isinstance(ref, tuple) else (ref, url)
            resolved = resolve(ref, base)
            if resolved:
                next_urls.append(resolved)
        return record, next_urls

    pending = [entry_key]
    while pending:
        batch = sorted(set(pending) - seen)
        if not batch:
            break
        seen.update(batch)
        pending = []
        with ThreadPoolExecutor(max_workers=workers) as pool:
            jobs = {pool.submit(fetch, url): url for url in batch}
            for future in as_completed(jobs):
                record, refs = future.result()
                files.append(record)
                pending.extend(refs)
    manifest = {'sourceUrl': entry_url, 'fetchedAt': datetime.now(timezone.utc).isoformat(), 'complete': True,
                'files': sorted(files, key=lambda x: x['path']), 'publicDownloadLinks': sorted(set(downloads)), 'skipped': skipped}
    (output / 'fetch-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return {'sourceUrl': entry_url, 'directory': str(output), 'files': len(files), 'bytes': sum(f['bytes'] for f in files), 'publicDownloadLinks': manifest['publicDownloadLinks'], 'complete': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--use-existing-entry', action='store_true')
    args = parser.parse_args()
    print(json.dumps(archive(args.url, args.output, args.use_existing_entry), ensure_ascii=False, indent=2))
