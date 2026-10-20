# Local PostGIS and PBF import

## First-time setup

1. Copy `.env.example` to `.env`, replacing every password with a local-only
   secret.
2. Start PostGIS: `docker compose up -d postgres`.
3. Import the Render DB (run from this directory):

   ```powershell
   docker compose run --rm osm2pgsql -H postgres -U render_owner -d render --schema render --create --slim --hstore /data/vietnam-260901.osm.pbf
   ```

4. Import the Canonical DB. Copy the emitted UUID; it is the dataset id used by
   later API and tile calls.

   ```powershell
   docker compose run --rm canonical-importer --pbf /data/vietnam-260901.osm.pbf --dataset-name vietnam-260901
   ```

## Verification

```powershell
docker compose exec postgres psql -U canonical_owner -d canonical -c "SELECT id, name, state, canonical_revision FROM editor.dataset;"
docker compose exec postgres psql -U canonical_owner -d canonical -c "SELECT entity_type, count(*) FROM editor.entity_current GROUP BY entity_type;"
docker compose exec postgres psql -U render_owner -d render -c "\dt render.*"
```

`osm2pgsql` owns the Render DB. Never use it as the canonical source or write
to its tables from the editor API. The Canonical importer stores ordered
`node_refs` and relation `members`; relations initially have no bbox because
computing nested relation envelopes is a later dependency-expansion job.

The init scripts run only when the `postgis-data` Docker volume is first
created. To discard all imported development data and initialize again:

```powershell
docker compose down -v
```
