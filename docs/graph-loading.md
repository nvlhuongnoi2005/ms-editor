# Progressive graph loading

The editor requests `/api/graph?part=geometry` first, hydrates ways/nodes and
stops the blocking loading indicator. It then requests `part=relations` using
the same buffered bbox. Relations append to the store without rehydrating all
way geometry. The default `part=all` (or omitted part) preserves existing API
clients. Invalid parts return 400 before touching the database.

## Relation query and index

Relation candidates are the union of visible relations whose bbox intersects
the viewport and direct parents of visible entities whose bbox intersects it.
Reverse lookups use JSONB containment and the partial GIN member index. This
still finds relations with missing/stale bboxes and their offscreen parents;
member order, roles, versions and anchor computation are unchanged. Candidate
IDs are deduplicated and limited before expanding member geometry.

For an existing database, run the idempotent migration once from the repo root:

```powershell
Get-Content infra/init/05-editor-relations-performance.sql |
  docker exec -i map-service-postgres-1 psql -X -v ON_ERROR_STOP=1 -U postgres -d canonical
```

The migration creates an index concurrently, without changing OSM entities or
revisions. New Docker volumes apply it during initialization. Alternatively,
the opt-in `EDITOR_ENSURE_INDEXES=1` startup path includes the same index (that
path builds indexes non-concurrently). Restart the Go API and reload the web
app after updating the source. An older API ignores `part`; the web client
filters its response to avoid duplicates, but cannot make that old SQL fast.

## Request and render lifecycle

- Fetch starts independently of the satellite raster; map layers initialize
  on `style.load` rather than waiting for every initial map resource.
- Repeated viewport events share an in-flight request if its buffered bbox
  covers the viewport. An unchanged cached snapshot does not hydrate again.
- Changing viewport, zooming below Z16, applying a conflict resolution,
  committing, or unmounting cancels obsolete work. Late responses are ignored.
- The cache holds at most eight viewports. Failed relation loads retain usable
  geometry and can retry without refetching it. Different canonical revisions
  are never silently merged.
- Tile clicks missing from the local graph fetch an entity snapshot rather
  than another complete viewport.
- Only geometry, IDs and display properties enter the map worker; tags, node
  metadata and relation members remain in EditorStore for editing/validation.
- MVT coverage stays visible until the latest GeoJSON worker update and visible
  source tiles are ready. Dirty/deleted IDs suppress stale MVT immediately.
  Identical tile filters are not reapplied; icons remain lazy at Z18.

## Verification

```powershell
cd editor-web
npm run test:editor
npm run build:react
cd ../editor-api
go test ./...
$env:EDITOR_TEST_DB = '1'
go test ./cmd/editor-api -run 'Test(GraphRelationsCandidatesIntegration|ProgressiveGraphReadIntegration)' -v
```

The candidate integration test uses transaction-local fixtures and rolls back
all writes. It covers missing/stale relation bboxes, shared members, invisible
and missing entities, other datasets, nested relations, offscreen parent
metadata and limits. The read-only integration check logs endpoint times on
the Nam Dinh sample bbox and verifies that geometry + relations have exactly
the same IDs as the full graph. These are API measurements, not browser paint
times; browser rendering still needs a manual check on the target device.
