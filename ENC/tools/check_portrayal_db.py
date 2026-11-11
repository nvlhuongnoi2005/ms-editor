"""Exercise the actual tile SQL with disposable PostGIS fixtures.

Run from the repository root: python ENC/tools/check_portrayal_db.py
Optional --container selects the existing development PostGIS container.
Only temporary tables are populated; the transaction is rolled back.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", default="map-service-postgres-1")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    query = (root / "editor-api/internal/enc/tile.sql").read_text(encoding="utf8")
    # Inspect the actual pre-MVT properties to avoid depending on a second MVT decoder.
    query = query[:query.rindex("\nSELECT (SELECT")]
    query += "\nSELECT jsonb_object_agg(feature_id,attributes) FROM raw_features"
    tables = ("feature", "spatial_record", "cell", "cell_revision", "active_cell", "import_item", "dataset")
    for table in tables:
        query = query.replace(f"enc.{table}", f"pg_temp.s52_{table}")
    setup = "BEGIN;\n" + "\n".join(f"CREATE TEMP TABLE s52_{table} (LIKE enc.{table} INCLUDING DEFAULTS);" for table in tables)
    setup += """
INSERT INTO s52_cell(dataset_id,name,metadata,bounds) VALUES
 ('00000000-0000-4000-8000-000000000001','A','{"DSPM_CSCL":20000}',ST_MakeEnvelope(0,0,0.05,0.05,4326));
INSERT INTO s52_cell_revision(id,producer,cell_name,storage_dataset_id,edition,update_number,publication_state)
 VALUES('00000000-0000-4000-8000-000000000002','test','A','00000000-0000-4000-8000-000000000001',1,0,'accepted');
INSERT INTO s52_active_cell(producer,cell_name,revision_id)
 VALUES('test','A','00000000-0000-4000-8000-000000000002');
INSERT INTO s52_feature(dataset_id,cell_name,object_class,source_id,geometry_kind,geometry,attributes)
 SELECT '00000000-0000-4000-8000-000000000001'::uuid,'A','DEPARE','deep','POLYGON',ST_MakeEnvelope(0,0,0.01,0.01,4326),'{"DRVAL1":12,"DRVAL2":20}'::jsonb UNION ALL
 SELECT '00000000-0000-4000-8000-000000000001','A','DEPARE','shallow','POLYGON',ST_MakeEnvelope(0.01,0,0.02,0.01,4326),'{"DRVAL1":3,"DRVAL2":5}' UNION ALL
 SELECT '00000000-0000-4000-8000-000000000001','A','DEPCNT','contour','LINESTRING',ST_GeomFromText('LINESTRING(0.01 0,0.01 0.01)',4326),'{"VALDCO":10}' UNION ALL
 SELECT '00000000-0000-4000-8000-000000000001','OTHER','DEPARE','unrelated','POLYGON',ST_MakeEnvelope(0,0,0.05,0.05,4326),'{"DRVAL1":30,"DRVAL2":50}' UNION ALL
 SELECT '00000000-0000-4000-8000-000000000001','A','UWTROC','rock-deep','POINT',ST_SetSRID(ST_Point(0.005,0.005),4326),'{"VALSOU":2,"WATLEV":3,"NAME_RCID":[90],"NAME_RCNM":[110]}' UNION ALL
 SELECT '00000000-0000-4000-8000-000000000001','A','UWTROC','rock-shallow','POINT',ST_SetSRID(ST_Point(0.015,0.005),4326),'{"VALSOU":2,"WATLEV":3}' UNION ALL
 SELECT '00000000-0000-4000-8000-000000000001','A','UWTROC','rock-unknown','POINT',ST_SetSRID(ST_Point(0.025,0.005),4326),'{"VALSOU":null,"WATLEV":3}' UNION ALL
 SELECT '00000000-0000-4000-8000-000000000001','A','LIGHTS','strip','POINT',ST_SetSRID(ST_Point(0.03,0.005),4326),'{"CATLIT":["9","8"],"COLOUR":["3"],"SECTR1":350,"SECTR2":10,"LITVIS":["8"]}' UNION ALL
 SELECT '00000000-0000-4000-8000-000000000001','A','ACHARE','anchorage','POLYGON',ST_MakeEnvelope(0.032,0.002,0.04,0.008,4326),'{}';
