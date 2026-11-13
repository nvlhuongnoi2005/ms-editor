"""Read-only PostGIS check of the actual tile LOD allowlist and SQL preparation."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
tile = (root / 'Presentation_Library/runtime/tile.sql').read_text(encoding='utf8')
profile = tile.split('-- RENDER_LOD_PROFILE:', 1)[1].split('-- END_RENDER_LOD_PROFILE', 1)[0]
profile = profile[profile.index('SELECT CASE'):].replace('$1', 'z')
sql = 'PREPARE tile_lod(int,int,int,text,text,float8,float8,text) AS ' + tile + ';\n'
sql += """
WITH fixtures AS (
 SELECT ST_Transform(ST_SetSRID(ST_MakeLine(ST_MakePoint(i,20*sin(i::float/7)) ORDER BY i),3857),4326) AS line,
 ST_Transform(ST_Buffer(ST_SetSRID(ST_Point(2000,2000),3857),1000,1024),4326) AS area
 FROM generate_series(0,4000) i
), inputs AS (
 SELECT z,cls.object_class,CASE WHEN cls.object_class IN ('BUAARE','VEGATN','LNDARE','DEPARE') THEN fixtures.area
 WHEN cls.object_class IN ('SOUNDG','LIGHTS','UWTROC') THEN ST_SetSRID(ST_Point(0,0),4326) ELSE fixtures.line END AS geometry
 FROM fixtures CROSS JOIN (VALUES (9),(12),(16)) zoom(z)
 CROSS JOIN (VALUES ('ROADWY'),('RAILWY'),('LNDELV'),('BUAARE'),('VEGATN'),('LNDARE'),('DEPARE'),('COALNE'),('DEPCNT'),('DRGARE'),('WRECKS'),('SOUNDG'),('LIGHTS'),('UWTROC'),('RESARE'),('CANALS')) cls(object_class)
), result AS (
 SELECT z,f.object_class,reduction.tolerance,ST_Transform(f.geometry,3857) AS original,
 CASE WHEN tolerance>0 THEN ST_SimplifyPreserveTopology(ST_Transform(ST_MakeValid(f.geometry),3857),tolerance)
 ELSE ST_Transform(f.geometry,3857) END AS reduced
 FROM inputs f CROSS JOIN LATERAL (SELECT 40075016.68557849/power(2.0,z)/512 AS pixel_size) v
 CROSS JOIN LATERAL (
""" + profile + """
 ) reduction
)
SELECT jsonb_agg(jsonb_build_object('z',z,'class',object_class,'tolerance',tolerance,
 'before',ST_NPoints(original),'after',ST_NPoints(reduced),'valid',ST_IsValid(reduced),
 'error',ST_HausdorffDistance(original,reduced),'exact',ST_OrderingEquals(original,reduced))) FROM result;
"""
result = subprocess.run(['docker','exec','-i','map-service-postgres-1','psql','-U','enc_owner','-d','enc_canonical','-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
if result.returncode:
    raise RuntimeError(result.stderr)
rows = json.loads(result.stdout.strip())
assert len(rows) == 48
for row in rows:
    assert row['valid'], row
    if row['tolerance'] == 0:
        assert row['exact'], row
    else:
        assert row['after'] < row['before'], row
        assert row['error'] <= row['tolerance'] + 1e-5, row
for z in (9,12,16):
    selected = [r for r in rows if r['z']==z]
    print(json.dumps({'zoom':z,'verticesBefore':sum(r['before'] for r in selected),'verticesAfter':sum(r['after'] for r in selected),'unchangedClasses':sum(r['exact'] for r in selected)}))
print('PASS: tile SQL prepares; 48 class/zoom cases preserve protected geometry and bound simplification error. Synthetic vertex counts are not a production speed benchmark.')
