"""Persistent PBF import worker. Runs independently of the HTTP request/browser.

Every upload gets a fresh canonical dataset and an exclusive render schema.
Only the final canonical transaction exposes the dataset to readers/editors.
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import uuid

import osmium
import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from importer import CanonicalImporter, connection

LOG = logging.getLogger("import-worker")
LOCK_ID = 713480190


def stage(conn, job_id, state):
    conn.execute("UPDATE editor.import_job SET state=%s WHERE id=%s", (state, job_id))
    conn.commit()


def public_error(error):
    message = str(error)
    for name in ("DB_PASSWORD", "RENDER_DB_PASSWORD"):
        secret = os.environ.get(name)
        if secret:
            message = message.replace(secret, "[redacted]")
    return message[-2000:]


class Heartbeat:
    def __init__(self):
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while not self.stop.is_set():
            try:
                with connection() as conn:
                    conn.execute("INSERT INTO editor.import_worker_status VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()")
            except Exception:
                LOG.warning("Cannot update import worker heartbeat")
            self.stop.wait(5)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(timeout=6)


def claim(conn):
    with conn.transaction():
        with conn.cursor(row_factory=dict_row) as cursor:
            job = cursor.execute("""SELECT job.*,dataset.name,dataset.render_schema
                FROM editor.import_job job JOIN editor.dataset dataset ON dataset.id=job.id
                WHERE job.state='queued' AND dataset.state='importing'
                ORDER BY job.created_at FOR UPDATE OF job SKIP LOCKED LIMIT 1""").fetchone()
        if job:
            conn.execute("UPDATE editor.import_job SET state='canonical',started_at=now(),finished_at=NULL,error=NULL,attempts=attempts+1 WHERE id=%s", (job["id"],))
        return job


def render_baseline(path, schema):
    # The schema is derived solely from the job UUID, never from a user filename.
    with psycopg.connect(host=os.environ.get("RENDER_DB_HOST", "127.0.0.1"),
                         port=os.environ.get("RENDER_DB_PORT", "5432"),
                         dbname=os.environ.get("RENDER_DB_NAME", "render"),
                         user=os.environ.get("RENDER_DB_USER", "render_owner"),
                         password=os.environ.get("RENDER_DB_PASSWORD")) as render:
        render.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))
    args = [os.environ.get("OSM2PGSQL_BIN", "osm2pgsql"), "--create", "--slim", "--hstore", "--schema", schema,
            "--cache", os.environ.get("IMPORT_RENDER_CACHE_MB", "256"),
            "--number-processes", os.environ.get("IMPORT_RENDER_PROCESSES", "1"),
            "-H", os.environ.get("RENDER_DB_HOST", "127.0.0.1"),
            "-P", os.environ.get("RENDER_DB_PORT", "5432"),
            "-U", os.environ.get("RENDER_DB_USER", "render_owner"),
            "-d", os.environ.get("RENDER_DB_NAME", "render"), str(path)]
    env = {**os.environ, "PGPASSWORD": os.environ.get("RENDER_DB_PASSWORD", "")}
    with tempfile.TemporaryFile() as output:
        result = subprocess.run(args, env=env, stdout=output, stderr=output,
                                timeout=int(os.environ.get("IMPORT_RENDER_TIMEOUT_SECONDS", "21600")), check=False)
        if result.returncode:
            output.seek(0, os.SEEK_END)
            output.seek(max(0, output.tell() - 1600))
            raise RuntimeError("Render import failed: " + output.read().decode("utf8", errors="replace"))


def run_job(conn, job):
    job_id = uuid.UUID(str(job["id"]))
    schema = "import_" + job_id.hex
    if job["render_schema"] != schema:
        raise RuntimeError("Refusing to overwrite a render schema not owned by this import")
    root = Path(os.environ.get("EDITOR_IMPORT_DIR", "../data/imports")).resolve()
    path = root / (str(job_id) + ".osm.pbf")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if path.stat().st_size != job["bytes"] or digest.hexdigest() != job["sha256"]:
        raise RuntimeError("Uploaded PBF size/checksum does not match the queued job")
    with osmium.io.Reader(str(path)) as reader:
        if reader.header().has_multiple_object_versions:
            raise RuntimeError("History PBF is not supported; upload a snapshot extract")

    def progress(counts):
        conn.execute("UPDATE editor.import_job SET node_count=%s,way_count=%s,relation_count=%s WHERE id=%s",
                     (counts["node"], counts["way"], counts["relation"], job_id))
        conn.commit()

    importer = CanonicalImporter(conn, job_id, 5000, progress=progress)
    # Disk-backed location index avoids keeping a nationwide node index in RAM.
    with tempfile.NamedTemporaryFile(dir=root, suffix=".idx") as index:
        importer.apply_file(str(path), locations=True, idx="sparse_file_array," + index.name)
        importer.flush()
    if not importer.bounds or not importer.counts["node"]:
        raise RuntimeError("PBF contains no nodes with usable geometry")
    # Incomplete ways cannot be safely edited. Regional extracts may have
    # incomplete relation membership; existing dependency validation handles it.
    missing = conn.execute("""SELECT EXISTS(SELECT 1 FROM editor.entity_current way
        CROSS JOIN LATERAL unnest(way.node_refs) ref(id)
        WHERE way.dataset_id=%s AND way.entity_type='way' AND way.visible
        AND NOT EXISTS(SELECT 1 FROM editor.entity_current node WHERE node.dataset_id=way.dataset_id
            AND node.entity_type='node' AND node.entity_id=ref.id AND node.visible))""", (job_id,)).fetchone()[0]
    conn.commit()
    if missing:
        raise RuntimeError("PBF contains ways with missing nodes; upload a complete snapshot extract")
    stage(conn, job_id, "render")
    render_baseline(path, schema)
    stage(conn, job_id, "indexing")
    # Do not block editors with a regular index build on an existing table.
    conn.autocommit = True
    try:
        for statement in (
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS entity_current_visible_way_bbox_idx ON editor.entity_current USING gist(bbox) WHERE visible AND entity_type='way'::editor.entity_type",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS entity_current_visible_node_bbox_idx ON editor.entity_current USING gist(bbox) WHERE visible AND entity_type='node'::editor.entity_type",
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS entity_current_relation_members_idx ON editor.entity_current USING gin(members jsonb_path_ops) WHERE visible AND entity_type='relation'::editor.entity_type",
            "ANALYZE editor.entity_current",
        ):
            conn.execute(statement)
    finally:
        conn.autocommit = False
    # Atomic visibility: neither the graph nor its tile source is exposed early.
    with conn.transaction():
        conn.execute("INSERT INTO editor.dataset_revision(dataset_id,revision,changeset_id) VALUES(%s,0,NULL) ON CONFLICT DO NOTHING", (job_id,))
        conn.execute("UPDATE editor.dataset SET state='ready',bounds=%s WHERE id=%s AND state='importing'", (importer.bounds, job_id))
        conn.execute("UPDATE editor.import_job SET state='ready',finished_at=now(),error=NULL WHERE id=%s", (job_id,))
    LOG.info("Import %s ready: %s", job_id, importer.counts)


def worker(once=False):
    with connection() as conn:
        if not conn.execute("SELECT pg_try_advisory_lock(%s)", (LOCK_ID,)).fetchone()[0]:
            raise RuntimeError("Another import worker owns the queue")
        conn.commit()
        # Only one worker holds this session lock. Active jobs on startup are
        # interrupted jobs, not jobs still owned by a different live worker.
        with conn.transaction():
            interrupted = conn.execute("UPDATE editor.import_job SET state='failed',error='Worker interrupted; retry this import.',finished_at=now() WHERE state IN ('canonical','render','indexing') RETURNING id").fetchall()
            for (job_id,) in interrupted:
                conn.execute("UPDATE editor.dataset SET state='failed' WHERE id=%s AND state='importing'", (job_id,))
        with Heartbeat():
            while True:
                job = claim(conn)
                if job:
                    try:
                        run_job(conn, job)
                    except Exception as error:
                        conn.rollback()
                        message = public_error(error)
                        LOG.error("Import %s failed: %s", job["id"], message)
                        with conn.transaction():
                            conn.execute("UPDATE editor.import_job SET state='failed',error=%s,finished_at=now() WHERE id=%s", (message, job["id"]))
                            conn.execute("UPDATE editor.dataset SET state='failed' WHERE id=%s AND state='importing'", (job["id"],))
                elif not once:
                    time.sleep(2)
                if once:
                    return


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    worker(parser.parse_args().once)
