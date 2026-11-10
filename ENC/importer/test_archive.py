"""Validation checks run inside the same GDAL image as the importer."""
import tempfile
import unittest
import zipfile
from pathlib import Path

from worker import extract_archive


class ArchiveValidation(unittest.TestCase):
    def extract(self, entries):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source.zip'
            with zipfile.ZipFile(source, 'w') as archive:
                for name in entries:
                    archive.writestr(name, b'fixture')
            return [item.name for item in extract_archive(source, root / 'out')]

    def test_catalog_and_contiguous_updates(self):
        self.assertEqual(self.extract(['ENC_ROOT/CATALOG.031', 'ENC_ROOT/US5TEST1/US5TEST1.000', 'ENC_ROOT/US5TEST1/US5TEST1.001']), ['US5TEST1.000'])

    def test_missing_update(self):
        with self.assertRaisesRegex(ValueError, 'Missing S-57 update'):
            self.extract(['US5TEST1.000', 'US5TEST1.002'])

    def test_update_without_base(self):
        with self.assertRaisesRegex(ValueError, 'without base'):
            self.extract(['US5TEST1.001'])

    def test_unsafe_paths(self):
        for path in ['../escaped', '/absolute', 'C:/drive', '..\\escaped']:
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'unsafe path'):
                self.extract([path])

    def test_duplicate_cell(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate S-57 cell'):
            self.extract(['one/US5TEST1.000', 'two/US5TEST1.000'])


if __name__ == '__main__':
    unittest.main()
