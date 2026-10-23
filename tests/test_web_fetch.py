import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location('fetch_web_sources', Path(__file__).parents[1] / 'scripts/fetch_web_sources.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FetchTests(unittest.TestCase):
    def setUp(self):
        self.html = b'<html><head><link rel="stylesheet" href="assets/style.css"></head><body><img src="assets/logo.png"><a href="source.pptx">download</a></body></html>'
        self.requests = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                outer.requests.append(self.path)
                if self.path == '/book/redirect.png':
                    self.send_response(302)
                    self.send_header('Location', '/outside.png')
                    self.end_headers()
                    return
                routes = {'/book/': ('text/html', outer.html), '/book/assets/style.css': ('text/css', b'@font-face{font-family:x;src:url(font.woff2)}'), '/book/assets/logo.png': ('image/png', b'test-image'), '/book/assets/font.woff2': ('font/woff2', b'test-font')}
                if self.path not in routes:
                    self.send_error(404)
                    return
                content_type, body = routes[self.path]
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.temp = tempfile.TemporaryDirectory()
        self.url = f'http://127.0.0.1:{self.server.server_port}/book/'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def test_dependency_closure_manifest_and_public_download_discovery(self):
        result = module.archive(self.url, self.temp.name)
        self.assertEqual(result['files'], 4)
        self.assertTrue(result['complete'])
        self.assertEqual(result['publicDownloadLinks'], [self.url + 'source.pptx'])
        self.assertTrue((Path(self.temp.name) / 'assets/font.woff2').exists())
        self.assertNotIn('/book/source.pptx', self.requests)
        with self.assertRaises(FileExistsError):
            module.archive(self.url, self.temp.name)

    def test_refuses_dependency_outside_directory(self):
        self.html = b'<html><img src="../outside.png"></html>'
        with self.assertRaisesRegex(ValueError, 'leaves'):
            module.archive(self.url, self.temp.name)
        self.assertNotIn('/outside.png', self.requests)
        self.assertFalse((Path(self.temp.name) / 'fetch-manifest.json').exists())

    def test_redirect_cannot_escape_source_scope(self):
        self.html = b'<html><img src="redirect.png"></html>'
        with self.assertRaisesRegex(ValueError, 'redirect leaves'):
            module.archive(self.url, self.temp.name)
        self.assertNotIn('/outside.png', self.requests)


if __name__ == '__main__':
    unittest.main()
