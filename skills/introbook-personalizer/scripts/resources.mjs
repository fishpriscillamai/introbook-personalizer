import fs from 'node:fs/promises';
import path from 'node:path';
import { parse, patches, attrPatch, decode } from './html.mjs';

const MIME = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml', '.avif':'image/avif', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.otf':'font/otf' };
const DATA = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml|avif|x-icon)|font\/(?:woff2?|ttf|otf));base64,([A-Za-z0-9+/]*={0,2})$/;
export async function inside(root, file) {
  const realRoot = await fs.realpath(root), realFile = await fs.realpath(file);
  const rel = path.relative(realRoot, realFile);
  if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw Error('Resource escapes its allowed root');
  return realFile;
}
function checkSvg(svg) {
  if (/<script\b|<foreignObject\b|\bon\w+\s*=/i.test(svg)) throw Error('Active SVG is not supported');
  for (const m of svg.matchAll(/(?:href\s*=\s*["']([^"']+)|url\(\s*["']?([^\s)"']+))/gi)) {
    const ref = m[1] ?? m[2]; if (!ref.startsWith('#') && !ref.startsWith('data:')) throw Error('SVG contains an external dependency');
  }
}
export function validData(uri) {
  const m = DATA.exec(uri); if (!m || !m[2]) throw Error('Unsupported or empty inline resource');
  if (m[1] === 'image/svg+xml') checkSvg(Buffer.from(m[2], 'base64').toString('utf8'));
  return uri;
}
export async function assetUri(file, root) {
  const safe = await inside(root, file), mime = MIME[path.extname(safe).toLowerCase()];
  if (!mime) throw Error(`Unsupported resource type: ${path.extname(safe)}`);
  const data = await fs.readFile(safe); if (!data.length) throw Error('Empty resource');
  return validData(`data:${mime};base64,${data.toString('base64')}`);
}
export function checkScript(code) {
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\b(?:importScripts|sendBeacon)\s*\(|\bimport\s*(?:\(|['"{*])|\bfrom\s*['"]|serviceWorker\s*\./.test(code)) throw Error('Network or module-loading script must be normalized before registration');
}
async function localReference(ref, base, root, type = 'asset') {
  ref = decode(ref).trim();
  if (ref.startsWith('data:')) return validData(ref);
  if (/^(?:[a-z][\w+.-]*:|\/|\\|#)/i.test(ref)) throw Error(`Expected a local relative ${type} resource`);
  const [name, fragment] = ref.split('#');
  const safe = await inside(root, path.resolve(base, decodeURIComponent(name.split('?')[0])));
  if (type !== 'asset') return safe;
  const value = await assetUri(safe, root);
  return fragment ? value + '#' + fragment : value;
}
async function bundleCss(css, base, root) {
  if (/@import\b/i.test(css)) throw Error('Flatten CSS @import before registration');
  const matches = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)], edits = [];
  for (const m of matches) {
    const ref = (m[1] ?? m[2] ?? m[3]).trim();
    const uri = ref.startsWith('#') ? ref : await localReference(ref, base, root);
    edits.push({ start:m.index, end:m.index + m[0].length, value:`url("${uri}")` });
  }
  return patches(css, edits);
}
export async function bundleHtml(input, root = path.dirname(input)) {
  input = await inside(root, input);
  const html = await fs.readFile(input, 'utf8'), { nodes } = parse(html), edits = [], deferred = [];
  const base = path.dirname(input);
  for (const n of nodes) {
    if (['base','iframe','object','embed','audio','video'].includes(n.tag)) throw Error(`Normalize unsupported <${n.tag}> before registration`);
    if (n.attrs.srcset) throw Error('Normalize responsive srcset into one local src before registration');
    if (n.tag === 'link') {
      const rel = (n.attrs.rel ?? '').toLowerCase();
      if (rel === 'stylesheet') {
        const file = await localReference(n.attrs.href, base, root, 'stylesheet');
        const css = await bundleCss(await fs.readFile(file,'utf8'), path.dirname(file), root);
        if (/<\/style/i.test(css)) throw Error('Unexpected closing style tag');
        edits.push({ start:n.start, end:n.end, value:`<style>${css}</style>` }); continue;
      }
      if (['preconnect','dns-prefetch','modulepreload','prefetch','prerender'].includes(rel)) { edits.push({start:n.start,end:n.end,value:''}); continue; }
      if (n.attrs.href) edits.push(attrPatch(n, 'href', await localReference(n.attrs.href, base, root)));
    }
    if (n.tag === 'script') {
      let code = html.slice(n.openEnd,n.closeStart);
      if (n.attrs.src) { const file = await localReference(n.attrs.src,base,root,'script'); code = await fs.readFile(file,'utf8'); }
      if (n.attrs.type === 'module' || n.attrs.async !== undefined) throw Error('Normalize module/async scripts before registration');
      checkScript(code);
      if (n.attrs.src) {
        const script = `<script>${code.replace(/<\/script/gi,'<\\/script')}</script>`;
        if (n.attrs.defer !== undefined) { deferred.push(script); edits.push({start:n.start,end:n.end,value:''}); }
        else edits.push({start:n.start,end:n.end,value:script});
      }
    }
    if (n.tag === 'style') edits.push({start:n.openEnd,end:n.closeStart,value:await bundleCss(html.slice(n.openEnd,n.closeStart),base,root)});
    if (n.attrs.style) edits.push(attrPatch(n,'style',await bundleCss(n.attrs.style,base,root)));
    if (n.attrs.src && n.tag !== 'script') edits.push(attrPatch(n,'src',await localReference(n.attrs.src,base,root)));
    if (['image','use'].includes(n.tag)) for (const key of ['href','xlink:href']) if (n.attrs[key] && !n.attrs[key].startsWith('#')) edits.push(attrPatch(n,key,await localReference(n.attrs[key],base,root)));
  }
  let result = patches(html,edits);
  if (deferred.length) {
    if (!/<\/body>/i.test(result)) throw Error('Deferred scripts require a closing body');
    result = result.replace(/<\/body>/i, () => deferred.join('\n') + '\n</body>');
  }
  assertOffline(result); return result;
}
export function assertOffline(html) {
  const { nodes } = parse(html);
  for (const n of nodes) {
    if (['base','iframe','object','embed','audio','video'].includes(n.tag) || n.attrs.srcset) throw Error('Unsupported external resource mechanism');
    for (const key of ['src','poster',...(n.tag === 'link' ? ['href'] : [])]) if (n.attrs[key]) validData(n.attrs[key]);
    if (n.tag === 'script') { if (n.attrs.src) throw Error('External script'); checkScript(html.slice(n.openEnd,n.closeStart)); }
    if (n.tag === 'a' && n.attrs.href && !/^(?:#|https?:\/\/|mailto:|tel:)/i.test(n.attrs.href)) throw Error('Unsafe/nonportable hyperlink');
    if (['use','image'].includes(n.tag)) for (const key of ['href','xlink:href']) if (n.attrs[key] && !n.attrs[key].startsWith('#')) validData(n.attrs[key]);
    const css = n.tag === 'style' ? html.slice(n.openEnd,n.closeStart) : (n.attrs.style ?? '');
    if (/@import\b/i.test(css)) throw Error('External CSS import');
    for (const m of css.matchAll(/url\(\s*["']?([^\s)"']+)/gi)) if (!m[1].startsWith('#')) validData(m[1].split('#')[0]);
  }
  return true;
}
