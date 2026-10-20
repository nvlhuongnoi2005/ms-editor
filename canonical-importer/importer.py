"""Load OSM PBF primitives into the canonical editor database.

This deliberately does not use osm2pgsql: it preserves ordered way node refs,
ordered relation members, tags, and source metadata required by editing.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import osmium
import psycopg
from psycopg.conninfo import make_conninfo
from psycopg.types.json import Jsonb


LOG = logging.getLogger("canonical-importer")
EPSILON = 0.000000001


def source_timestamp(entity: Any) -> str | None:
    value = getattr(entity, "timestamp", None)
    return str(value) if value else None


def entity_metadata(entity: Any) -> tuple[int, bool, int | None, str | None, int | None, str | None]:
    return (
        int(getattr(entity, "version", 0) or 1),
        bool(getattr(entity, "visible", True)),
        int(getattr(entity, "changeset", 0) or 0) or None,
        source_timestamp(entity),
        int(getattr(entity, "uid", 0) or 0) or None,
        str(getattr(entity, "user", "") or "") or None,
    )


def bbox_wkt(points: Iterable[tuple[float, float]]) -> str | None:
    points = list(points)
    if not points:
        return None
    min_lon = min(point[0] for point in points)
    max_lon = max(point[0] for point in points)
    min_lat = min(point[1] for point in points)
    max_lat = max(point[1] for point in points)
    if min_lon == max_lon:
        min_lon -= EPSILON
        max_lon += EPSILON
    if min_lat == max_lat:
        min_lat -= EPSILON
        max_lat += EPSILON
    return (
        f"POLYGON(({min_lon} {min_lat},{max_lon} {min_lat},"
        f"{max_lon} {max_lat},{min_lon} {max_lat},{min_lon} {min_lat}))"
    )


@dataclass
class Primitive:
    entity_type: str
    entity_id: int
    version: int
    visible: bool
    tags: dict[str, str]
    node_lon_e7: int | None
    node_lat_e7: int | None
    node_refs: list[int] | None
    members: list[dict[str, Any]] | None
    bbox: str | None
    changeset_id: int | None
    source_timestamp: str | None
    source_uid: int | None
    source_user: str | None


UPSERT = """
INSERT INTO editor.entity_current (
  dataset_id, entity_type, entity_id, version, visible, tags,
  node_lon_e7, node_lat_e7, node_refs, members, bbox, changeset_id,
  source_timestamp, source_uid, source_user, updated_at
) VALUES (
  %(dataset_id)s, %(entity_type)s::editor.entity_type, %(entity_id)s,
  %(version)s, %(visible)s, %(tags)s,
  %(node_lon_e7)s, %(node_lat_e7)s, %(node_refs)s, %(members)s,
  ST_GeomFromText(%(bbox)s, 4326), %(changeset_id)s,
  %(source_timestamp)s, %(source_uid)s, %(source_user)s, now()
)
ON CONFLICT (dataset_id, entity_type, entity_id) DO UPDATE SET
  version = EXCLUDED.version,
  visible = EXCLUDED.visible,
  tags = EXCLUDED.tags,
  node_lon_e7 = EXCLUDED.node_lon_e7,
  node_lat_e7 = EXCLUDED.node_lat_e7,
  node_refs = EXCLUDED.node_refs,
  members = EXCLUDED.members,
  bbox = EXCLUDED.bbox,
  changeset_id = EXCLUDED.changeset_id,
  source_timestamp = EXCLUDED.source_timestamp,
  source_uid = EXCLUDED.source_uid,
  source_user = EXCLUDED.source_user,
  updated_at = now()
