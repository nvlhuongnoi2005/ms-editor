\connect enc_canonical
SET ROLE enc_owner;
-- Remove reference regions from the former implementation. Local coverage is derived.
DO $$ BEGIN
 IF to_regclass('enc.region') IS NOT NULL THEN
  EXECUTE 'DELETE FROM enc.region WHERE source_url = ''https://openenc.com/v1/regions''';
 END IF;
END $$;
RESET ROLE;
