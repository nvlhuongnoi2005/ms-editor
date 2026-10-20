# Kiến trúc nền tảng iD refactor

## 1. Mục đích

Nền tảng mới là một ứng dụng chỉnh sửa dữ liệu OSM độc lập dựa trên giao diện
iD. Ứng dụng nhận dataset ban đầu dưới dạng **OSM PBF**, cho phép sửa
node/way/relation/tag, xem preview tức thời trong browser, phát hành raster và
vector tile sau khi lưu, đồng thời rollback ba changeset gần nhất trên từng
dataset.

Nền tảng không ghi trực tiếp vào output của `osm2pgsql`. `osm2pgsql` được dùng
để tạo read model tối ưu cho render; database canonical là nguồn sự thật cho
biên tập.

## 2. Quyết định kiến trúc

| Quyết định | Lý do |
| --- | --- |
| Dataset đầu vào là `.osm.pbf` | Giữ được primitive OSM và topology đầy đủ. |
| Canonical DB tách Render DB | Tránh ghi vào các bảng `planet_osm_*` nội bộ của osm2pgsql. |
| iD Graph là preview cục bộ | Drag, undo/redo và validation không tạo ghi tạm trên server. |
| API tương thích OSM API 0.6 | Giảm phần iD cần fork; giữ được mô hình node/way/relation/changeset. |
| Save phát sinh `.osc` | Cập nhật Render DB incremental bằng `osm2pgsql --append`. |
| Tile render bất đồng bộ sau commit | Save nhanh, retry được, không có transaction dữ liệu bị phụ thuộc renderer. |
| Giữ 3 changeset đảo được/dataset | Rollback nhất quán cho nhiều entity trong cùng một lần Save. |
| Auth được đặt sau ranh giới API | Giai đoạn đầu dùng local development identity; không mở API ghi ra Internet. |

## 3. Toàn cảnh hệ thống

```text
                              OSM PBF
                                |
              +-----------------+------------------+
              |                                    |
              v                                    v
      Canonical importer                     osm2pgsql --create --slim
              |                                    |
              v                                    v
  Canonical PostgreSQL/PostGIS                 Render PostgreSQL/PostGIS
  node/way/relation/changeset                  planet_osm_* / flex tables
              |                                    |
              | OSM API 0.6                         | MVT/raster query
              v                                    v
          Editor API <---- outbox ---- Tile worker / renderer
              |                                    |
              v                                    v
      iD refactor frontend                  tile manifest + cache/artifacts
              |                                    |
              +--------- browser map -----------+---+
                                                |
                                      raster / vector tile layer
```

Hai database có thể chạy trên cùng PostgreSQL cluster trong môi trường nhỏ,
nhưng cần tách database hoặc ít nhất tách schema, role và connection pool.

## 4. Các thành phần

### 4.1 `editor-web`

Là iD được host như một frontend độc lập.

- Dùng iD Graph/History cho preview, undo/redo và validation.
- Lấy feature thô từ Editor API theo `bbox`.
- Dùng tile raster/MVT làm basemap hoặc lớp dữ liệu đã publish.
- Ở zoom edit, Graph có thứ tự hiển thị cao hơn tile.
- Cấu hình endpoint bằng `ID_API_CONNECTION_URL` và
  `ID_API_CONNECTION_API_URL`.

### 4.2 `editor-api`

Service ghi dữ liệu và là OSM API adapter.

- Đọc primitive theo bbox cho iD.
- Nhận changeset, kiểm tra version và cập nhật dữ liệu nguyên tử.
- Lưu audit before/after, version, revision và outbox event.
- Trả `diffResult` tương thích OSM API.
- Không render tile trong request Save.

### 4.3 `canonical-importer`

Nạp PBF ban đầu vào Canonical DB.

- Đọc node, way, relation, tags, thứ tự node/member và metadata PBF.
- Tạo baseline revision `0` hoặc `1` cho dataset.
- Chỉ đánh dấu dataset `ready` khi topology hoàn chỉnh và index đã xong.

### 4.4 `render-sync-worker`

Chuyển thay đổi canonical thành input cho Render DB.

- Tạo một `.osc` cho mỗi changeset đã commit.
- Chạy `osm2pgsql --append --slim` tuần tự theo revision trên mỗi dataset.
- Không được bỏ qua revision; job thất bại phải retry đúng revision.
- Chỉ đánh dấu Render DB bắt kịp khi `render_revision = canonical_revision`.

### 4.5 `tile-worker`

Tạo hoặc invalidates tile sau khi Render DB cập nhật.

- Tính bbox cũ và mới của mọi entity trong changeset.
- Mở rộng dependency tới parent way/relation/multipolygon.
- Đánh dấu tile dirty theo profile và zoom.
- Tạo MVT và raster artifact, rồi publish atomically vào manifest.

### 4.6 `tile-gateway`

Phục vụ tile đã publish, TileJSON và manifest.

- Trả ETag theo `style_revision + tile_revision`.
- Không để browser truy cập DB, object storage hay đường dẫn file cache.
- MVP có thể chạy cùng Editor API; production nên tách process/replica.

