CREATE TABLE IF NOT EXISTS editor.export_job (
  id uuid PRIMARY KEY,
  dataset_id uuid NOT NULL REFERENCES editor.dataset(id),
  state text NOT NULL CHECK (state IN ('queued','running','ready','failed')),
  revision bigint,
  entity_count bigint NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0,
  sha256 text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS export_job_active_idx ON editor.export_job(dataset_id)
  WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS export_job_recent_idx ON editor.export_job(dataset_id,created_at DESC);
CREATE TABLE IF NOT EXISTS editor.export_worker_status (
  id integer PRIMARY KEY CHECK (id=1),
  heartbeat_at timestamptz NOT NULL
);
