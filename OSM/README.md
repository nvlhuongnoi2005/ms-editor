# OSM domain

Luồng OSM hiện có giữ nguyên:

```text
canonical-importer/          PBF importer và worker
editor-api/                  OSM API adapter, canonical và render pipeline
editor-web/src/features/     graph editor và MapLibre canvas OSM
infra/                       PostGIS, osm2pgsql và tile background
```

`OSM/` là điểm neo domain cho các phần OSM mới. Không chuyển ENC vào các model,
API route, database schema hoặc worker OSM.
