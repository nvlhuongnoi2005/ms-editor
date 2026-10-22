# Map Service Editor

Frontend lives in [`editor-web`](editor-web). It is a custom, dependency-free
WebGIS/GeoData-style editor UI; no iD source is included. Its interaction model
uses the requirements in [`docs/requirements.md`](docs/requirements.md):
local preview graph, tags/topology inspection, undo/redo, changesets, revision,
and an asynchronous render-queue status after save.

Build and run the React editor with the Go API server:

```text
npm start
```

Then open `http://127.0.0.1:4173`. The Go service exposes graph and changeset
endpoints on the same origin; it reads `infra/.env` for Canonical PostGIS.

The viewport graph query uses the `editor.entity_current` GiST envelope index.
For an existing database, apply `infra/init/03-editor-performance.sql` once to
add the two visible-node/visible-way partial GiST indexes. Fresh Docker volumes
receive it automatically. Set `EDITOR_ENSURE_INDEXES=1` only when the API is
allowed to create missing indexes at startup.

## Data infrastructure

The local PostGIS, Render DB and Canonical PBF importer live in
[`infra`](infra). Follow [its setup guide](infra/README.md) before connecting
the editor to real data.