## 5. Data model

### 5.1 Canonical DB

Schema dưới đây là logical schema. Cần dùng `entity_type + entity_id` làm khóa
vì node, way và relation có không gian ID độc lập.

```text
dataset
  id, name, state, canonical_revision, render_revision, created_at

entity_current
  dataset_id, entity_type, entity_id, version, visible, tags
  node_lon_e7, node_lat_e7                  -- node
  node_refs bigint[]                        -- way, giữ đúng thứ tự
  members jsonb                             -- relation: type/ref/role/sequence
  bbox geometry(Polygon, 4326)
  changeset_id, updated_at
  PRIMARY KEY (dataset_id, entity_type, entity_id)

changeset
  id, dataset_id, status, comment, author_id
  base_revision, committed_revision, created_at, closed_at

entity_change
  changeset_id, sequence, entity_type, entity_id, operation
  before_payload jsonb, after_payload jsonb
  bbox_before geometry, bbox_after geometry
  PRIMARY KEY (changeset_id, sequence)

dataset_revision
  dataset_id, revision, changeset_id, committed_at
  PRIMARY KEY (dataset_id, revision)

outbox_event
  id, dataset_id, revision, type, payload jsonb
  created_at, published_at, attempt_count
```

`before_payload` và `after_payload` phải chứa toàn bộ tags/topology, không chỉ
PostGIS geometry. Đây là dữ liệu cần thiết để rollback an toàn.

### 5.2 Render DB

Render DB được osm2pgsql sở hữu.

```text
planet_osm_point
planet_osm_line
planet_osm_polygon
planet_osm_roads
planet_osm_nodes / planet_osm_ways / planet_osm_rels   -- slim middle
osm2pgsql_properties
```

Hoặc dùng flex output để tạo bảng chuyên cho MVT/raster. API editor và code
rollback không ghi trực tiếp vào các bảng này.

### 5.3 Tile metadata

```text
tile_dirty
  dataset_id, profile, z, x, y, target_revision, priority, reason
  PRIMARY KEY (dataset_id, profile, z, x, y)

tile_manifest
  dataset_id, profile, z, x, y
  tile_revision, style_revision, artifact_key, etag, published_at
  PRIMARY KEY (dataset_id, profile, z, x, y)
```

## 6. Luồng dữ liệu

### 6.1 Nạp dataset lần đầu

```text
PBF upload
  -> validate checksum, extent, định dạng
  -> canonical-importer tạo Canonical DB baseline
  -> osm2pgsql --create --slim tạo Render DB
  -> build tile ban đầu
  -> dataset = ready
```

Không dùng MBTiles hoặc vector tile để bootstrap canonical data. Chúng không
đảm bảo còn đầy đủ node order, member role và tag cần cho chỉnh sửa.

### 6.2 Mở iD

```text
Browser tải iD
  -> tải raster/MVT nền phù hợp zoom
  -> GET /api/0.6/map.json?bbox=...
  -> Editor API đọc Canonical DB
  -> iD merge node/way/relation vào Graph
```

iD chỉ tải graph cho vùng nhìn thấy/zoom chỉnh sửa, không tải toàn bộ PBF về
browser.

### 6.3 Preview

```text
drag node / đổi tag / sửa relation
  -> iD History tạo Graph mới trong memory
  -> renderer vẽ preview ngay
  -> Canonical DB, Render DB và tile không đổi
```

Tại zoom edit, tile dữ liệu trùng feature đang sửa cần được ẩn/giảm opacity để
không hiển thị đồng thời geometry cũ và preview mới.

### 6.4 Save

```text
iD osmChange
  -> Editor API khóa entity theo (type, id)
  -> kiểm tra quyền, topology, tag policy, optimistic version
  -> transaction: entity_current + changeset + entity_change + revision + outbox
  -> commit
  -> diffResult trả về iD
  -> render-sync-worker tạo .osc và cập nhật osm2pgsql
  -> tile-worker tạo MVT/raster revision mới
  -> tile manifest publish + event thông báo client
```

Nếu version client khác bản hiện tại, API trả `409 Conflict`; iD tải entity mới
và chạy quy trình merge/conflict resolution hiện có.

## 7. API contract tối thiểu

Ưu tiên OSM API 0.6 để iD ít thay đổi nhất.

```text
GET  /api/capabilities.json
GET  /api/0.6/map.json?bbox=minLon,minLat,maxLon,maxLat
GET  /api/0.6/node/{id}
GET  /api/0.6/way/{id}/full
GET  /api/0.6/relation/{id}/full
PUT  /api/0.6/changeset/create
POST /api/0.6/changeset/{id}/upload
PUT  /api/0.6/changeset/{id}/close

GET  /tiles/{dataset}/{profile}/{z}/{x}/{y}
GET  /tiles/{dataset}/{profile}/manifest
GET  /events/datasets/{dataset}
```

