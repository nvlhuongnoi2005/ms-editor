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

To inspect primitive counts without writing to PostgreSQL:

```powershell
docker compose run --rm canonical-importer --count-only --pbf /data/vietnam-260901.osm.pbf
```

## Vietnam OSM editor dataset

`data/vietnam-260901.osm.pbf` is mounted in the importer container as
`/data/vietnam-260901.osm.pbf`. Load it into the Canonical DB with:

```powershell
docker compose up -d postgres
docker compose run --rm canonical-importer --pbf /data/vietnam-260901.osm.pbf --dataset-name vietnam-260901
```

The editor is configured to request this dataset name. The command prints the
dataset UUID and may take a while because it imports nationwide OSM primitives.
It creates a new dataset alongside existing samples; it does not replace them.

## Satellite tile service

Start the tile server used by the editor's satellite background with:

```powershell
docker compose --profile tiles up -d tile-server
```

It serves TileJSON at:

```text
http://localhost:8081/datas/satellite.json
```

Stop only this local tile service with:

```powershell
docker compose --profile tiles stop tile-server
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

## Publish worker

After importing both Canonical and Render databases, start the API and the
render-sync worker together:

```powershell
docker compose up -d editor-api render-sync-worker
```

The worker consumes committed Canonical changesets in revision order, writes a
temporary `.osc`, then runs `osm2pgsql --append --slim --hstore` against the
Render DB. It retries failed jobs with exponential backoff and only advances
`render_revision` after the render and vector-tile invalidation manifest have
been committed. The worker never blocks a Save request.

For an existing Docker volume, apply the additive Canonical migration before
starting the worker:

```powershell
Get-Content .\init\04-publish-pipeline.sql | docker compose exec -T postgres psql -U postgres -d postgres
```

To verify the queue and published revision:

```powershell
docker compose exec postgres psql -U canonical_owner -d canonical -c "SELECT name, canonical_revision, render_revision FROM editor.dataset;"
docker compose exec postgres psql -U canonical_owner -d canonical -c "SELECT id, revision, attempt_count, rendered_at, published_at, last_error FROM editor.outbox_event ORDER BY id DESC LIMIT 10;"
```

The init scripts run only when the `postgis-data` Docker volume is first
created. To discard all imported development data and initialize again:

```powershell
docker compose down -v
```
