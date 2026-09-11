import unittest
from crawl import crawl_host, discover, validate

ABC = 'X:1\nT:First\nK:D\nABcd|\n'


class CrawlTests(unittest.TestCase):
    def test_follows_same_host_pages_and_collects_abc_links_only(self):
        pages = {
            'https://example.org/index.html': '<a href="tunes/list.html">tunes</a>'
                                               '<a href="https://other.org/x.abc">external</a>',
            'https://example.org/tunes/list.html': '<a href="/tunes/one.abc">one</a>'
                                                     '<a href="/tunes/two.abc">two</a>',
        }
        candidates, visited, errors = crawl_host(
            'https://example.org/index.html', loader=lambda url: pages[url].encode())
        self.assertEqual({'https://example.org/tunes/one.abc', 'https://example.org/tunes/two.abc'}, candidates)
        self.assertEqual(set(pages), visited)
        self.assertEqual([], errors)

    def test_respects_robots_disallow(self):
        def loader(url):
            if url.endswith('/robots.txt'):
                return b'User-agent: *\nDisallow: /private/\n'
            if url == 'https://example.org/index.html':
                return b'<a href="/private/list.html">hidden</a><a href="/public.html">shown</a>'
            if url == 'https://example.org/public.html':
                return b'<a href="/public/one.abc">one</a>'
            raise AssertionError(f'unexpected fetch of disallowed or unknown url: {url}')
        candidates, _visited, errors = crawl_host('https://example.org/index.html', loader=loader)
        self.assertEqual({'https://example.org/public/one.abc'}, candidates)
        self.assertTrue(any('robots.txt disallows' in e for e in errors))

    def test_validate_accepts_real_abc_and_rejects_html(self):
        good = validate('https://example.org/one.abc', {'id': 'test', 'name': 'Test'}, loader=lambda _: ABC.encode())
        self.assertTrue(good['ok'])
        self.assertEqual(1, good['tune_count'])
        self.assertEqual(['First'], good['sample_titles'])

        bad = validate('https://example.org/error.abc', {'id': 'test', 'name': 'Test'},
                        loader=lambda _: b'<html>Not found</html>')
        self.assertFalse(bad['ok'])

    def test_discover_aggregates_seed_pages_into_a_report(self):
        pages = {
            'https://example.org/index.html': '<a href="/one.abc">one</a>',
            'https://example.org/one.abc': ABC,
        }
        def loader(url):
            if url.endswith('/robots.txt'):
                raise OSError('no robots.txt')
            return pages[url].encode()
        report = discover(
            {'id': 'example', 'name': 'Example', 'seed_pages': ['https://example.org/index.html']}, loader=loader)
        self.assertEqual(1, report['tune_count'])
        self.assertEqual(['https://example.org/one.abc'], report['files'])
        self.assertEqual(['First'], report['sample_titles'])


if __name__ == '__main__':
    unittest.main()
