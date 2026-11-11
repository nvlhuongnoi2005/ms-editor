\connect enc_canonical
SET ROLE enc_owner;
BEGIN;
SET LOCAL lock_timeout = '10s';
-- Share the import/delete publication lock. Change every reference in the same
-- transaction, so a reader cannot observe a half-converted revision graph.
SELECT pg_advisory_xact_lock(713480192);
LOCK TABLE enc.cell_revision, enc.import_item, enc.active_cell IN ACCESS EXCLUSIVE MODE;

CREATE SEQUENCE IF NOT EXISTS enc.cell_revision_number_seq;
ALTER TABLE enc.cell_revision ADD COLUMN IF NOT EXISTS legacy_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS cell_revision_legacy_id_idx ON enc.cell_revision(legacy_id);

DO $$
DECLARE
 revision_type text;
BEGIN
 SELECT data_type INTO revision_type FROM information_schema.columns
 WHERE table_schema='enc' AND table_name='cell_revision' AND column_name='id';
 IF revision_type='text' THEN
   RETURN; -- Already migrated: do not renumber IDs or rewind the sequence.
 END IF;
 IF revision_type IS DISTINCT FROM 'uuid' THEN
   RAISE EXCEPTION 'Unexpected enc.cell_revision.id type: %', revision_type;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE confrelid='enc.cell_revision'::regclass
   AND conrelid NOT IN ('enc.import_item'::regclass,'enc.active_cell'::regclass)) THEN
   RAISE EXCEPTION 'Additional revision foreign keys require an explicit migration';
 END IF;

 -- Preserve the complete UUID mapping for source provenance and old reports.
 UPDATE enc.cell_revision SET legacy_id=id;
 ALTER TABLE enc.import_item DROP CONSTRAINT import_item_revision_id_fkey;
 ALTER TABLE enc.active_cell DROP CONSTRAINT active_cell_revision_id_fkey;
 ALTER TABLE enc.cell_revision ALTER COLUMN id DROP DEFAULT;
 ALTER TABLE enc.cell_revision ALTER COLUMN id TYPE text USING id::text;
 ALTER TABLE enc.import_item ALTER COLUMN revision_id TYPE text USING revision_id::text;
 ALTER TABLE enc.active_cell ALTER COLUMN revision_id TYPE text USING revision_id::text;

 -- Cascading updates move both references along with the primary key below.
 ALTER TABLE enc.import_item ADD CONSTRAINT import_item_revision_id_fkey
   FOREIGN KEY(revision_id) REFERENCES enc.cell_revision(id) ON UPDATE CASCADE ON DELETE RESTRICT;
 ALTER TABLE enc.active_cell ADD CONSTRAINT active_cell_revision_id_fkey
   FOREIGN KEY(revision_id) REFERENCES enc.cell_revision(id) ON UPDATE CASCADE ON DELETE RESTRICT;
 WITH numbered AS MATERIALIZED (
   SELECT id,nextval('enc.cell_revision_number_seq') AS serial
   FROM enc.cell_revision ORDER BY created_at,producer,cell_name,edition,update_number,id
 ) UPDATE enc.cell_revision r SET id=format('%s-E%s-U%s-R%s',r.cell_name,r.edition,r.update_number,n.serial)
 FROM numbered n WHERE r.id=n.id;

 -- Tile feature IDs contain the revision ID. Ask clients to reload the catalog.
 UPDATE enc.catalog_state SET revision=revision+1 WHERE singleton;
END $$;

CREATE OR REPLACE FUNCTION enc.assign_cell_revision_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- The sequence suffix distinguishes conflicting contents with equal cell,
 -- edition and update, including concurrent imports and different producers.
 -- The ID is assigned once on insert and does not change when metadata changes.
 IF NEW.id IS NULL OR NEW.id='' THEN
   NEW.id := format('%s-E%s-U%s-R%s',NEW.cell_name,NEW.edition,NEW.update_number,
     nextval('enc.cell_revision_number_seq'));
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assign_cell_revision_id ON enc.cell_revision;
CREATE TRIGGER assign_cell_revision_id BEFORE INSERT ON enc.cell_revision
 FOR EACH ROW EXECUTE FUNCTION enc.assign_cell_revision_id();
ALTER SEQUENCE enc.cell_revision_number_seq OWNED BY enc.cell_revision.id;
COMMIT;
RESET ROLE;
