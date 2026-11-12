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
6. Dialog chỉ theo dõi UUID do chính phiên trình duyệt yêu cầu tạo file,
   qua `GET /api/exports/<uuid>`. Không tải/render lịch sử hoặc log worker.
   Lỗi chỉ hiện cảnh báo của tác vụ đang chọn; đóng/mở lại không hiện lỗi cũ.
   Worker đếm tổng entity `visible` trong cùng snapshot, rồi cập nhật số đã
   xuất khoảng mỗi giây. Giao diện hiển thị phần trăm, số đã xuất/tổng số và
   thanh tiến độ có animation (tôn trọng tùy chọn giảm chuyển động).
7. `GET` hoặc `HEAD /api/exports/<uuid>/file` phục vụ file bằng Go
   `http.ServeContent`: `Content-Length`, `Accept-Ranges`, `ETag`, `If-Range`,
   HTTP 206/416 và `X-Checksum-SHA256`. Không dùng `fetch().blob()` hoặc
   `arrayBuffer()` cho toàn file, không giữ 30–100 GB trong JavaScript.

## Tạm dừng, tiếp tục và xóa cache tải dở

Trên Chrome/Edge desktop ở localhost hoặc HTTPS, **Tải .osm.pbf** bắt đầu
managed download. Dedicated worker đọc từng HTTP Range tối đa 32 MiB, kiểm tra
status 206, Content-Range và ETag. Mỗi response được stream trực tiếp xuống
OPFS bằng sync access handle; không gom cả đoạn vào mảng RAM. Sau mỗi đoạn,
flush dữ liệu rồi ghi checkpoint nhỏ. UI cập nhật tối đa 4 lần/s.

- Trong khi tải có đúng hai nút điều khiển: **Tạm dừng** và **Xóa**.
  **Tạm dừng** abort kết nối, bỏ phần đuôi chưa checkpoint, giữ cache trên đĩa;
  chính nút đó đổi thành **Tiếp tục** ở cùng vị trí để chạy tiếp.
- **Reload** hủy worker cũ. Mở lại dialog chỉ phục hồi metadata ở trạng thái
  tạm dừng; không GET file hay tự tạo export. **Tiếp tục** mới gửi Range từ
  checkpoint. Tối đa một đoạn 32 MiB có thể cần tải lại sau khi bị ngắt.
- **Xóa** abort stream, đóng file rồi xóa `data.partial` và
  `checkpoint.json`. Không giữ dữ liệu để phục hồi sau reload. Đây là cache
  local; không xóa PBF dùng chung trên server của những người đang tải khác.
- Khi tải đủ, worker đọc lại file tạm theo khối 1 MiB, tính SHA-256 tăng dần
  và đối chiếu checksum của export trên server. Có tiến độ kiểm tra riêng;
  không gọi `crypto.subtle.digest` với toàn bộ file. Sai checksum vẫn giữ
  trạng thái chưa xác nhận và cảnh báo, không cho lấy file/lưu PBF hoàn chỉnh.
- **Tạm dừng/Dừng/Reload** cũng áp dụng khi đang kiểm tra checksum. Tiếp tục
  kiểm tra sẽ đọc lại cache từ đầu, không tải lại dữ liệu đã đủ. Kết quả xác
  nhận chỉ giữ trong worker hiện tại; sau reload phải kiểm tra lại trước khi
  lưu. `@noble/hashes` cung cấp SHA-256 tăng dần chạy trong dedicated worker.
- Chỉ khi checksum khớp mới có **Lưu tệp về máy** để chọn vị trí. Stream từ
  snapshot file đã xác nhận sang file đích; lưu thành công mới xóa cache.
  Hủy hộp chọn hoặc lỗi lưu vẫn giữ cache để thử lại. Reload trong lúc lưu
  không tự lưu tiếp. Tên file đích được commit khi writable stream đóng.
  Nếu tạm dừng trong bước lưu, nút cũng đổi thành **Tiếp tục**. Tiếp tục dùng
  lại nơi lưu đã chọn, ghi lại từ cache đã xác nhận, không tải lại từ server.
- Web Lock ngăn hai tab ghi/xóa cùng cache. Cache nhận diện theo browser và
  dataset, nên đóng tab rồi mở lại vẫn có thể tiếp tục; lỗi không được lưu
  vào cache. Đổi origin/port/browser/profile không dùng chung cache.

OPFS chịu quota lưu trữ của trình duyệt. Kiểm tra `storage.estimate()` trước
khi tải và xử lý lỗi quota trong khi ghi; `storage.persist()` xin giữ dữ liệu
nhưng không bảo đảm được cấp quyền. Cần chỗ cho **cache + bản lưu cuối cùng**,
có thể gần gấp đôi kích thước PBF. Không cam kết mọi browser đều chứa được
100 GB; quota/đĩa thiếu sẽ giữ checkpoint và cảnh báo. Người dùng có thể dừng
để dọn cache. Khi gặp lỗi hoặc thiết bị thiếu API hỗ trợ, có nút **Tải bằng
trình duyệt**, với pause/resume do mục Downloads quản lý.

