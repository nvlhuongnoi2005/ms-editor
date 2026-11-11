"""Check the actual tile boundary subdivision with large polygons and lines.

Uses temporary fixtures inside a rolled-back transaction; canonical ENC is unchanged.
Run: python ENC/tools/check_line_mesh_db.py
"""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
tile = (root / 'editor-api/internal/enc/tile.sql').read_text(encoding='utf8')
line_query = tile.split('), line_features AS (', 1)[1].split('), symbol_features AS (', 1)[0]
sql = """
BEGIN;
CREATE TEMP TABLE features AS
WITH ring AS (
 SELECT ST_MakeLine(ST_MakePoint(
   2000 + (1000 + (i%2)*100) * cos(2*pi()*i/18000),
   2000 + (1000 + (i%2)*100) * sin(2*pi()*i/18000)) ORDER BY i) AS geom
 FROM generate_series(0,17999) AS i
), polygon AS (
 SELECT ST_MakePolygon(ST_AddPoint(geom,ST_StartPoint(geom)),
   ARRAY[ST_GeomFromText('LINESTRING(1900 1900,1900 2100,2100 2100,2100 1900,1900 1900)')]) AS geom FROM ring
)
SELECT fixture.id AS feature_id,'fixture'::text AS cell_name,
 CASE fixture.id WHEN 'polygon' THEN 'LNDARE' ELSE 'COALNE' END AS object_class,
 jsonb_build_object('s52_geometry',ST_Dimension(fixture.geom),'s52_display_category','BASE') AS attributes,
 'fixture-revision'::text AS revision_id,'fixture'::text AS producer,
 20000 AS compilation_scale,4 AS intended_usage,'scale_match'::text AS cell_selection,
 ''::text AS colour_code,fixture.geom
FROM polygon CROSS JOIN LATERAL (VALUES
 ('polygon',polygon.geom),('line',ST_ExteriorRing(polygon.geom))) AS fixture(id,geom);
"""
sql += 'WITH line_features AS (' + line_query + """
)
SELECT jsonb_agg(jsonb_build_object(
 'id',f.feature_id,'sourcePoints',ST_NPoints(f.geom),'sourceDimension',ST_Dimension(f.geom),
 'parts',parts.n,'maxPoints',parts.max_points,'lineOnly',parts.line_only,
 'sameProperties',parts.same_properties,
 'shapeError',ST_HausdorffDistance(expected.geom,parts.geom),
 'lengthError',abs(ST_Length(expected.geom)-ST_Length(parts.geom))
))
FROM features f CROSS JOIN LATERAL (
 SELECT CASE WHEN ST_Dimension(f.geom)=2 THEN ST_Boundary(f.geom) ELSE f.geom END AS geom
) expected CROSS JOIN LATERAL (
 SELECT count(*) AS n,max(ST_NPoints(l.geom)) AS max_points,
 bool_and(ST_Dimension(l.geom)=1) AS line_only,bool_and(l.attributes=f.attributes AND l.revision_id=f.revision_id) AS same_properties,
 ST_UnaryUnion(ST_Collect(l.geom)) AS geom FROM line_features l WHERE l.feature_id=f.feature_id
) parts;
ROLLBACK;
"""
result = subprocess.run(['docker','exec','-i','map-service-postgres-1','psql','-U','enc_owner','-d','enc_canonical',
                         '-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
if result.returncode:
    raise RuntimeError(result.stderr)
rows = json.loads(result.stdout.strip())
assert len(rows) == 2, rows
for row in rows:
    assert row['sourcePoints'] > 18000, row
    assert row['parts'] > 1 and row['maxPoints'] <= 6000, row
    assert row['lineOnly'] and row['sameProperties'], row
    assert row['shapeError'] < 1e-6 and row['lengthError'] < 1e-6, row
assert next(row for row in rows if row['id']=='polygon')['sourceDimension'] == 2
print(json.dumps(rows,indent=2))
print('Passed: bounded line paths, original fills, holes, no internal subdivision outlines, stable feature properties. Rolled back.')
