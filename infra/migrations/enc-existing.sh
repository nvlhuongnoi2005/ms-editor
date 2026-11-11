#!/usr/bin/env bash
set -euo pipefail
psql -X -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d postgres \
  --set enc_password="${ENC_DB_PASSWORD:-$CANONICAL_DB_PASSWORD}" <<'SQL'
SELECT format('CREATE ROLE enc_owner LOGIN PASSWORD %L', :'enc_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enc_owner') \gexec
SELECT 'CREATE DATABASE enc_canonical OWNER enc_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'enc_canonical') \gexec
REVOKE ALL ON DATABASE enc_canonical FROM PUBLIC;
\i /docker-entrypoint-initdb.d/06-enc-canonical.sql
\i /docker-entrypoint-initdb.d/07-enc-catalog.sql
\i /docker-entrypoint-initdb.d/08-enc-regions.sql
\i /docker-entrypoint-initdb.d/09-enc-readable-revisions.sql
SQL