FileSystemWritableFileStream thường ghi vào file tạm và chỉ commit khi close;
`keepExistingData` còn sao chép file hiện tại. Vì vậy không mở/đóng writer
file đích sau mỗi đoạn: với 100 GB có thể dẫn đến sao chép lặp lại và reload
mất phần chưa commit. Xem [File System Standard](https://fs.spec.whatwg.org/)
và [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).

## Tiến độ xuất trên server

Phần trăm đo theo **số đối tượng**, không phải dung lượng file hay thời gian
còn lại. Việc đếm chính xác cần thêm một lượt đọc DB; trong lúc đếm, giao diện
hiển thị thanh chờ. Sau khi xuất đủ đối tượng, hệ thống còn tính checksum và
hoàn tất file; chỉ khi file sẵn sàng mới có nút tải.

Nút **Xóa** ở bước tạo PBF gọi `POST /api/exports/<uuid>/cancel` với header và kiểm tra
origin như tạo tác vụ. Tác vụ chờ được hủy ngay. Tác vụ đang chạy giữ trạng thái
đang dừng cho đến khi worker ngắt truy vấn/ghi/hash, xóa file dở và xác nhận
`cancelled`; sau đó mới cho tạo tác vụ tiếp theo. Worker kiểm tra hủy mỗi giây,
kể cả khi đang đếm dữ liệu lớn. Thời gian dọn file/đóng writer còn phụ thuộc
DB và đĩa. Nếu file đã chuyển `ready` trước yêu cầu dừng, API trả 409 và giữ
file hoàn chỉnh. Đóng dialog không hủy xuất. Với nút tải dự phòng, việc dừng
tải file về máy dùng trình quản lý download của trình duyệt.

Với trình duyệt hoặc công cụ tải ngoài, khả năng tự resume phụ thuộc client;
có thể dùng download manager hỗ trợ HTTP Range với
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

Nếu `/api/exports/<uuid>/cancel` trả 404 với thông báo `Export route was not
found.`, API đang chạy vẫn là bản cũ. Build frontend không cập nhật process Go
đang chạy. Với API native, nhấn Ctrl+C ở terminal chạy API/`npm start`, rồi
chạy lại `npm start` từ gốc repo (hoặc `go run ./cmd/editor-api` từ `editor-api`
nếu frontend đã build). Cập nhật worker ở terminal khác:

```powershell
docker compose --file infra/compose.yaml up -d --build --no-deps export-worker
```

Sau đó tải lại trang. API mới tự thêm các cột tiến độ/hủy khi khởi động, không
cần sửa dữ liệu hoặc chạy SQL thủ công. Thay worker khi đang xuất sẽ ngắt
snapshot cũ; tác vụ đó không tự tiếp tục hay tự tạo lại. Các chỉnh sửa đã lưu
trong dataset vẫn giữ nguyên. API phải được khởi động lại cùng bản frontend
mới để hỗ trợ endpoint theo dõi đúng một tác vụ.

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
  lệ và đọc offset vượt 4 GiB; endpoint bbox cũ trả 410; GET một tác vụ không
  trả log worker và trả 404 nếu UUID không tồn tại.
- `editor-web/scripts/exports.browser.mjs`: Chrome thật, OPFS thật, API giả
  lập với file 64 MiB. Kiểm tra không tải lịch sử; cảnh báo đúng phiên; pause,
  reload không tự resume; Range tiếp tục đúng offset/ETag; lưu đối chiếu
  SHA-256; xóa cache khi lưu hoặc dừng, cả desktop lẫn mobile.
  Có trường hợp cố tình đổi byte nhưng giữ nguyên kích thước và ETag: worker
  phải phát hiện checksum sai và không cung cấp nút lưu. Kiểm tra tạm dừng
  ngay trong bước hash rồi tiếp tục mà không phát sinh request tải file.
- `OSM/importer/tests/test_export.py`: dùng DB Canonical **riêng để kiểm tra**,
  bật `EDITOR_EXPORT_TEST=1`, cấu hình `DB_*`. Đọc lại PBF bằng pyosmium để
  kiểm tra node ở xa, way, relation, thứ tự member, tag/version, entity đã
  xóa và snapshot nhất quán khi có chỉnh sửa đồng thời.
- Chưa thay thế benchmark thực tế trên dataset 30–100 GB. Khi nghiệm thu,
  theo dõi RSS của worker/API/browser và ngắt mạng rồi resume để kiểm tra
  file cuối cùng khớp SHA-256.
