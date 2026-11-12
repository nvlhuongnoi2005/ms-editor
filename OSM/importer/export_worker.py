"""Export complete Canonical snapshots to immutable PBF files with bounded buffers.

Run separately from the import worker: python export_worker.py [--once].
The snapshot revision is captured when the worker starts reading, not on click.
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import os
from pathlib import Path
import shutil
import threading
import time

import osmium
from psycopg.rows import dict_row

from importer import connection

LOG = logging.getLogger("export-worker")
LOCK_ID = 713480191
TYPES = ("node", "way", "relation")


class Heartbeat:
    def __init__(self):
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while not self.stop.is_set():
            try:
                with connection() as conn:
                    conn.execute("INSERT INTO editor.export_worker_status VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()")
            except Exception:
                LOG.warning("Cannot update export worker heartbeat")
            self.stop.wait(5)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(timeout=6)


def write_entity(writer, kind, row):
    # Canonical changes can retain the original source timestamp. Do not label
    # edited objects with that stale timestamp; updated_at is their local time.
    attrs = dict(id=row["entity_id"], version=row["version"], visible=True,
                 tags=row["tags"] or {}, changeset=row["changeset_id"] or 0)
    if row.get("timestamp") is not None:
        attrs["timestamp"] = row["timestamp"]
    if kind == "node":
        writer.add_node(osmium.osm.mutable.Node(
            **attrs, location=(row["node_lon_e7"] / 1e7, row["node_lat_e7"] / 1e7)))
    elif kind == "way":
        writer.add_way(osmium.osm.mutable.Way(**attrs, nodes=row["node_refs"] or []))
    else:
        members = sorted(row["members"] or [], key=lambda item: item.get("sequence", 0))
        writer.add_relation(osmium.osm.mutable.Relation(
            **attrs, members=[(item["type"][0], int(item["ref"]), item.get("role", "")) for item in members]))


def write_snapshot(snapshot, status, job, root):
    """A single read-only repeatable-read transaction owns all three cursors."""
    job_id = job["id"]
    partial = root / (str(job_id) + ".partial")
    final = root / (str(job_id) + ".osm.pbf")
    count = 0
    batch_size = max(1, min(5000, int(os.environ.get("EDITOR_EXPORT_BATCH_SIZE", "1000"))))
    reserve = max(0, int(os.environ.get("EDITOR_EXPORT_MIN_FREE_BYTES", str(1 << 30))))
    with snapshot.transaction():
        snapshot.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        # Bound server-side sort memory as well as client cursor batches. The
        # dataset/type/id index provides the requested order without a full sort.
        snapshot.execute("SET LOCAL work_mem='16MB'")
        dataset = snapshot.execute("SELECT canonical_revision,state FROM editor.dataset WHERE id=%s", (job["dataset_id"],)).fetchone()
        if not dataset or dataset[1] != "ready":
            raise RuntimeError("Dataset is no longer ready")
        revision = dataset[0]
        with status.transaction():
            status.execute("UPDATE editor.export_job SET revision=%s WHERE id=%s", (revision, job_id))
        header = osmium.io.Header()
        header.set("generator", "Map Service Editor")
        # Explicit format because the staging filename ends in .partial.
        output = osmium.io.File(str(partial), "pbf")
        with osmium.SimpleWriter(output, bufsz=4 << 20, header=header) as writer:
            for kind in TYPES:
                with snapshot.cursor(name="export_" + kind, row_factory=dict_row) as cursor:
                    cursor.itersize = batch_size
                    cursor.execute("""SELECT entity_id,version,tags,node_lon_e7,node_lat_e7,node_refs,members,changeset_id,
                        COALESCE(updated_at,source_timestamp) AS timestamp
                        FROM editor.entity_current
                        WHERE dataset_id=%s AND entity_type=%s::editor.entity_type AND visible
                        ORDER BY entity_id""", (job["dataset_id"], kind))
                    for row in cursor:
                        write_entity(writer, kind, row)
                        count += 1
                        if count % batch_size == 0:
                            if shutil.disk_usage(root).free < reserve:
                                raise RuntimeError("Export disk has insufficient free space")
                            with status.transaction():
                                status.execute("UPDATE editor.export_job SET entity_count=%s WHERE id=%s", (count, job_id))
    # Hash in bounded blocks; do not expose a download until all writes finish.
    digest = hashlib.sha256()
    with partial.open("rb") as source:
        for block in iter(lambda: source.read(1 << 20), b""):
            digest.update(block)
        os.fsync(source.fileno())
    size = partial.stat().st_size
    os.replace(partial, final)
    with status.transaction():
        status.execute("""UPDATE editor.export_job SET state='ready',revision=%s,entity_count=%s,
            bytes=%s,sha256=%s,finished_at=now(),error=NULL WHERE id=%s""",
                       (revision, count, size, digest.hexdigest(), job_id))
    LOG.info("Export %s ready: revision %s, %s entities, %s bytes", job_id, revision, count, size)


def worker(once=False):
    root = Path(os.environ.get("EDITOR_EXPORT_DIR", "../data/exports")).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with connection() as queue:
        queue.autocommit = True
        # API creates the additive schema. Allow either service to start first.
        while not queue.execute("SELECT to_regclass('editor.export_job')").fetchone()[0]:
            if once:
                raise RuntimeError("Start editor-api to initialize the export schema first")
            time.sleep(2)
        if not queue.execute("SELECT pg_try_advisory_lock(%s)", (LOCK_ID,)).fetchone()[0]:
            raise RuntimeError("Another export worker owns the queue")
        # A lost process cannot continue its old PostgreSQL snapshot. Mark it
        # failed instead of resuming bytes from a different database revision.
        interrupted = queue.execute("""UPDATE editor.export_job SET state='failed',
            error='Export worker interrupted. Create a new export.',finished_at=now()
            WHERE state='running' RETURNING id""").fetchall()
        for (job_id,) in interrupted:
            (root / (str(job_id) + ".partial")).unlink(missing_ok=True)
            (root / (str(job_id) + ".osm.pbf")).unlink(missing_ok=True)
        with Heartbeat():
            while True:
                with queue.transaction():
                    with queue.cursor(row_factory=dict_row) as cursor:
                        job = cursor.execute("""SELECT id,dataset_id FROM editor.export_job WHERE state='queued'
                            ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1""").fetchone()
                    if job:
                        queue.execute("UPDATE editor.export_job SET state='running',started_at=now(),error=NULL WHERE id=%s", (job["id"],))
                if job:
                    try:
                        reserve = max(0, int(os.environ.get("EDITOR_EXPORT_MIN_FREE_BYTES", str(1 << 30))))
                        if shutil.disk_usage(root).free < reserve:
                            raise RuntimeError("Export disk has insufficient free space")
                        with connection() as snapshot:
                            write_snapshot(snapshot, queue, job, root)
                    except Exception as error:
                        # Avoid leaking connection parameters or credentials.
                        message = str(error)
                        secret = os.environ.get("DB_PASSWORD")
                        if secret:
                            message = message.replace(secret, "[redacted]")
                        LOG.error("Export %s failed (%s): %s", job["id"], type(error).__name__, message[-2000:])
                        for suffix in (".partial", ".osm.pbf"):
                            (root / (str(job["id"]) + suffix)).unlink(missing_ok=True)
                        queue.execute("""UPDATE editor.export_job SET state='failed',
                            error='Export failed. Check worker logs, database connection and available disk space.',finished_at=now()
                            WHERE id=%s""", (job["id"],))
                elif not once:
                    time.sleep(2)
                if once:
                    return


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    worker(parser.parse_args().once)
