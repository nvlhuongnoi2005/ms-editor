"""Validate library integrity. --update intentionally refreshes the checksum lock."""
import argparse
import hashlib
import json
import struct
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--update', action='store_true')
parser.add_argument('--sync-sql', action='store_true', help='Copy canonical tile SQL into the backend go:embed input')
args = parser.parse_args()
canonical_sql = root / 'runtime/tile.sql'
backend_sql = root.parent / 'editor-api/internal/enc/tile.sql'
if args.sync_sql:
    backend_sql.write_bytes(canonical_sql.read_bytes())
assert canonical_sql.read_bytes() == backend_sql.read_bytes(), 'Backend SQL differs from canonical runtime/tile.sql; inspect then --sync-sql'
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf8'))
files = sorted(p for folder in ('documents', 'assets') for p in (root / folder).rglob('*') if p.is_file())
checksums = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
lock = root / 'checksums.json'
if args.update:
    lock.write_text(json.dumps(checksums, indent=2) + '\n', encoding='utf8')
expected = json.loads(lock.read_text(encoding='utf8'))
assert checksums == expected, 'Assets/documents changed: inspect sources, then deliberately use --update'
for document in manifest['documents']:
    assert checksums[document['file']] == document['sha256'], document['file']
keys = None
for theme in manifest['assets']['themes']:
    folder = root / 'assets/sprites'
    data = json.loads((folder / f'{theme}_simplified@2x.json').read_text(encoding='utf8'))
    png = (folder / f'{theme}_simplified@2x.png').read_bytes()
    assert png[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('>II', png[16:24])
    assert len(data) == manifest['assets']['imagesPerTheme']
    if keys is None:
        keys = set(data)
    assert set(data) == keys, f'{theme}: inconsistent symbol keys'
    for name, rect in data.items():
        assert rect['pixelRatio'] == 2, name
        assert rect['x'] >= 0 and rect['y'] >= 0, name
        assert rect['width'] > 0 and rect['height'] > 0, name
        assert rect['x'] + rect['width'] <= width and rect['y'] + rect['height'] <= height, name
for module in ('style.ts', 'sprites.ts', 'infrastructure.ts', 'lightSectors.ts', 'spriteSpecs.generated.ts', 'symbolCatalog.ts', 'profile.ts', 'palettes.json'):
    assert (root / 'runtime' / module).is_file(), module
assert manifest['status'] == 'partial' or all(manifest['verification'].values()), 'Cannot claim complete with missing verification'
print(f'OK: {len(files)} files; {len(keys)} images/theme; all 3 atlases and document hashes valid.')
print('Conformance:', manifest['status'], '- outstanding:', ', '.join(item['id'] for item in manifest['missing']))
