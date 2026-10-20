#!/usr/bin/env bash
set -euo pipefail

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set canonical_password="$CANONICAL_DB_PASSWORD" \
  --set render_password="$RENDER_DB_PASSWORD" <<'SQL'
CREATE ROLE canonical_owner LOGIN PASSWORD :'canonical_password';
CREATE ROLE render_owner LOGIN PASSWORD :'render_password';

CREATE DATABASE canonical OWNER canonical_owner;
CREATE DATABASE render OWNER render_owner;

REVOKE ALL ON DATABASE canonical FROM PUBLIC;
REVOKE ALL ON DATABASE render FROM PUBLIC;
SQL
