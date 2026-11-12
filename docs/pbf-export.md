# Xuất và tải toàn bộ dataset OSM PBF

Menu **Xuất tệp → Tải toàn bộ dữ liệu (.osm.pbf)** thay cho xuất `.osm` theo
bbox. Endpoint cũ `/api/export/osm` trả HTTP 410. Xuất changeset `.osc` vẫn giữ.

## Luồng dữ liệu

1. `POST /api/exports?dataset=<name>` tạo hoặc dùng lại tác vụ đang chờ/chạy.
   Request cần header `X-Editor-Import: 1`, cùng kiểm tra origin như import.
2. Worker riêng chọn tác vụ; mở transaction `REPEATABLE READ READ ONLY`, đọc
   `canonical_revision` và xuất toàn bộ entity `visible` của dataset. Revision
   được chốt **khi worker bắt đầu đọc**, không phải khi bấm nút. Chỉnh sửa lưu
   sau thời điểm đó thuộc lần xuất tiếp theo; bản nháp trong trình duyệt không
   nằm trong file.
3. Đọc node → way → relation bằng server-side cursor, sắp theo entity ID.
   Không lọc bbox, không giới hạn tổng entity, không nạp geometry, không giữ
   toàn bộ dữ liệu hoặc index tọa độ trong RAM. Giữ node refs, thứ tự members,
   tag, ID và version; bỏ các entity đã xóa. Không tự tạo member bị thiếu vốn
   đã có trong extract nguồn.
4. Pyosmium ghi PBF trực tiếp vào `<job-id>.partial` bằng buffer 4 MiB; cursor
   mặc định fetch 1.000 entity/lần. Bộ nhớ còn phụ thuộc kích thước từng entity
   và buffer nén của thư viện, không tăng theo toàn bộ kích thước file.
5. Đóng writer, tính SHA-256 theo block 1 MiB, fsync rồi rename sang
   `<job-id>.osm.pbf`. Chỉ sau đó tác vụ chuyển `ready`.
6. `GET /api/exports?dataset=<name>` trả 20 tác vụ gần nhất và heartbeat worker.
   Dialog tự cập nhật và có thể đóng/mở lại mà không hủy tác vụ.
7. `GET` hoặc `HEAD /api/exports/<uuid>/file` phục vụ file bằng Go
   `http.ServeContent`: `Content-Length`, `Accept-Ranges`, `ETag`, `If-Range`,
   HTTP 206/416 và `X-Checksum-SHA256`. Download trực tiếp cho trình duyệt;
   không dùng `fetch().blob()`, không giữ 30–100 GB trong JavaScript.

Trình duyệt ghi dữ liệu xuống file tạm trên ổ đĩa trong lúc tải. Khả năng tự
resume phụ thuộc client; có thể dùng download manager hỗ trợ HTTP Range với
2–4 kết nối. File theo UUID không bị ghi đè khi có chỉnh sửa mới. Không chia
dataset theo bbox hay ghép nhiều PBF trong trình duyệt.

File `ready` ở đúng revision hiện tại được dùng lại khi yêu cầu xuất lần nữa.
Nếu file cache đã bị xóa, request xuất mới sẽ tạo lại file. Nếu worker bị ngắt,
tác vụ `running` được đánh dấu `failed` khi worker khởi động lại; tạo tác vụ
mới để đọc snapshot mới, không nối file export dở từ snapshot cũ.

## Chạy

Docker dùng chung image OSM worker nhưng chạy hai process/service riêng:

```powershell
docker compose --file infra/compose.yaml up -d --build editor-api export-worker
```

Nếu chạy API native, từ `editor-api` chạy `go run ./cmd/editor-api`; worker
Docker ở trên mount `data/exports`, cùng thư mục API native sử dụng mặc định.
Worker chờ schema export được API khởi tạo. Hoặc chạy native từ `editor-api`:

```powershell
python ../OSM/importer/export_worker.py
```

Cần cài requirements của `OSM/importer` và cấu hình `DB_*` giống importer nếu
chạy worker native. Runtime `deploy/compose.yaml`, `Start.cmd` và gói release
đã bao gồm service `export-worker`; build lại image app và OSM worker trước
khi chạy bản mới. Không cần thêm image dependency mới.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `EDITOR_EXPORT_DIR` | Native: `../data/exports`; Docker: `/var/lib/map-service/exports` | Thư mục chung; API chỉ cần quyền đọc |
| `EDITOR_EXPORT_BATCH_SIZE` | `1000`, tối đa `5000` | Số entity mỗi cursor fetch |
| `EDITOR_EXPORT_MIN_FREE_BYTES` | `1073741824` | Ngưỡng dừng khi đĩa trống dưới 1 GiB; không phải dự báo kích thước file |

## Vận hành với file 30–100 GB

- Một worker giữ advisory lock và xuất lần lượt, tránh nhiều full scan đồng
  thời. Nén và tốc độ DB/đĩa quyết định thời gian tạo file; không cam kết thời
  gian hay mức RAM cố định khi chưa benchmark dữ liệu thật.
- Chừa dung lượng cho file PBF mới, các file cũ còn giữ và file download local.
  Export lỗi được xóa file dở. File `ready` **không tự hết hạn/xóa**, để tải
  kéo dài và resume ổn định. Quản trị viên dọn file cũ trong `data/exports`
  sau khi xác nhận không còn tải; link tương ứng trả 410. Danh sách tác vụ
  vẫn giữ lịch sử, request xuất mới kiểm tra file cache còn tồn tại.
- Snapshot PostgreSQL lâu có thể giữ các version cũ và làm tăng bloat/WAL
  retention tùy cấu hình. Theo dõi DB và ưu tiên giờ thấp điểm; với tải nặng
  cân nhắc bản DB snapshot riêng. Bản triển khai này đọc Canonical trực tiếp.
- Nếu đặt reverse proxy phía trước, giữ nguyên Range/If-Range/ETag, không
  nén PBF lại, không gom toàn response trong RAM và cấu hình timeout phù hợp.
  Với Nginx proxy download có thể dùng `proxy_buffering off` và
  `proxy_read_timeout 1h`; đây là timeout giữa các lần đọc, không phải tổng
  thời gian download. API hiện phục vụ file bằng stream có seek trên đĩa.

## Kiểm tra

- Go: download đầy đủ, HEAD, Range, If-Range đúng/sai ETag, khoảng không hợp
  lệ và đọc offset vượt 4 GiB; endpoint bbox cũ trả 410.
- `OSM/importer/tests/test_export.py`: dùng DB Canonical **riêng để kiểm tra**,
  bật `EDITOR_EXPORT_TEST=1`, cấu hình `DB_*`. Đọc lại PBF bằng pyosmium để
  kiểm tra node ở xa, way, relation, thứ tự member, tag/version, entity đã
  xóa và snapshot nhất quán khi có chỉnh sửa đồng thời.
- Chưa thay thế benchmark thực tế trên dataset 30–100 GB. Khi nghiệm thu,
  theo dõi RSS của worker/API/browser và ngắt mạng rồi resume để kiểm tra
  file cuối cùng khớp SHA-256.
