\connect enc_canonical
SET ROLE enc_owner;
BEGIN;
CREATE TABLE IF NOT EXISTS enc.workspace (
 id uuid PRIMARY KEY,
 base_revision text NOT NULL REFERENCES enc.cell_revision(id) ON DELETE RESTRICT,
 token_hash bytea NOT NULL,
 version bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_base_revision_idx ON enc.workspace(base_revision);
CREATE TABLE IF NOT EXISTS enc.workspace_feature (
 workspace_id uuid NOT NULL REFERENCES enc.workspace(id) ON DELETE CASCADE,
 feature_key text NOT NULL,
 document jsonb NOT NULL,
 PRIMARY KEY(workspace_id,feature_key)
);
CREATE TABLE IF NOT EXISTS enc.workspace_commit (
 workspace_id uuid NOT NULL REFERENCES enc.workspace(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 payload_hash bytea NOT NULL,
 version bigint NOT NULL,
 changes jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,request_id),
 UNIQUE(workspace_id,version)
);

COMMIT;
RESET ROLE;