Trong development chưa có login, API chỉ bind localhost và gán `author_id` cố
định `local-admin`. Không để chế độ này xuất hiện trên deployment công khai.

## 8. Tile raster, vector và cache

### Vector tile

- Sinh MVT từ Render DB hoặc flex tables.
- Thuộc tính feature tối thiểu: `osm_type`, `osm_id`, `version`.
- Dùng ở zoom thấp/trung bình và làm lớp published data.

### Raster tile

- Giai đoạn đầu nên dùng imagery/basemap tĩnh; không cần re-render khi edit.
- Nếu raster chứa dữ liệu OSM edited, raster worker render sau Render DB sync.
- Không dùng raster dữ liệu ở zoom edit nếu không có cơ chế mask feature cũ.

### Cache

Tile cache key phải có dataset, profile, style revision và tile revision:

```text
/tiles/dataset-a/vector/16/54639/31684?v=207
/tiles/dataset-a/raster-base/14/13659/7903?v=91
```

MVP có thể dùng `canonical_revision` trong query string. Production nên dùng
tile-level revision/manifest để một thay đổi nhỏ không invalidate mọi tile.

## 9. Version, conflict và rollback

### Optimistic locking

- Mỗi entity có `version` tăng đơn điệu khi create/modify/delete.
- Changeset gửi version gốc của entity.
- API kiểm tra version trong transaction; mismatch trả `409`.

### Giữ ba changeset/dataset

- Mỗi dataset có tối đa ba changeset còn `before_payload` để đảo ngược.
- Khi changeset thứ tư commit, payload rollback của changeset cũ nhất được
  purge sau khi transaction mới thành công.
- Counter `entity.version` và audit revision không bị reset khi purge.

### Rollback

Rollback không sửa history cũ. Nó tạo một changeset mới dùng `before_payload`
của changeset mục tiêu. Nếu entity đã bị changeset sau sửa, rollback phải trả
conflict hoặc yêu cầu operator resolve rõ ràng.

## 10. Triển khai theo pha

### Phase 0 — Chuẩn bị

- Chọn PostgreSQL/PostGIS version, dung lượng PBF, phạm vi dataset.
- Chọn PBF importer và style `osm2pgsql`/flex.
- Viết fixtures PBF nhỏ để test topology và tile.

### Phase 1 — Dataset read-only

- Tạo Canonical DB importer và Render DB importer.
- Implement `capabilities`, `map?bbox`, read entity/full.
- Cấu hình iD trỏ tới local Editor API.
- Kiểm tra iD tải/chọn node, way, relation đúng.

### Phase 2 — Editing core

- Implement changeset, diffResult, optimistic locking và validation.
- Lưu audit `entity_change`.
- Chỉ bind API ở localhost bằng `local-admin`.
- Kiểm tra create/modify/delete và conflict hai browser.

### Phase 3 — Render sync và MVT

- Sinh `.osc`, serialize job theo dataset.
- Chạy `osm2pgsql --append --slim`.
- Tạo tile dirty, MVT, ETag và tile manifest.
- Đảm bảo save không chờ render.

### Phase 4 — Raster và version UX

- Thêm raster data renderer nếu cần.
- Thêm event SSE/WebSocket refresh tile.
- Thêm UI xem ba changeset và rollback.

### Phase 5 — Production hardening

- OAuth/OIDC, role `viewer/editor/rollback/admin`.
- Rate limit, backup/restore, metrics, alert cho outbox/render lag.
- Object storage/CDN, worker replica và test recovery từ PBF + changeset.

## 11. Tiêu chí nghiệm thu

- iD nạp đúng node/way/relation từ Canonical DB tại bbox đang xem.
- Preview kéo node xuất hiện ngay và không thay tile trước Save.
- Save thành công tạo revision duy nhất, `.osc`, render sync và tile dirty.
- Save lỗi không để entity/change set/revision dở dang.
- Hai client sửa cùng entity: một client nhận `409`, không mất dữ liệu.
- Tile vector/raster không bao giờ biểu diễn revision chưa commit.
- Rollback khôi phục đủ tags, node order và relation role cho ba changeset
  gần nhất của đúng dataset.
- Re-import PBF + replay changeset tái tạo được cùng canonical revision.

## 12. Rủi ro cần quản lý

| Rủi ro | Cách xử lý |
| --- | --- |
| Ghi trực tiếp vào `planet_osm_*` | Cấm bằng DB role và chỉ cấp quyền ghi Render DB cho osm2pgsql worker. |
| Render DB chậm hơn canonical | Expose `render_revision`; retry outbox theo thứ tự revision. |
| Relation làm dirty diện tích lớn | Giới hạn priority, phân nhỏ job và hiển thị trạng thái render lag. |
| Cache trả tile cũ | ETag + tile revision/manifest; cache key không dùng URL artifact mutable. |
| PBF import thiếu metadata | Vẫn gán baseline version trong Canonical DB; ghi rõ nguồn/import timestamp. |
| Development API không auth | Chỉ bind `127.0.0.1`, không expose ingress/public port. |
