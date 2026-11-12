#!/usr/bin/env bash
set -euo pipefail
# Bootstrap 00-02 is handled by the PostgreSQL entrypoint on an empty volume.
# Additive migrations run once and are checked by SHA-256 on every setup.
psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  'CREATE TABLE IF NOT EXISTS public.map_service_migration (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());'
for file in /docker-entrypoint-initdb.d/[0-9][0-9]-*.sql; do
  name=$(basename "$file")
  case "$name" in 00-*|01-*|02-*) continue ;; esac
  checksum=$(sha256sum "$file" | cut -d ' ' -f 1)
  previous=$(psql -X -U postgres -d postgres -At -c "SELECT sha256 FROM public.map_service_migration WHERE name='$name'")
  if [ -n "$previous" ]; then
    [ "$previous" = "$checksum" ] || { echo "Migration changed after application: $name. Add a new migration instead." >&2; exit 1; }
    continue
  fi
  echo "Applying $name"
  psql -X -U postgres -d canonical -v ON_ERROR_STOP=1 -f "$file"
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "INSERT INTO public.map_service_migration(name,sha256) VALUES('$name','$checksum')"
done
