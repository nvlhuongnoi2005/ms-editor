# Map Service Editor

Frontend lives in [`editor-web`](editor-web). It is a custom, dependency-free
WebGIS/GeoData-style editor UI; no iD source is included. Its interaction model
uses the requirements in [`docs/requirements.md`](docs/requirements.md):
local preview graph, tags/topology inspection, undo/redo, changesets, revision,
and an asynchronous render-queue status after save.

Run it locally:

```text
npm start
```

Then open `http://127.0.0.1:4173`.