INSERT INTO s52_spatial_record(dataset_id,cell_name,record_type,source_id,attributes)
 VALUES('00000000-0000-4000-8000-000000000001','A','IsolatedNode','0','{"RCID":90,"RCNM":110,"QUAPOS":4}');
-- Continuous water context remains even if the source supplies a cutoff.
UPDATE s52_feature SET attributes=attributes || '{"SCAMIN":1}'::jsonb WHERE source_id='deep';
-- Co-located details reproduce a harbour chart shrinking below SCAMIN.
INSERT INTO s52_feature(dataset_id,cell_name,object_class,source_id,geometry_kind,geometry,attributes)
 SELECT '00000000-0000-4000-8000-000000000001'::uuid,'A',cls,'scale-' || cls,
 'POINT',ST_SetSRID(ST_Point(0.005,0.005),4326),
 '{"SCAMIN":29999,"DEPTH":8,"VALNMR":12}'::jsonb
 FROM unnest(ARRAY['LIGHTS','BOYLAT','TOPMAR','LNDMRK','SOUNDG','WRECKS']) AS cls;
INSERT INTO s52_feature(dataset_id,cell_name,object_class,source_id,geometry_kind,geometry,attributes)
 SELECT '00000000-0000-4000-8000-000000000001'::uuid,'A','LIGHTS','scale-' || suffix,
 'POINT',ST_SetSRID(ST_Point(0.005,0.005),4326),attrs
 FROM (VALUES ('missing','{}'::jsonb),('zero','{"SCAMIN":0}'),
 ('invalid','{"SCAMIN":"invalid"}'),('below','{"SCAMIN":68247}'),
 ('above','{"SCAMIN":68248}')) AS cases(suffix,attrs);
"""
    # At the equator z12 is approximately 1:68,248; z14 is 1:17,062.
    # Exercise both active-cell mosaic and explicit-cell scope, then zoom out
    # once more to ensure visibility is derived from each request's scale.
    requests = [(12, 2048, 2047, scope) for scope in ('', 'A')]
    requests += [(14, 8192, 8191, scope) for scope in ('', 'A')]
    requests += [(12, 2048, 2047, scope) for scope in ('', 'A')]
    setup += "PREPARE s52_query(int,int,int,text,text,double precision,double precision) AS " + query + ";\n"
    setup += "\n".join(f"EXECUTE s52_query({z},{x},{y},'','{scope}',6,6);" for z, x, y, scope in requests)
    setup += "\nROLLBACK;"
    result = subprocess.run(["docker", "exec", "-i", args.container, "psql", "-U", "enc_owner", "-d", "enc_canonical",
                             "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], input=setup, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    responses = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    assert len(responses) == len(requests)
    for (z, _, _, scope), response in zip(requests, responses):
        names = {key.rsplit(':', 1)[-1] for key in response}
        for cls in ('LIGHTS', 'BOYLAT', 'TOPMAR', 'LNDMRK', 'SOUNDG', 'WRECKS'):
            assert (f'scale-{cls}' in names) == (z == 14), (z, scope, cls)
        for suffix in ('missing', 'zero', 'invalid', 'above'):
            assert f'scale-{suffix}' in names, (z, scope, suffix)
        assert 'deep' in names, (z, scope, 'water context')
        assert ('scale-below' in names) == (z == 14), (z, scope, 'threshold')
    values = responses[0]
    def feature(name):
        return next(value for key, value in values.items() if key.endswith(":" + name))
    assert feature("rock-deep")["s52_surrounding_depth"] == 12
    assert feature("rock-shallow")["s52_surrounding_depth"] == 3
    assert feature("rock-deep")["s52_safety_contour"] == 10
    assert feature("rock-unknown")["s52_surrounding_depth"] is None
    assert str(feature("rock-deep")["s52_quapos"]) == "4"
    assert feature("rock-shallow")["s52_quapos"] is None
    assert feature("strip")["sym_CATLIT"] == "9"
    assert feature("strip")["list_CATLIT"] == "|9|8|"
    assert feature("strip")["CATLIT"] == ["9", "8"]
    assert feature("strip")["list_LITVIS"] == "|8|"
    assert feature("strip")["LITVIS"] == ["8"]
    assert feature("anchorage")["s52_geometry"] == 2
    print("Passed: zoom-out/in SCAMIN in auto and explicit-cell scope, source geometry, original attributes, list normalization, primitive QUAPOS and isolated same-cell depth context. Transaction rolled back.")


if __name__ == "__main__":
    main()
