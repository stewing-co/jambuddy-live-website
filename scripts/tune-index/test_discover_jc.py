import unittest
from unittest.mock import patch
from discover_jc import listing


class DiscoveryTests(unittest.TestCase):
    def test_uses_collection_api_and_rejects_navigation_as_tunes(self):
        cells = ['1', '<a href="/~jc/music/book/Kerr/MM1.abc">abc</a>'] + ['-'] * 8 + ['208779']
        html = '<a href="MM1/">Volume one</a><a href="/~jc/music/">Parent</a>'
        html += '<!-- <a href="/~jc/music/book/Hidden/">Hidden</a> -->'
        html += '<tr>' + ''.join('<td>' + c + '</td>' for c in cells) + '</tr>'
        with patch('discover_jc.fetch', return_value=html.encode()) as fetch:
            dirs, files = listing('/~jc/music/book/Kerr/')
        fetch.assert_called_once_with('https://trillian.mit.edu/~jc/cgi/abc/coll.cgi/music/book/Kerr/')
        self.assertEqual({'/~jc/music/book/Kerr/MM1/'}, dirs)
        self.assertEqual({'https://trillian.mit.edu/~jc/music/book/Kerr/MM1.abc': 208779}, files)


if __name__ == '__main__':
    unittest.main()
