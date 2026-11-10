# OSM domain

Luồng OSM hiện có giữ nguyên:

```text
OSM/importer/                PBF importer và worker
editor-api/                  OSM API adapter, canonical và render pipeline
editor-web/src/features/     graph editor và MapLibre canvas OSM
infra/                       PostGIS, osm2pgsql và tile background
```

Importer/worker đã chuyển vào `OSM/importer`; tên service Docker
`canonical-importer` và `import-worker` được giữ để các lệnh vận hành hiện có
tiếp tục sử dụng được. API và frontend OSM cũ hiện vẫn ở các đường dẫn trên.
