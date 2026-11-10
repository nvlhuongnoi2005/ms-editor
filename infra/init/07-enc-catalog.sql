\connect enc_canonical
SET ROLE enc_owner;
SET search_path = enc, public;
BEGIN;
ALTER TABLE enc.dataset ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE TABLE IF NOT EXISTS enc.cell_identity (
 producer text NOT NULL, name text NOT NULL, PRIMARY KEY(producer,name)
);
-- Geometry remains in the existing cell/feature tables; revisions own that immutable storage.
CREATE TABLE IF NOT EXISTS enc.cell_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 producer text NOT NULL, cell_name text NOT NULL,
 storage_dataset_id uuid NOT NULL,
 edition integer NOT NULL DEFAULT 0, update_number integer NOT NULL DEFAULT 0,
 content_sha256 text, description text NOT NULL DEFAULT '',
 publication_state text NOT NULL DEFAULT 'accepted' CHECK(publication_state IN ('accepted','conflict')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(producer,cell_name) REFERENCES enc.cell_identity(producer,name),
 FOREIGN KEY(storage_dataset_id,cell_name) REFERENCES enc.cell(dataset_id,name) ON DELETE RESTRICT,
 UNIQUE(storage_dataset_id,cell_name)
);
CREATE INDEX IF NOT EXISTS revision_content_idx ON enc.cell_revision(producer,cell_name,content_sha256);
CREATE TABLE IF NOT EXISTS enc.import_item (
 batch_id uuid NOT NULL REFERENCES enc.dataset(id) ON DELETE CASCADE,
 cell_name text NOT NULL,
 revision_id uuid NOT NULL REFERENCES enc.cell_revision(id) ON DELETE RESTRICT,
 outcome text NOT NULL CHECK(outcome IN ('imported','duplicate','older','conflict')),
 PRIMARY KEY(batch_id,cell_name)
);
CREATE INDEX IF NOT EXISTS import_item_revision_idx ON enc.import_item(revision_id);
CREATE TABLE IF NOT EXISTS enc.active_cell (
 producer text NOT NULL, cell_name text NOT NULL,
 revision_id uuid NOT NULL UNIQUE REFERENCES enc.cell_revision(id) ON DELETE RESTRICT,
 PRIMARY KEY(producer,cell_name)
);
CREATE TABLE IF NOT EXISTS enc.catalog_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 0
);
INSERT INTO enc.catalog_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION enc.refresh_active_catalog() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(713480192);
 DELETE FROM enc.active_cell;
 INSERT INTO enc.active_cell(producer,cell_name,revision_id)
 SELECT DISTINCT ON (r.producer,r.cell_name) r.producer,r.cell_name,r.id
 FROM enc.cell_revision r
 WHERE r.publication_state='accepted' AND EXISTS (
  SELECT 1 FROM enc.import_item i JOIN enc.dataset d ON d.id=i.batch_id
  WHERE i.revision_id=r.id AND d.state='ready' AND d.deleted_at IS NULL
 )
 ORDER BY r.producer,r.cell_name,r.edition DESC,r.update_number DESC,r.created_at,r.id;
 UPDATE enc.catalog_state SET revision=revision+1;
END $$;
-- Backfill old imports once, without changing their original feature/primitive storage.
INSERT INTO enc.cell_identity(producer,name)
 SELECT DISTINCT COALESCE(c.metadata->>'DSID_AGEN','unknown'),c.name FROM enc.cell c
 JOIN enc.dataset d ON d.id=c.dataset_id WHERE d.state='ready'
 ON CONFLICT DO NOTHING;
INSERT INTO enc.cell_revision(producer,cell_name,storage_dataset_id,edition,update_number,description,created_at)
 SELECT COALESCE(c.metadata->>'DSID_AGEN','unknown'),c.name,c.dataset_id,
 COALESCE(c.edition,0),c.update_number,COALESCE(c.metadata->>'description',''),d.created_at
 FROM enc.cell c JOIN enc.dataset d ON d.id=c.dataset_id WHERE d.state='ready'
 AND NOT EXISTS(SELECT 1 FROM enc.import_item i WHERE i.batch_id=c.dataset_id AND i.cell_name=c.name)
 ON CONFLICT(storage_dataset_id,cell_name) DO NOTHING;
INSERT INTO enc.import_item(batch_id,cell_name,revision_id,outcome)
 SELECT r.storage_dataset_id,r.cell_name,r.id,'imported' FROM enc.cell_revision r
 JOIN enc.dataset d ON d.id=r.storage_dataset_id WHERE d.deleted_at IS NULL
 ON CONFLICT DO NOTHING;
SELECT enc.refresh_active_catalog();
COMMIT;
RESET ROLE;
