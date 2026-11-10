"""Import a ZIP containing S-57 ENC base cells and update files into enc_canonical.

Each `.000` file is opened in the directory that also contains its `.001...`
updates. GDAL's S-57 driver applies the update chain while reading. The worker
stores feature objects and their attributes directly; it never converts them to
OSM node/way/relation primitives.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import logging
import tempfile
import time
import uuid
import zipfile

import psycopg
from osgeo import gdal

gdal.UseExceptions()
LOG = logging.getLogger("enc-importer")


def db_connection():
    return psycopg.connect(
        host=os.environ.get("ENC_DB_HOST", "127.0.0.1"),
        port=os.environ.get("ENC_DB_PORT", "5432"),
        dbname=os.environ.get("ENC_DB_NAME", "enc_canonical"),
        user=os.environ.get("ENC_DB_USER", "enc_owner"),
        password=os.environ.get("ENC_DB_PASSWORD"),
    )


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def json_value(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    return str(value)


def field_values(feature) -> dict[str, object]:
    definition = feature.GetDefnRef()
    values: dict[str, object] = {}
    for index in range(definition.GetFieldCount()):
        if feature.IsFieldSet(index):
            values[definition.GetFieldDefn(index).GetName()] = json_value(feature.GetField(index))
    return values


def highest_update(base: Path) -> int:
    updates = sorted(int(candidate.suffix[1:]) for candidate in base.parent.iterdir()
                     if candidate.stem.upper() == base.stem.upper() and re.fullmatch(r"\.\d{3}", candidate.suffix))
    if updates != list(range(max(updates, default=0) + 1)):
        raise ValueError(f"Missing S-57 update in cell {base.stem}")
    return max(updates, default=0)


def extract_archive(source: Path, destination: Path) -> list[Path]:
    with zipfile.ZipFile(source) as archive:
        if len(archive.infolist()) > 100_000 or sum(item.file_size for item in archive.infolist()) > 2 << 30:
            raise ValueError("ENC archive exceeds extraction limits (100,000 entries / 2 GiB)")
        paths = set()
        for member in archive.infolist():
            member_path = PurePosixPath(member.filename.replace("\\", "/"))
            if (member_path.is_absolute() or ".." in member_path.parts or ":" in member.filename
                    or stat.S_ISLNK(member.external_attr >> 16) or member.flag_bits & 1):
                raise ValueError("ENC archive contains an unsafe path")
            normalized = member_path.as_posix().casefold()
            if normalized in paths:
                raise ValueError("ENC archive contains duplicate paths")
            paths.add(normalized)
        archive.extractall(destination)
    bases = sorted(path for path in destination.rglob("*") if path.suffix == ".000")
    cells = set()
    for base in bases:
        if base.stem.upper() in cells:
            raise ValueError(f"Duplicate S-57 cell {base.stem}")
        cells.add(base.stem.upper())
        highest_update(base)
    for path in destination.rglob("*"):
        if (re.fullmatch(r"\.\d{3}", path.suffix) and path.suffix != ".000"
                and path.stem.upper() != "CATALOG" and path.stem.upper() not in cells):
            raise ValueError(f"Update without base cell: {path.name}")
    return bases


def insert_cell(conn, dataset_id: uuid.UUID, base: Path) -> int:
    options = ["UPDATES=APPLY", "SPLIT_MULTIPOINT=ON", "ADD_SOUNDG_DEPTH=ON",
               "RETURN_PRIMITIVES=ON", "RETURN_LINKAGES=ON", "LNAM_REFS=ON"]
    dataset = gdal.OpenEx(str(base), gdal.OF_VECTOR, open_options=options)
    if dataset is None:
        raise RuntimeError(f"GDAL cannot read S-57 base cell {base.name}")
    cell_name = base.stem.upper()
    metadata = {"baseFile": base.name, "appliedUpdate": highest_update(base)}
    dsid = dataset.GetLayerByName("DSID")
    if dsid is not None:
        identification = dsid.GetNextFeature()
        if identification is not None:
            metadata.update(field_values(identification))
    edition = metadata.get("DSID_EDTN")
    applied = int(metadata.get("DSID_UPDN") or 0)
    if applied != metadata["appliedUpdate"]:
        raise ValueError(f"GDAL applied update {applied} for {cell_name}; archive requires {metadata['appliedUpdate']}")
    conn.execute(
        "INSERT INTO enc.cell(dataset_id,name,edition,update_number,metadata) VALUES(%s,%s,%s,%s,%s)",
        (dataset_id, cell_name, int(edition) if edition else None, metadata["appliedUpdate"], json.dumps(metadata)),
    )
    inserted = 0
    for layer_index in range(dataset.GetLayerCount()):
        layer = dataset.GetLayerByIndex(layer_index)
        object_class = layer.GetName()
        if object_class == "DSID":
            continue
        layer.ResetReading()
        for ordinal, feature in enumerate(layer):
            geometry = feature.GetGeometryRef()
            if object_class in ("IsolatedNode", "ConnectedNode", "Edge", "Face"):
                conn.execute("INSERT INTO enc.spatial_record(dataset_id,cell_name,record_type,source_id,attributes,source_geometry) VALUES(%s,%s,%s,%s,%s::jsonb,%s::jsonb)",
                             (dataset_id,cell_name,object_class,str(feature.GetFID()),json.dumps(field_values(feature)),geometry.ExportToJson() if geometry else None))
                continue
            if geometry is None or geometry.IsEmpty():
                continue
            attributes = field_values(feature)
            # SOUNDG can split a single source feature into several points that
            # share LNAM.  FID keeps every expanded feature addressable.
            source_id = f"{attributes.get('LNAM') or object_class}:{feature.GetFID()}:{ordinal}"
            conn.execute(
                """INSERT INTO enc.feature(dataset_id,cell_name,object_class,source_id,lnam,geometry_kind,geometry,attributes,source_geometry)
                   VALUES(%s,%s,%s,%s,%s,%s,ST_Force2D(ST_SetSRID(ST_GeomFromWKB(%s),4326)),%s::jsonb,%s::jsonb)""",
                (dataset_id, cell_name, object_class, source_id, attributes.get("LNAM"), geometry.GetGeometryName(),
                 bytes(geometry.ExportToWkb()), json.dumps(attributes), geometry.ExportToJson()),
            )
            inserted += 1
    conn.execute(
        "UPDATE enc.cell SET bounds=(SELECT ST_SetSRID(ST_Extent(geometry)::geometry,4326) FROM enc.feature WHERE dataset_id=%s AND cell_name=%s) WHERE dataset_id=%s AND name=%s",
        (dataset_id, cell_name, dataset_id, cell_name),
    )
    LOG.info("Cell %s: %d records, update %s", cell_name, inserted, metadata["appliedUpdate"])
    return inserted


def import_zip(source: Path, dataset_name: str, queued_id=None):
    if not source.is_file() or source.suffix.lower() != ".zip":
        raise ValueError("source must be an existing .zip archive")
    checksum = digest(source)
    dataset_id = queued_id or uuid.uuid4()
    with db_connection() as conn:
        with conn.transaction():
            if not queued_id:
                previous = conn.execute("SELECT id,state,source_sha256 FROM enc.dataset WHERE name=%s FOR UPDATE", (dataset_name,)).fetchone()
                if previous:
                    if previous[1] != "failed" or previous[2] != checksum:
                        raise ValueError("Dataset exists; choose a new name for different or published data")
                    dataset_id = previous[0]
                    queued_id = dataset_id
                    conn.execute("UPDATE enc.dataset SET state='importing' WHERE id=%s", (dataset_id,))
                    conn.execute("UPDATE enc.import_job SET state='extracting',error=NULL,started_at=now(),finished_at=NULL WHERE id=%s", (dataset_id,))
            if queued_id:
                expected = conn.execute("SELECT source_sha256 FROM enc.dataset WHERE id=%s", (dataset_id,)).fetchone()
                if not expected or expected[0] != checksum:
                    raise ValueError("ENC source checksum differs from uploaded file")
            else:
                conn.execute(
                    "INSERT INTO enc.dataset(id,name,state,source_filename,source_sha256) VALUES(%s,%s,'importing',%s,%s)",
                    (dataset_id, dataset_name, source.name, checksum),
                )
                conn.execute("INSERT INTO enc.import_job(id,source_path,state,started_at) VALUES(%s,%s,'extracting',now())", (dataset_id, str(source)))
        try:
            with tempfile.TemporaryDirectory(prefix="enc-import-") as temporary:
                bases = extract_archive(source, Path(temporary))
                if not bases:
                    raise ValueError("ENC archive has no .000 base cells")
                with conn.transaction():
                    conn.execute("UPDATE enc.import_job SET state='reading' WHERE id=%s", (dataset_id,))
                with conn.transaction():
                    total = sum(insert_cell(conn, dataset_id, base) for base in bases)
                    conn.execute(
                        "UPDATE enc.dataset SET feature_count=%s,bounds=(SELECT ST_SetSRID(ST_Extent(geometry)::geometry,4326) FROM enc.feature WHERE dataset_id=%s),state='ready',ready_at=now() WHERE id=%s",
                        (total, dataset_id, dataset_id),
                    )
                    conn.execute("UPDATE enc.import_job SET state='ready',finished_at=now() WHERE id=%s", (dataset_id,))
        except Exception as error:
            with conn.transaction():
                conn.execute("UPDATE enc.dataset SET state='failed' WHERE id=%s", (dataset_id,))
                conn.execute("UPDATE enc.import_job SET state='failed',error=%s,finished_at=now() WHERE id=%s", (str(error)[-2000:], dataset_id))
            raise
    print(json.dumps({"id": str(dataset_id), "dataset": dataset_name, "source": source.name, "sha256": checksum}))


def watch():
    # A session lock serializes this queue and makes interrupted jobs detectable.
    with db_connection() as conn:
        if not conn.execute("SELECT pg_try_advisory_lock(713480191)").fetchone()[0]:
            raise RuntimeError("Another ENC worker owns the queue")
        conn.commit()
        with conn.transaction():
            interrupted = conn.execute("UPDATE enc.import_job SET state='failed',error='Worker interrupted; upload again with a new dataset name.',finished_at=now() WHERE state IN ('extracting','reading') RETURNING id").fetchall()
            for (job_id,) in interrupted:
                conn.execute("UPDATE enc.dataset SET state='failed' WHERE id=%s", (job_id,))
        while True:
            with conn.transaction():
                job = conn.execute("SELECT j.id,d.name FROM enc.import_job j JOIN enc.dataset d ON d.id=j.id WHERE j.state='queued' ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1").fetchone()
                if job:
                    conn.execute("UPDATE enc.import_job SET state='extracting',started_at=now() WHERE id=%s", (job[0],))
            if not job:
                time.sleep(2)
                continue
            try:
                root = Path(os.environ.get("ENC_IMPORT_DIR", "/data/enc/uploads"))
                with tempfile.TemporaryFile() as output:
                    result = subprocess.run([sys.executable, __file__, "--zip", str(root / (str(job[0]) + ".zip")),
                                             "--dataset", job[1], "--queued-id", str(job[0])],
                                            stdout=output, stderr=output, timeout=3600)
                    output.seek(0, os.SEEK_END)
                    output.seek(max(0,output.tell()-1800))
                    detail = output.read().decode("utf-8",errors="replace")
                    if result.returncode:
                        raise RuntimeError(f"GDAL import process exited {result.returncode}: {detail}")
                    LOG.info("ENC import %s completed", job[0])
            except Exception as error:
                LOG.exception("ENC import %s failed", job[0])
                with conn.transaction():
                    conn.execute("UPDATE enc.dataset SET state='failed' WHERE id=%s", (job[0],))
                    conn.execute("UPDATE enc.import_job SET state='failed',error=%s,finished_at=now() WHERE id=%s", (str(error)[-2000:], job[0]))


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, dest="source")
    parser.add_argument("--dataset")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--queued-id", type=uuid.UUID, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.watch:
        watch()
        return
    if not args.source or not args.dataset:
        parser.error("use --watch or supply --zip and --dataset")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,79}", args.dataset):
        parser.error("dataset must be 1-80 ASCII letters, digits or hyphens")
    try:
        import_zip(args.source, args.dataset, args.queued_id)
    except Exception as error:
        print(f"ENC import failed: {error}", file=os.sys.stderr)
        raise


if __name__ == "__main__":
    main()
