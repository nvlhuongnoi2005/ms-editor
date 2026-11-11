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
 SELECT '00000000-0000-4000-8000-000000000001','A','LIGHTS','strip','POINT',ST_SetSRID(ST_Point(0.03,0.005),4326),'{"CATLIT":["9","8"],"COLOUR":["3"],"SECTR1":350,"SECTR2":10}' UNION ALL
 SELECT '00000000-0000-4000-8000-000000000001','A','ACHARE','anchorage','POLYGON',ST_MakeEnvelope(0.032,0.002,0.04,0.008,4326),'{}';
INSERT INTO s52_spatial_record(dataset_id,cell_name,record_type,source_id,attributes)
 VALUES('00000000-0000-4000-8000-000000000001','A','IsolatedNode','0','{"RCID":90,"RCNM":110,"QUAPOS":4}');
"""
    setup += "PREPARE s52_query(int,int,int,text,text) AS " + query + ";\nEXECUTE s52_query(12,2048,2047,'','A');\nROLLBACK;"
    result = subprocess.run(["docker", "exec", "-i", args.container, "psql", "-U", "enc_owner", "-d", "enc_canonical",
                             "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], input=setup, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    values = json.loads(result.stdout)
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
    assert feature("anchorage")["s52_geometry"] == 2
    print("Passed: source geometry, original attributes, list normalization, primitive QUAPOS and isolated same-cell depth context. Transaction rolled back.")


if __name__ == "__main__":
    main()
