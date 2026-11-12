# Tối ưu OSM cho hệ thống có khoảng 3.000 tài khoản

Số tài khoản không đồng nghĩa số phiên đồng thời. Giữ kiến trúc API Go,
Canonical/Render PostgreSQL và worker hiện tại. Bản thay đổi này giảm tải theo
từng luồng; không phải chứng nhận sức chịu tải 3.000 phiên đồng thời.

## Các thay đổi

| Luồng | Cách xử lý |
|---|---|
| Publish status | Poll 3 giây khi pending/rendering, 60 giây khi ổn định; jitter ±10%, backoff lỗi tối đa 60 giây, timeout 15 giây, dừng khi tab ẩn, kiểm tra ngay khi quay lại |
| Sau khi Save/Revert | Refresh ngay, giữ cửa sổ polling nhanh thêm 15 giây để vượt qua độ trễ cache server; các refresh đồng thời được gộp |
| Dialog import/export | Poll nhanh khi có job hoạt động, 60 giây khi không còn job hoạt động; dừng khi tab ẩn, refresh khi quay lại, backoff lỗi |
| SQL trạng thái | Chỉ join outbox chưa publish, dùng partial index hiện có; không aggregate cả lịch sử; chọn dataset ready mới nhất theo tên |
| Cache server | LRU mặc định 64 MiB/process, gộp request cùng key, tối đa 64 cache miss đang chạy, timeout producer 20 giây; một client hủy không làm hủy các client còn chờ |
| Tile | Metadata dataset cache 1 giây; tile cache 30 giây theo dataset ID, schema, render revision, z/x/y; ETag phân biệt tile; giữ HTTP revalidation 30 giây |
| Status | Cache dùng chung trong API process 2 giây; response browser `no-store` |
| Graph API | Một snapshot `REPEATABLE READ READ ONLY` cho revision và dữ liệu của mỗi response; timeout 20 giây; gzip mức nhanh khi client chấp nhận; giữ nguyên schema JSON |
| MapLibre | Cập nhật diff cho thay đổi nhỏ, full update khi đổi phần lớn dữ liệu; chỉ một source update chạy, giữ snapshot mới nhất đang chờ; bỏ cập nhật không đổi dữ liệu hiển thị |
| Multipolygon | Tính lại khi support thay đổi, kể cả relation không thay đổi; diff vẫn xử lý holes và khôi phục ring khi relation bị bỏ |
| Con trỏ | Snapping, hover hit-test và drag preview tối đa một lần mỗi animation frame; click/mouseup vẫn xử lý tọa độ thực của event |
| Snapping | Spatial index cho node và segment của graph snapshot; lọc bounding box rồi tính khoảng cách chính xác; giữ thứ tự ưu tiên khi bằng khoảng cách |
| Viewport cache | Tối đa 8 vùng và ngân sách ước lượng 12 MiB, TTL 60 giây; revision mới từ publish status làm hết hạn cache và tải lại vùng hiện tại |
| Undo | Giữ tối đa 150 transaction hoặc khoảng 16 MiB theo ước lượng, luôn giữ transaction mới nhất; bản thay đổi chưa lưu và baseline vẫn giữ để Save đúng |
| Save | Batch các INSERT audit trong cùng transaction; giữ nguyên version checks, topology lock, revision và outbox; timeout upload changeset 60 giây gồm thời gian chờ DB |
| Export | Giới hạn tổng job queued/running mặc định 16; dùng lại file cùng revision; worker riêng có giới hạn CPU/RAM; download vẫn streaming + Range/resume |

## Giới hạn và tính nhất quán

- Cache chỉ chia sẻ giữa người dùng đi qua **cùng API process**. Nhiều replica
  có cache riêng; ngân sách RAM nhân theo số replica. Không thêm Redis/SSE.
- Metadata tile có thể chậm tối đa khoảng 1 giây, status khoảng 2 giây, ngoài
  chu kỳ polling. Tile HTTP vẫn có độ trễ cache 30 giây như trước. Dirty/deleted
  entities tiếp tục được frontend che tile cũ ngay.
- Client idle có thể phát hiện sửa đổi của người khác sau khoảng 60 giây;
  kiểm tra version khi Save vẫn là lớp bảo vệ cuối, không dựa vào cache.
- Mỗi response graph nhất quán nội bộ; geometry và relation là hai response
  riêng nên vẫn kiểm tra revision trước khi ghép chúng.
- Ngân sách viewport/undo là **ước lượng**, không phải hard limit RSS. Một
  thao tác rất lớn vẫn được giữ để Undo lần gần nhất; số entity đang sửa,
  baseline, source MapLibre và GPU còn chiếm bộ nhớ riêng. Không cắt dữ liệu
  chưa lưu để đạt giới hạn bộ nhớ.
- Lịch sử quá 150 bước/ước lượng dung lượng được bỏ ở đầu; không còn Undo
  đến trước phần đã bỏ. Save vẫn xuất toàn bộ thay đổi hiện tại so với baseline.
- Snapping index gắn với graph bất biến; xây lại graph khi geometry thay đổi.
- Topology validation vẫn tuần tự trong một dataset để bảo vệ phụ thuộc.
  Batch audit giảm round trip nhưng không loại bỏ giới hạn ghi này.
