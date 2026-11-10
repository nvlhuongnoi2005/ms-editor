# ENC domain

`ENC/` chứa tài sản và hợp đồng riêng cho luồng Electronic Navigational Chart.
Nó không dùng model node/way/relation, importer hoặc renderer của OSM.

## Xem ENC local

### World baselayer

Nền ENC local dùng vector MBTiles tại
`infra/tile-server-data/mbtiles/world-baselayer/world-baselayer.mbtiles`.
Tile-server phục vụ nguồn `world-baselayer`; Editor API chuyển tiếp tile qua
`/enc/basemap/{z}/{x}/{y}.pbf`. API native dùng tile-server tại
`http://127.0.0.1:8081`; Docker dùng `http://tile-server:8080`.
Có thể đổi địa chỉ upstream bằng `ENC_BASEMAP_TILE_SERVER_URL`.

File nền do người dùng cung cấp có hai lớp `HANHCHINH_THEGIOI` (polygon)
và `DIADANH_HANHCHINH_THEGIOI` (nhãn), zoom 0–7. MapLibre phóng tiếp dữ liệu
zoom 7 khi xem gần; không có thêm chi tiết đường bờ ở zoom lớn.
Màu nền theo theme ENC, các lớp hải đồ được vẽ phía trên. Nền vẫn hiện khi
chưa chọn dataset. File MBTiles là dữ liệu local và được gitignore.

Khởi động tile-server bằng `docker compose -f infra/compose.yaml --profile tiles up -d tile-server`.

### Dataset ENC

Mở `http://localhost:5173/?mode=enc` khi chạy frontend development, hoặc
`http://localhost:4173/?mode=enc` khi chạy bản build. Chọn dataset để xem toàn bộ
tile MVT lấy trực tiếp từ PostGIS. Palette, sprite và glyph của chế độ local
được phục vụ từ repo; chế độ “OpenENC demo” vẫn có thể chọn riêng để đối chiếu.

Mặc định **Tất cả cell · tự động**: pan/zoom tải tile của các cell trong vùng nhìn.
Bộ chọn cell vẫn dùng được để kiểm tra riêng. Ở mức zoom tổng quan (dưới 9),
đường viền tím thể hiện phạm vi cell; đây không phải dữ liệu nền bổ sung.
ZIP tuần chỉ có các cell được phân phối trong tuần, nên vùng không có dữ liệu
vẫn trống; muốn phủ rộng cần nhập bộ ENC đầy đủ cho khu vực đó.

Viewer chọn tỷ lệ biên tập từ `DSPM_CSCL`, dùng `SCAMIN` để lọc chi tiết theo zoom,
và ghép vùng phủ `M_COVR` (`CATCOV=1` trừ `CATCOV=2`). Trong phần chồng lấn,
cell chi tiết hơn được ưu tiên; tên cell phân định khi cùng tỷ lệ. Nếu thiếu
vùng phủ, dùng bounds của cell làm phương án dự phòng. Chế độ kiểm tra một cell
bỏ lọc tỷ lệ để xem dữ liệu nguồn. Đây là quy tắc viewer với tỷ lệ xấp xỉ theo zoom,
chưa phải bộ quy tắc trình bày S-52 đầy đủ. Không cần import lại dataset cũ.

Giao diện nhận ZIP S-57 (tối đa 100 MiB), tạo job và theo dõi trạng thái. Worker
GDAL riêng kiểm tra archive, cell trùng, update thiếu và checksum trước khi
ghi dữ liệu. Dataset chỉ được mở để đọc khi toàn bộ import đã commit.
Các đường đọc hiện tại dành cho viewer, chưa cung cấp Save hay export S-57.

Chạy queue worker từ thư mục gốc:

```powershell
docker compose -f infra/compose.yaml --profile enc up -d --build --no-deps enc-import-worker
```

Upload và xóa dataset không yêu cầu token quản trị.

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
`POST /api/enc/imports?dataset=<name>`. POST không yêu cầu token quản trị;
gateway kiểm tra origin và header `X-Editor-Import: 1` cho các thao tác ghi.

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
