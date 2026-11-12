"""Real PostgreSQL/PBF export verification, against an isolated test database.

Run with DB_* pointing at a disposable Canonical schema and EDITOR_EXPORT_TEST=1.
"""
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
import uuid
from unittest.mock import patch

import osmium
from psycopg.errors import QueryCanceled

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from importer import connection
import export_worker
from export_worker import write_snapshot, worker


@unittest.skipUnless(os.environ.get("EDITOR_EXPORT_TEST") == "1", "requires disposable Canonical DB")
class ExportIntegration(unittest.TestCase):
    def test_cancellation_interrupts_a_long_database_query(self):
        dataset_id, job_id = uuid.uuid4(), uuid.uuid4()
        with connection() as conn:
            conn.execute("INSERT INTO editor.dataset(id,name,state) VALUES(%s,%s,'ready')", (dataset_id, str(dataset_id)))
            conn.execute("INSERT INTO editor.export_job(id,dataset_id,state) VALUES(%s,%s,'running')", (job_id, dataset_id))

        def cancel():
            with connection() as conn:
                conn.execute("UPDATE editor.export_job SET cancel_requested=true WHERE id=%s", (job_id,))

        timer = threading.Timer(0.3, cancel)
        try:
            with connection() as snapshot:
                started = time.monotonic()
                with export_worker.ExportCancellation(snapshot, job_id):
                    timer.start()
                    with self.assertRaises(QueryCanceled):
                        snapshot.execute("SELECT pg_sleep(20)")
                    snapshot.rollback()
                self.assertLess(time.monotonic() - started, 8)
        finally:
            timer.join()
            with connection() as conn:
                conn.execute("DELETE FROM editor.export_job WHERE dataset_id=%s", (dataset_id,))
                conn.execute("DELETE FROM editor.dataset WHERE id=%s", (dataset_id,))

    def test_cancellation_cleans_partial_and_unpublished_final(self):
        for phase in ("writing", "publication"):
            with self.subTest(phase=phase):
                dataset_id, job_id = uuid.uuid4(), uuid.uuid4()
                with connection() as conn:
                    conn.execute("INSERT INTO editor.dataset(id,name,state) VALUES(%s,%s,'ready')", (dataset_id, str(dataset_id)))
                    conn.execute("""INSERT INTO editor.entity_current(dataset_id,entity_type,entity_id,version,node_lon_e7,node_lat_e7)
                        VALUES(%s,'node',1,1,0,0)""", (dataset_id,))
                    conn.execute("INSERT INTO editor.export_job(id,dataset_id,state) VALUES(%s,%s,'queued')", (job_id, dataset_id))
                original = export_worker.write_entity if phase == "writing" else os.replace

                def request_cancel(*args):
                    result = original(*args)
                    with connection() as conn:
                        conn.execute("UPDATE editor.export_job SET cancel_requested=true WHERE id=%s", (job_id,))
                    return result

                try:
                    with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"EDITOR_EXPORT_DIR": folder, "EDITOR_EXPORT_MIN_FREE_BYTES": "0", "EDITOR_EXPORT_BATCH_SIZE": "1"}):
                        target = "export_worker.write_entity" if phase == "writing" else "export_worker.os.replace"
                        with patch(target, side_effect=request_cancel):
                            worker(once=True)
                        self.assertEqual(list(Path(folder).iterdir()), [])
                        with connection() as conn:
                            self.assertEqual(conn.execute("SELECT state,phase,error FROM editor.export_job WHERE id=%s", (job_id,)).fetchone(), ("cancelled", "cancelled", None))
                finally:
                    with connection() as conn:
                        conn.execute("DELETE FROM editor.export_job WHERE dataset_id=%s", (dataset_id,))
                        conn.execute("DELETE FROM editor.entity_current WHERE dataset_id=%s", (dataset_id,))
                        conn.execute("DELETE FROM editor.dataset WHERE id=%s", (dataset_id,))

    def test_worker_claims_queue_and_recovers_interrupted_exports(self):
        dataset_id, interrupted_dataset = uuid.uuid4(), uuid.uuid4()
        job_id, interrupted_job = uuid.uuid4(), uuid.uuid4()
        with connection() as conn:
            for item in (dataset_id, interrupted_dataset):
                conn.execute("INSERT INTO editor.dataset(id,name,state,canonical_revision) VALUES(%s,%s,'ready',5)", (item, str(item)))
            conn.execute("INSERT INTO editor.export_job(id,dataset_id,state) VALUES(%s,%s,'queued')", (job_id, dataset_id))
            conn.execute("INSERT INTO editor.export_job(id,dataset_id,state) VALUES(%s,%s,'running')", (interrupted_job, interrupted_dataset))
        try:
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                partial = root / (str(interrupted_job) + ".partial")
                partial.write_bytes(b"interrupted")
                previous_dir = os.environ.get("EDITOR_EXPORT_DIR")
                os.environ["EDITOR_EXPORT_DIR"] = folder
                os.environ["EDITOR_EXPORT_MIN_FREE_BYTES"] = "0"
                try:
                    worker(once=True)
                finally:
                    if previous_dir is None:
                        os.environ.pop("EDITOR_EXPORT_DIR", None)
                    else:
                        os.environ["EDITOR_EXPORT_DIR"] = previous_dir
                self.assertFalse(partial.exists())
                self.assertTrue((root / (str(job_id) + ".osm.pbf")).exists())
                with connection() as conn:
                    self.assertEqual(conn.execute("SELECT state,revision FROM editor.export_job WHERE id=%s", (job_id,)).fetchone(), ("ready", 5))
                    self.assertEqual(conn.execute("SELECT state FROM editor.export_job WHERE id=%s", (interrupted_job,)).fetchone()[0], "failed")
        finally:
            with connection() as cleanup:
                for item in (dataset_id, interrupted_dataset):
                    cleanup.execute("DELETE FROM editor.export_job WHERE dataset_id=%s", (item,))
                    cleanup.execute("DELETE FROM editor.dataset WHERE id=%s", (item,))

    def test_complete_pbf_uses_one_snapshot_and_keeps_member_order(self):
        dataset_id, job_id = uuid.uuid4(), uuid.uuid4()
        with connection() as conn:
            conn.execute("INSERT INTO editor.dataset(id,name,state,canonical_revision) VALUES(%s,'export-test','ready',7)", (dataset_id,))
            for node_id, lon, lat, visible in [(1, 1050000000, 210000000, True), (2, -730000000, 400000000, True), (3, 0, 0, False)]:
                conn.execute("""INSERT INTO editor.entity_current(dataset_id,entity_type,entity_id,version,visible,tags,node_lon_e7,node_lat_e7)
                    VALUES(%s,'node',%s,2,%s,'{"name":"edited"}',%s,%s)""", (dataset_id, node_id, visible, lon, lat))
            conn.execute("""INSERT INTO editor.entity_current(dataset_id,entity_type,entity_id,version,node_refs,tags)
                VALUES(%s,'way',10,3,ARRAY[1,2]::bigint[],'{"highway":"service"}')""", (dataset_id,))
            conn.execute("""INSERT INTO editor.entity_current(dataset_id,entity_type,entity_id,version,members,tags)
                VALUES(%s,'relation',20,4,'[{"type":"node","ref":2,"role":"stop","sequence":1},
                {"type":"way","ref":10,"role":"route","sequence":0}]','{"type":"route"}')""", (dataset_id,))
            conn.execute("INSERT INTO editor.export_job(id,dataset_id,state) VALUES(%s,%s,'running')", (job_id, dataset_id))
        changed = False

        class ConcurrentStatus:
            def __init__(self, conn): self.conn = conn
            def transaction(self): return self.conn.transaction()
            def execute(self, query, params):
                nonlocal changed
                result = self.conn.execute(query, params)
                if "SET phase=" in query and params[0] == "writing" and not changed:
                    changed = True
                    with connection() as concurrent:
                        concurrent.execute("UPDATE editor.entity_current SET node_lon_e7=0 WHERE dataset_id=%s AND entity_type='node' AND entity_id=2", (dataset_id,))
                        concurrent.execute("UPDATE editor.dataset SET canonical_revision=8 WHERE id=%s", (dataset_id,))
                return result

        try:
            with tempfile.TemporaryDirectory() as folder, connection() as snapshot, connection() as status:
                os.environ["EDITOR_EXPORT_BATCH_SIZE"] = "1"
                os.environ["EDITOR_EXPORT_MIN_FREE_BYTES"] = "0"
                write_snapshot(snapshot, ConcurrentStatus(status), {"id": job_id, "dataset_id": dataset_id}, Path(folder))
                path = Path(folder) / (str(job_id) + ".osm.pbf")
                self.assertFalse((Path(folder) / (str(job_id) + ".partial")).exists())
                objects = []

                class Read(osmium.SimpleHandler):
                    def node(self, obj): objects.append(("node", obj.id, obj.version, dict(obj.tags), obj.location.lon))
                    def way(self, obj): objects.append(("way", obj.id, obj.version, [n.ref for n in obj.nodes]))
                    def relation(self, obj): objects.append(("relation", obj.id, obj.version, [(m.type, m.ref, m.role) for m in obj.members]))

                Read().apply_file(str(path))
                self.assertEqual([(o[0], o[1]) for o in objects], [("node", 1), ("node", 2), ("way", 10), ("relation", 20)])
                self.assertEqual(objects[1][4], -73.0)  # far outside the initial viewport, before concurrent edit
                self.assertEqual(objects[0][3], {"name": "edited"})
                self.assertEqual(objects[2][3], [1, 2])
                self.assertEqual(objects[3][3], [("w", 10, "route"), ("n", 2, "stop")])
                row = status.execute("SELECT state,revision,entity_count,bytes,sha256 FROM editor.export_job WHERE id=%s", (job_id,)).fetchone()
                self.assertEqual(row[:3], ("ready", 7, 4))
                self.assertEqual(row[3], path.stat().st_size)
                self.assertEqual(row[4], hashlib.sha256(path.read_bytes()).hexdigest())
                self.assertEqual(status.execute("SELECT total_count,phase FROM editor.export_job WHERE id=%s", (job_id,)).fetchone(), (4, "ready"))
        finally:
            with connection() as cleanup:
                cleanup.execute("DELETE FROM editor.export_job WHERE dataset_id=%s", (dataset_id,))
                cleanup.execute("DELETE FROM editor.entity_current WHERE dataset_id=%s", (dataset_id,))
                cleanup.execute("DELETE FROM editor.dataset WHERE id=%s", (dataset_id,))


if __name__ == "__main__":
    unittest.main()