- File PBF ready không tự xóa vì có thể đang được tải tiếp. Quản trị viên
  quản lý dung lượng `data/exports`; xem `pbf-export.md`.
- Không thay đổi phân quyền hoặc triển khai danh tính người dùng. Khi bổ sung
  quyền đọc khác nhau theo người dùng, cache phải được phân vùng theo quyền.

## Cấu hình

`infra/compose.yaml` và `deploy/compose.yaml` truyền các biến sau:

| Biến | Mặc định |
|---|---|
| `EDITOR_READ_CACHE_MIB` | `64`; `0` tắt lưu cache nhưng vẫn gộp request; tối đa `1024` |
| `CANONICAL_DB_POOL_MAX_CONNS` | `16` mỗi API |
| `RENDER_DB_POOL_MAX_CONNS` | `16` mỗi API |
| `ENC_DB_POOL_MAX_CONNS` | `4` mỗi API |
| `EDITOR_EXPORT_MAX_PENDING` | `16`, gồm queued + running toàn hệ thống |
| `EDITOR_EXPORT_CPUS` | `1.0` CPU, Compose |
| `EDITOR_EXPORT_MEMORY_LIMIT` | `2g`, Compose |

Native Go cũng hỗ trợ `<CANONICAL_DB/RENDER_DB/ENC_DB>_POOL_MIN_CONNS`, mặc định
0. Render worker dùng tối đa 4 connection mặc định. Pool có connect timeout
5 giây, idle lifetime 5 phút và connection lifetime có jitter khoảng 30 phút.
Export bị OOM sẽ được xử lý như worker bị ngắt; xem log, tăng giới hạn nếu cần
và tạo lại job. Không bảo đảm mọi dataset đều nằm trong 2 GiB.

Tính tổng pool của mọi API/worker trên cùng PostgreSQL trước khi tăng replica;
không tăng `max_connections` theo số tài khoản. Chừa connection cho quản trị
và các Python worker. Cấu hình Compose CPU/RAM cần kiểm tra trên máy triển khai.

## Kiểm tra đã bổ sung

- DB test cô lập: 50 request status đồng thời chỉ có 1 query status; 50 request
  cùng tile chỉ có 1 query dựng MVT. Fixture có 5.000 event lịch sử để kiểm tra
  không đếm lỗi đã publish. Đây là kiểm tra cơ chế cache, không phải benchmark
  50 người dùng thực hoặc cam kết latency.
- Gzip graph, revision và batch audit chạy trên PostgreSQL/PostGIS thật.
- Snapping được đối chiếu với tìm kiếm toàn bộ trên graph ngẫu nhiên cố định;
  có segment dài, node thiếu, biên khoảng cách và tie.
- Polling dùng fake clock kiểm tra chu kỳ 60/3 giây, pause/resume, refresh trùng
  và bỏ response sau khi unmount. Cache client và giới hạn undo có regression
  test, gồm Save sau khi history bị trim.
- Map diff kiểm tra geometry, metadata không đổi, xóa entity, thay đổi member
  của multipolygon và holes. Browser kiểm tra lại selection/zoom và draft.

```powershell
cd editor-web
node --test scripts/osm-performance.test.mjs scripts/graph-loading.test.mjs scripts/topology.test.mjs
npm run build:react
node scripts/zoom-browser-smoke.mjs
cd ../editor-api
go test ./...
go vet ./...
# Chỉ trỏ biến sau vào DB kiểm tra dùng riêng, có schema Canonical.
$env:EDITOR_PERFORMANCE_TEST_DB_URL = 'postgres://user:password@host:port/canonical?sslmode=disable'
go test ./cmd/editor-api -run TestPerformanceReadsAndBatchCommitIntegration -count=1 -v
```

## Đo tải trên staging

Script đọc bằng Node không gửi Save/Import/Export và không nhận URL mặc định:

```powershell
# Từ thư mục ms-editor, chọn dataset/vùng thật trên staging.
$env:EDITOR_LOAD_URL = 'http://staging-host:4173'
$env:EDITOR_LOAD_DATASET = 'your-dataset'
$env:EDITOR_LOAD_BBOX = '105,21,105.01,21.01'
$env:EDITOR_LOAD_USERS = '50'
$env:EDITOR_LOAD_SECONDS = '300'
node scripts/performance/osm-read-load.mjs
```

Tăng lần lượt 50 → 150 → 300 phiên giả lập sau khi kiểm tra cấu hình DB và
máy phát tải. Script đo p50/p95/p99 HTTP, lỗi và byte body sau giải nén (không
phải byte trên đường truyền); không đo GPU, heap browser hay thời gian paint.
Vùng/tile dùng chung cho kịch bản cache nóng; thử nhiều tiến trình với bbox
khác nhau để đánh giá vùng ít trùng. Không suy ra công suất sản xuất từ fixture.
Workload ghi đồng thời cần benchmark riêng trên bản sao dataset, gồm conflict,
deadlock, lock wait, retry và tính đúng topology. Không chạy ghi vào dữ liệu thật.

Theo dõi CPU/RSS API, `pg_stat_activity`, lock wait, I/O, tuổi outbox chưa publish,
RAM browser sau phiên dài và tốc độ export khi người khác biên tập. Không tự
chạy script tải lên hệ thống đang phục vụ người dùng.
