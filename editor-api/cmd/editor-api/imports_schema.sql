ALTER TABLE editor.dataset ADD COLUMN IF NOT EXISTS render_schema text NOT NULL DEFAULT 'render';
ALTER TABLE editor.dataset ADD COLUMN IF NOT EXISTS bounds double precision[];

CREATE TABLE IF NOT EXISTS editor.import_job (
  id uuid PRIMARY KEY REFERENCES editor.dataset(id),
  filename text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0),
  sha256 text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','canonical','render','indexing','ready','failed')),
  node_count bigint NOT NULL DEFAULT 0,
  way_count bigint NOT NULL DEFAULT 0,
  relation_count bigint NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS import_job_queue_idx ON editor.import_job(created_at) WHERE state='queued';
CREATE TABLE IF NOT EXISTS editor.import_worker_status (
  id integer PRIMARY KEY CHECK (id=1),
  heartbeat_at timestamptz NOT NULL
);
