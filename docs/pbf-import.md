# Upload PBF và quản lý dataset

Mở **Dữ liệu / Import PBF** trên thanh công cụ. Chọn snapshot `.osm.pbf`, nhập
tên dataset mới (1–80 chữ cái ASCII, chữ số hoặc `-`), rồi bấm **Upload và tạo
dataset**. Upload xong, có thể đóng dialog: job nằm trong PostgreSQL và tiếp tục
chạy ở worker, không phụ thuộc trình duyệt.

## Luồng xử lý

```text
Upload streaming → queued → canonical → render → indexing → ready
                              └──────── lỗi ────────────→ failed → retry
```

- API lưu file theo UUID, ghi checksum SHA-256 và tạo dataset/job trong một
  transaction. Tên dataset đã tồn tại bị từ chối, không có replace ngầm.
- Worker dùng canonical importer hiện có, giữ ID/version, tags, thứ tự node và
  relation member. Location index dùng file trên đĩa thay vì giữ hết trong RAM.
- Import render bằng `osm2pgsql --create --slim --hstore` vào schema
  `import_<UUID không dấu gạch>`, riêng cho mỗi dataset, không dùng schema render
  của dataset đang hoạt động.
- Hoàn thiện index và statistics trước khi đánh dấu cả dataset/job `ready`
  trong cùng transaction. Không hiển thị graph sẵn sàng khi render còn dở.
- UI hiển thị phần trăm **upload**, sau đó hiển thị stage và số primitive đã nhập;
  không giả định một phần trăm tổng cho việc import PBF.
- Nút **Mở trong editor** đặt bản đồ theo bounds đã nhập, đổi cả graph, MVT,
  snapshots/conflict, changeset/history và export sang dataset được chọn.
  Dataset lớn có thể mở ở zoom thấp; phóng đến Z16 để biên tập.
- Không cho đổi dataset khi còn bản nháp, đang vẽ, Save, conflict hoặc chưa đóng
  xong changeset. Chuyển dataset hợp lệ sẽ tạo EditorStore/cache/map mới.
- Publish worker lấy `render_schema` từ dataset của outbox event, nên Save sau
  import không append vào schema render của dataset khác.

## Chạy trên máy phát triển

1. Khởi động lại API để chạy migration bổ sung và phục vụ UI mới:

   ```powershell
   npm start
   ```

2. Chạy import worker trong terminal khác, từ thư mục gốc:

   ```powershell
   docker compose --file infra/compose.yaml up -d --build import-worker
   ```

API native mặc định lưu file ở `data/imports`; container mount đúng thư mục này.
Chưa có worker thì upload vẫn vào hàng đợi, UI hiển thị cảnh báo. Khi Save cần
publish tile, chạy worker đã build từ source mới:

```powershell
docker compose --file infra/compose.yaml up -d --build render-sync-worker
```

Lệnh này xử lý cả các event publish đang chờ, không chỉ dataset mới.

## Chạy API bằng Docker

Chạy API và worker:

```powershell
docker compose --file infra/compose.yaml up -d --build editor-api import-worker render-sync-worker
```

Không chạy API native và API Docker cùng cổng 4173. Upload, xem và retry job
không yêu cầu token quản trị.

API startup tạo migration idempotent từ
`editor-api/cmd/editor-api/imports_schema.sql`. Nếu muốn migration trước khi chạy
worker hoặc account API không có quyền DDL, chạy bằng account quản lý schema:

```powershell
Get-Content editor-api/cmd/editor-api/imports_schema.sql |
  docker compose --file infra/compose.yaml exec -T postgres psql -X -v ON_ERROR_STOP=1 -U canonical_owner -d canonical
```

## API và cấu hình

| Endpoint | Chức năng |
| --- | --- |
| `GET /api/datasets` | Dataset ready, bounds và revision |
| `GET /api/imports` | 100 job gần nhất, giới hạn upload và heartbeat worker |
| `POST /api/imports?dataset=<name>` | Multipart với một field `file`; trả 202 |
| `POST /api/imports/<uuid>/retry` | Chỉ retry job failed, không retry dataset đã hoạt động |

Các thao tác ghi import yêu cầu `X-Editor-Import: 1`. Origin khác bị từ chối.
API không yêu cầu token quản trị và không giới hạn kết nối ở loopback.

| Biến | Mặc định |
| --- | --- |
| `EDITOR_IMPORT_DIR` | API native: `../data/imports`; Docker: `/var/lib/map-service/imports` |
| `EDITOR_IMPORT_MAX_BYTES` | 10 GiB; giới hạn cả stream phía server |
| `IMPORT_RENDER_CACHE_MB` | 256 |
| `IMPORT_RENDER_PROCESSES` | 1 |
| `IMPORT_RENDER_TIMEOUT_SECONDS` | 21600 |

Worker xử lý tuần tự, dùng advisory lock để ngăn hai worker xử lý cùng queue.
Worker khởi động lại đánh dấu job đang chạy dở là failed để quản trị viên retry.
Checksum và UUID/schema ownership được kiểm tra lại trước khi xử lý. Retry chỉ
ghi lại dữ liệu chưa từng được kích hoạt của chính job đó. PBF lỗi, empty hoặc
thiếu node của way không được kích hoạt. Relation của extract có thể thiếu
member ngoài vùng; kiểm tra dependency khi biên tập vẫn áp dụng.

## Lưu trữ và giới hạn hiện tại

- File upload và dữ liệu failed được giữ để retry/đối soát; chưa có tự động xoá
  hoặc endpoint xoá dataset. Cần dự trù dung lượng file, canonical, slim/render
  và location index, đồng thời đặt chính sách lưu trữ khi triển khai thực tế.
- Không nhập history `.osh.pbf`, không merge/replace dataset đang dùng và không
  upload lên máy chủ OpenStreetMap công cộng.
- Với các dataset legacy từng import bằng CLI trùng tên, UI chỉ liệt kê bản
  ready mới nhất của mỗi tên, khớp cách API hiện tại phân giải dataset.
- Import và publish worker cần phiên bản `osm2pgsql` tương thích. Khi nâng cấp,
  kiểm tra cả baseline import và append trên dữ liệu thử trước khi triển khai.

## Kiểm tra

```powershell
cd editor-web
npm run test:editor
npm run build:react
cd ../editor-api
go test ./...
go vet ./...
$env:EDITOR_TEST_DB = '1'
go test ./...
```

`imports_test.go` kiểm tra header PBF, giới hạn file, origin, schema MVT,
fuzz input và prepare câu SQL claim publish (không nhận event thật).
`datasets.test.mjs` kiểm tra parser, multipart/progress và nhất quán dataset
trong các request. Fixture nhỏ nằm ở `OSM/importer/tests`; chỉ dùng với
database thử riêng. Browser smoke opt-in tại
`editor-web/scripts/import-browser-smoke.mjs` cần API fixture ở cổng 4174 với
hai dataset ready; kiểm tra chuyển dataset và giữ bản nháp, không bấm Save.
