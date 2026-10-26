-- Apply this file manually to an existing Canonical DB. Fresh volumes also run
-- it after 01-canonical.sql; every statement is intentionally idempotent.
\connect canonical
SET ROLE canonical_owner;
SET search_path = editor, public;

ALTER TABLE outbox_event ADD COLUMN IF NOT EXISTS rendered_at timestamptz;
ALTER TABLE outbox_event ADD COLUMN IF NOT EXISTS processing_at timestamptz;
ALTER TABLE outbox_event ADD COLUMN IF NOT EXISTS locked_by text;
ALTER TABLE outbox_event ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE outbox_event ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS outbox_event_pending_idx
  ON outbox_event (dataset_id, revision)
  WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS tile_dirty (
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

CREATE TABLE IF NOT EXISTS tile_manifest (
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
