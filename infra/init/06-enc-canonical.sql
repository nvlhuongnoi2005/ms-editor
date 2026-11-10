\connect enc_canonical

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS enc AUTHORIZATION enc_owner;
SET ROLE enc_owner;
SET search_path = enc, public;

CREATE TABLE IF NOT EXISTS dataset (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('importing', 'ready', 'failed')),
  source_filename text NOT NULL,
  source_sha256 text NOT NULL,
  feature_count bigint NOT NULL DEFAULT 0,
  bounds geometry(Geometry, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz
);

CREATE TABLE IF NOT EXISTS cell (
  dataset_id uuid NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  name text NOT NULL,
  edition integer,
  update_number integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  bounds geometry(Geometry, 4326),
  PRIMARY KEY (dataset_id, name)
);

CREATE TABLE IF NOT EXISTS feature (
  dataset_id uuid NOT NULL REFERENCES dataset(id) ON DELETE CASCADE,
  cell_name text NOT NULL,
  object_class text NOT NULL,
  source_id text NOT NULL,
  source_geometry jsonb,
  lnam text,
  geometry_kind text NOT NULL,
  geometry geometry(Geometry, 4326) NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (dataset_id, cell_name, object_class, source_id),
  FOREIGN KEY (dataset_id, cell_name) REFERENCES cell(dataset_id, name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS feature_geometry_idx ON feature USING gist (geometry);
CREATE INDEX IF NOT EXISTS feature_dataset_class_idx ON feature (dataset_id, object_class);
CREATE INDEX IF NOT EXISTS feature_lnam_idx ON feature (dataset_id, lnam) WHERE lnam IS NOT NULL;
ALTER TABLE feature ADD COLUMN IF NOT EXISTS source_geometry jsonb;

-- S-57 Edge records store intermediate coordinates; end nodes are linkages.
-- These records are not necessarily valid OGC LineStrings.
CREATE TABLE IF NOT EXISTS spatial_record (
  dataset_id uuid NOT NULL,
  cell_name text NOT NULL,
  record_type text NOT NULL,
  source_id text NOT NULL,
  attributes jsonb NOT NULL,
  source_geometry jsonb,
  PRIMARY KEY (dataset_id,cell_name,record_type,source_id),
  FOREIGN KEY (dataset_id,cell_name) REFERENCES cell(dataset_id,name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_job (
  id uuid PRIMARY KEY REFERENCES dataset(id) ON DELETE CASCADE,
  source_path text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'extracting', 'reading', 'ready', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

RESET ROLE;
