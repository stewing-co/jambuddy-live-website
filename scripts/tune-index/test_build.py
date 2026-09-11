import unittest
from build import build, discover, index_abc

SOURCE = {'id': 'test', 'name': 'Test', 'files': ['https://example.org/tunes.abc'], 'max_files': 1}
ABC = '% collection\nM:4/4\nX:1\nT:First\nT:Alias\nK:D\nABcd|\n\nX:1\nT:Second\nK:G\nGABc|\n'


class IndexTests(unittest.TestCase):
    def test_indexes_settings_aliases_and_duplicate_x_numbers_without_scores(self):
        tunes = index_abc(ABC, SOURCE['files'][0], SOURCE)
        self.assertEqual([0, 1], [t['ordinal'] for t in tunes])
        self.assertEqual(['First', 'Alias'], tunes[0]['titles'])
        self.assertNotEqual(tunes[0]['id'], tunes[1]['id'])
        self.assertNotIn('abc', tunes[0])

    def test_discovers_only_real_same_host_abc_links(self):
        html = '<!-- <a href="hidden.abc">hidden</a> --><a href="one.abc">one</a><a href="https://other.org/two.abc">two</a><a href="tunefind">home</a>'
        self.assertEqual(['https://example.org/one.abc'], discover('https://example.org/index', html))

    def test_preserves_last_good_file_during_outage(self):
        previous = build([SOURCE], loader=lambda _: ABC.encode(), pause=lambda _: None)
        def failed(_):
            raise OSError('offline')
        updated = build([SOURCE], previous, loader=failed, pause=lambda _: None)
        self.assertEqual(previous['tunes'], updated['tunes'])
        self.assertTrue(updated['sources'][0]['stale'])

    def test_rejects_html_and_empty_first_build(self):
        with self.assertRaises(ValueError):
            index_abc('<html>home server</html>', SOURCE['files'][0], SOURCE)
        with self.assertRaises(RuntimeError):
            build([SOURCE], loader=lambda _: b'<html>Error</html>', pause=lambda _: None)


if __name__ == '__main__':
    unittest.main()
