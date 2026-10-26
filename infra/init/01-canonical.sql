\connect canonical

CREATE EXTENSION postgis;
CREATE EXTENSION hstore;

CREATE SCHEMA editor AUTHORIZATION canonical_owner;
SET ROLE canonical_owner;
SET search_path = editor, public;

CREATE TYPE entity_type AS ENUM ('node', 'way', 'relation');

CREATE TABLE dataset (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  state text NOT NULL CHECK (state IN ('importing', 'ready', 'failed')),
  canonical_revision bigint NOT NULL DEFAULT 0,
  render_revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE changeset (
  id bigserial PRIMARY KEY,
  dataset_id uuid NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('open', 'committed', 'closed', 'failed')),
  comment text,
  author_id text NOT NULL,
  base_revision bigint NOT NULL,
  committed_revision bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE entity_current (
  dataset_id uuid NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  entity_type entity_type NOT NULL,
  entity_id bigint NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  visible boolean NOT NULL DEFAULT true,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  node_lon_e7 integer,
  node_lat_e7 integer,
  node_refs bigint[],
  members jsonb,
  -- Geometry is intentionally generic: a node's zero-area bbox is a Point,
  -- while ways and relations use Polygon envelopes.
  bbox geometry(Geometry, 4326),
  changeset_id bigint,
  source_timestamp timestamptz,
  source_uid bigint,
  source_user text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, entity_type, entity_id),
  CHECK (
    (entity_type = 'node' AND node_lon_e7 IS NOT NULL AND node_lat_e7 IS NOT NULL AND node_refs IS NULL AND members IS NULL)
    OR (entity_type = 'way' AND node_lon_e7 IS NULL AND node_lat_e7 IS NULL AND node_refs IS NOT NULL AND members IS NULL)
    OR (entity_type = 'relation' AND node_lon_e7 IS NULL AND node_lat_e7 IS NULL AND node_refs IS NULL AND members IS NOT NULL)
  )
);

CREATE INDEX entity_current_bbox_idx ON entity_current USING gist (bbox);
CREATE INDEX entity_current_dataset_type_idx ON entity_current (dataset_id, entity_type, entity_id);
CREATE INDEX entity_current_tags_idx ON entity_current USING gin (tags);
-- Moving a node must efficiently find every way that references it.  A normal
-- btree cannot support the array-overlap predicate used by rebuildWayBboxes.
CREATE INDEX entity_current_way_node_refs_idx ON entity_current USING gin (node_refs)
  WHERE entity_type = 'way'::editor.entity_type AND visible;

CREATE TABLE entity_change (
  changeset_id bigint NOT NULL REFERENCES changeset(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  entity_type entity_type NOT NULL,
  entity_id bigint NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create', 'modify', 'delete')),
  before_payload jsonb,
  after_payload jsonb,
  bbox_before geometry(Geometry, 4326),
  bbox_after geometry(Geometry, 4326),
  PRIMARY KEY (changeset_id, sequence)
);

CREATE TABLE dataset_revision (
  dataset_id uuid NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  changeset_id bigint REFERENCES changeset(id),
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, revision)
);

CREATE TABLE outbox_event (
  id bigserial PRIMARY KEY,
  dataset_id uuid NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  rendered_at timestamptz,
  processing_at timestamptz,
  locked_by text,
  next_attempt_at timestamptz,
  last_error text
);

CREATE INDEX outbox_event_pending_idx ON outbox_event (dataset_id, revision)
  WHERE published_at IS NULL;

CREATE TABLE tile_dirty (
  dataset_id uuid NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  profile text NOT NULL,
  z integer NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  target_revision bigint NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, profile, z, x, y)
);

CREATE TABLE tile_manifest (
  dataset_id uuid NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  profile text NOT NULL,
  z integer NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  tile_revision bigint NOT NULL,
  style_revision bigint NOT NULL DEFAULT 1,
  artifact_key text NOT NULL,
  etag text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, profile, z, x, y)
);

RESET ROLE;