"""


class CanonicalImporter(osmium.SimpleHandler):
    def __init__(self, conn: psycopg.Connection, dataset_id: uuid.UUID, batch_size: int) -> None:
        super().__init__()
        self.conn = conn
        self.dataset_id = dataset_id
        self.batch_size = batch_size
        self.batch: list[Primitive] = []
        self.counts = {"node": 0, "way": 0, "relation": 0}

    def node(self, node: Any) -> None:
        version, visible, changeset, timestamp, uid, user = entity_metadata(node)
        lon = float(node.location.lon)
        lat = float(node.location.lat)
        self.add(
            Primitive(
                "node", int(node.id), version, visible, dict(node.tags),
                round(lon * 10_000_000), round(lat * 10_000_000), None, None,
                bbox_wkt([(lon, lat)]), changeset, timestamp, uid, user,
            )
        )

    def way(self, way: Any) -> None:
        version, visible, changeset, timestamp, uid, user = entity_metadata(way)
        refs = [int(node.ref) for node in way.nodes]
        points: list[tuple[float, float]] = []
        for node in way.nodes:
            try:
                if node.location.valid():
                    points.append((float(node.location.lon), float(node.location.lat)))
            except osmium.InvalidLocationError:
                pass
        self.add(
            Primitive(
                "way", int(way.id), version, visible, dict(way.tags),
                None, None, refs, None, bbox_wkt(points), changeset, timestamp, uid, user,
            )
        )

    def relation(self, relation: Any) -> None:
        version, visible, changeset, timestamp, uid, user = entity_metadata(relation)
        type_names = {"n": "node", "w": "way", "r": "relation"}
        members = [
            {
                "type": type_names.get(member.type, member.type),
                "ref": int(member.ref),
                "role": member.role or "",
                "sequence": sequence,
            }
            for sequence, member in enumerate(relation.members)
        ]
        self.add(
            Primitive(
                "relation", int(relation.id), version, visible, dict(relation.tags),
                None, None, None, members, None, changeset, timestamp, uid, user,
            )
        )

    def add(self, primitive: Primitive) -> None:
        self.batch.append(primitive)
        self.counts[primitive.entity_type] += 1
        if len(self.batch) >= self.batch_size:
            self.flush()

    def flush(self) -> None:
        if not self.batch:
            return
        rows = [
            {
                "dataset_id": self.dataset_id,
                "entity_type": item.entity_type,
                "entity_id": item.entity_id,
                "version": item.version,
                "visible": item.visible,
                "tags": Jsonb(item.tags),
                "node_lon_e7": item.node_lon_e7,
                "node_lat_e7": item.node_lat_e7,
                "node_refs": item.node_refs,
                "members": Jsonb(item.members) if item.members is not None else None,
                "bbox": item.bbox,
                "changeset_id": item.changeset_id,
                "source_timestamp": item.source_timestamp,
                "source_uid": item.source_uid,
                "source_user": item.source_user,
            }
            for item in self.batch
        ]
        with self.conn.cursor() as cursor:
            cursor.executemany(UPSERT, rows)
        self.conn.commit()
        total = sum(self.counts.values())
        LOG.info("imported %s primitives (nodes=%s ways=%s relations=%s)", total, self.counts["node"], self.counts["way"], self.counts["relation"])
        self.batch.clear()


def connection() -> psycopg.Connection:
    conninfo = make_conninfo(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ.get("DB_NAME", "canonical"),
        user=os.environ.get("DB_USER", "canonical_owner"),
        password=os.environ.get("DB_PASSWORD"),
        application_name="canonical-importer",
    )
    return psycopg.connect(conninfo)


def prepare_dataset(conn: psycopg.Connection, dataset_id: uuid.UUID, name: str, replace: bool) -> None:
    with conn.cursor() as cursor:
        cursor.execute("SELECT 1 FROM editor.dataset WHERE id = %s", (dataset_id,))
        exists = cursor.fetchone() is not None
        if exists and not replace:
            raise RuntimeError(f"dataset {dataset_id} already exists; use --replace to delete and import it again")
        if exists:
            cursor.execute("DELETE FROM editor.dataset WHERE id = %s", (dataset_id,))
        cursor.execute(
            "INSERT INTO editor.dataset (id, name, state) VALUES (%s, %s, 'importing')",
            (dataset_id, name),
        )
    conn.commit()


def finish_dataset(conn: psycopg.Connection, dataset_id: uuid.UUID) -> None:
    with conn.cursor() as cursor:
        cursor.execute(
            "UPDATE editor.dataset SET state = 'ready', canonical_revision = 0 WHERE id = %s",
            (dataset_id,),
        )
        cursor.execute(
            "INSERT INTO editor.dataset_revision (dataset_id, revision, changeset_id) VALUES (%s, 0, NULL)",
            (dataset_id,),
        )
    conn.commit()


def mark_failed(conn: psycopg.Connection, dataset_id: uuid.UUID) -> None:
    with conn.cursor() as cursor:
        cursor.execute("UPDATE editor.dataset SET state = 'failed' WHERE id = %s", (dataset_id,))
    conn.commit()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pbf", required=True, type=Path, help="PBF path inside the container")
    parser.add_argument("--dataset-name", required=True)
    parser.add_argument("--dataset-id", type=uuid.UUID, help="Stable UUID; generated and printed when omitted")
    parser.add_argument("--replace", action="store_true", help="Delete an existing dataset with this UUID before import")
    parser.add_argument("--batch-size", type=int, default=5_000)
    parser.add_argument("--location-index", default="flex_mem", help="pyosmium node-location index for way bbox calculation")
    return parser.parse_args()


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args()
    if not args.pbf.is_file():
        raise FileNotFoundError(f"PBF file does not exist: {args.pbf}")
    if args.batch_size < 1:
        raise ValueError("--batch-size must be positive")

    dataset_id = args.dataset_id or uuid.uuid4()
    LOG.info("dataset_id=%s", dataset_id)
    with connection() as conn:
        prepare_dataset(conn, dataset_id, args.dataset_name, args.replace)
        importer = CanonicalImporter(conn, dataset_id, args.batch_size)
        try:
            importer.apply_file(str(args.pbf), locations=True, idx=args.location_index)
            importer.flush()
            finish_dataset(conn, dataset_id)
        except Exception:
            LOG.exception("import failed; dataset is retained with state=failed for diagnosis")
            mark_failed(conn, dataset_id)
            return 1
    LOG.info("import complete: dataset_id=%s", dataset_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
