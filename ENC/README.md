# ENC domain

`ENC/` chứa tài sản và hợp đồng riêng cho luồng Electronic Navigational Chart.
Nó không dùng model node/way/relation, importer hoặc renderer của OSM.

## Xem ENC local

Mở `http://localhost:5173/?mode=enc` khi chạy frontend development, hoặc
`http://localhost:4173/?mode=enc` khi chạy bản build. Chọn dataset và cell để xem
tile MVT lấy trực tiếp từ PostGIS. Palette, sprite và glyph của chế độ local
được phục vụ từ repo; chế độ “OpenENC demo” vẫn có thể chọn riêng để đối chiếu.

Giao diện nhận ZIP S-57 (tối đa 100 MiB), tạo job và theo dõi trạng thái. Worker
GDAL riêng kiểm tra archive, cell trùng, update thiếu và checksum trước khi
ghi dữ liệu. Dataset chỉ được mở để đọc khi toàn bộ import đã commit.
Các đường đọc hiện tại dành cho viewer, chưa cung cấp Save hay export S-57.

Chạy queue worker từ thư mục gốc:

```powershell
docker compose -f infra/compose.yaml --profile enc up -d --build --no-deps enc-import-worker
```

Nhập `EDITOR_IMPORT_TOKEN` đã cấu hình trong `infra/.env` vào form upload.
Token chỉ dùng cho thao tác import và không lưu trong localStorage.

## Import ZIP thủ công

Đặt archive tại `data/enc/` rồi chạy từ `infra/`:

```powershell
docker compose --profile tools run --rm enc-importer --zip /data/enc/OneWeek_ENCs.zip --dataset noaa-one-week
```

Lệnh chỉ chạy sau khi PostGIS đã có `enc_canonical`. Với volume hiện có, chạy
một lần từ thư mục gốc (không chạy lại script tạo database OSM):

```powershell
docker compose -f infra/compose.yaml run --rm --no-deps enc-migrate
```

`ENC_DB_PASSWORD` mặc định kế thừa mật khẩu canonical để tương thích local.
Để dùng mật khẩu riêng, cấu hình biến này trước khi tạo role, hoặc thay đổi
mật khẩu role `enc_owner` tương ứng nếu role đã tồn tại. Script không đổi
mật khẩu của role đã tồn tại.

## Ownership

```text
ENC/
  sprites/       MapLibre sprite atlases theo day/dusk/night
  fonts/         glyph Roboto Bold phục vụ nhãn Latin
  importer/      GDAL worker, cell/update validation
  render/        symbology và MVT worker (bước kế tiếp)
```

Importer OSM ở `OSM/importer`. ENC HTTP handler ở `editor-api/internal/enc`,
frontend và style local ở `editor-web/src/domains/enc`. Gateway HTTP, React
theme và cụm PostgreSQL là hạ tầng dùng chung. Model OSM cũ vẫn nằm trong
`editor-web/src/features` và `editor-api/cmd/editor-api`.

API ENC: `GET /api/enc/datasets`, `GET /api/enc/cells?dataset=<uuid>`,
`GET /api/enc/tiles/{z}/{x}/{y}.pbf?dataset=<uuid>&cell=<name>`,
`POST /api/enc/imports?dataset=<name>`. POST dùng cùng cơ chế import token
và same-origin của gateway hiện tại.

`POST /api/uploads?dataset=<name>` là điểm upload chung. Gateway đọc chữ ký
file để chọn PBF/OSM hoặc ZIP/ENC, rồi chuyển nguyên stream đến handler của
domain. Đuôi file, cấu trúc và dữ liệu được từng handler/worker kiểm tra tiếp.
Form ENC hiện dùng endpoint chung này; route riêng vẫn hỗ trợ client cũ.

## Dữ liệu và hiển thị

`enc.feature` chứa geometry 2D phục vụ truy vấn và `source_geometry` giữ tọa độ
gốc kể cả Z; `enc.spatial_record` giữ primitive và linkage nguồn. Chưa có
contract biên tập topology hay đảm bảo xuất ngược ENC từ các bảng này.

Style local là profile giới hạn theo màu Njord: vùng nước theo ngưỡng 3/6/9 m,
đất, đường bờ, đường đẳng sâu, vùng hạn chế, sounding, một số phao/đèn và nhãn.
Đây chưa phải toàn bộ conditional symbology S-52. Các ngưỡng hiện cố định cho
viewer; settings theo người dùng và safety contour sẽ được thêm riêng.

Glyph PBF lấy từ `https://openenc.com/v1/content/fonts/Roboto%20Bold/` (range
0–255, 256–511). Sprite do người dùng cung cấp từ OpenENC/Njord. Giữ provenance
và license của tài sản nguồn khi đóng gói phân phối.
