# ENC domain

`ENC/` chứa tài sản và hợp đồng riêng cho luồng Electronic Navigational Chart.
Nó không dùng model node/way/relation, importer hoặc renderer của OSM.

Biên tập cơ bản đã có workspace theo cell, sửa thuộc tính/điểm, lưu riêng và
khôi phục bản nháp. Xem [hướng dẫn biên tập ENC](../docs/enc-editing.md).

## Xem ENC local

### Import từ giao diện

Nút **Dữ liệu / Import ENC** mở dialog quản lý giống luồng OSM: danh sách đã xử
lý, chọn ZIP hoặc trực tiếp một file cell `.000`, tên lần nhập, tiến độ upload và
tác vụ gần đây. ZIP thường không mật khẩu, tối đa 100 MiB và 2 GiB giải nén; cell
`.000` trực tiếp tối đa 100 MiB. ZIP được kiểm tra có cell gốc, không trùng đường
dẫn/cell và chuỗi update liên tiếp trong cùng thư mục. Cell `.000` lẻ được nhập
không kèm update; muốn áp dụng update hãy tải ZIP chứa cả chuỗi. Client và API
kiểm tra cấu trúc cùng header ISO 8211, sau đó worker GDAL xác thực S-57 trước
khi công bố. Tiếp nhận file không đồng nghĩa với việc hải đồ đã được công bố.
Tên lần nhập kiểm tra trùng ở cả client và API.

Upload có phần trăm và có thể hủy. Tác vụ worker hiển thị trạng thái riêng, không
giả lập phần trăm import. Có thể xem lần nhập trên bản đồ hoặc xóa lần nhập lỗi.

### Region và mức chi tiết

`GET /api/enc/regions?dataset=<uuid tùy chọn>` trả vùng phủ và điểm đặt nhãn
của chính các cell local đang được xem. Tên vùng lấy từ mô tả `CATALOG.031`,
ví dụ `Lake Michigan - Manitowoc, WI`; thiếu mô tả thì dùng mã cell.
Metadata gồm file nguồn, mã cell, producer, edition/update và tỷ lệ biên tập.
Đường biên dùng `M_COVR` trừ vùng không có dữ liệu, dự phòng bằng bounds.
Không dùng 9 vùng định sẵn của OpenENC. Migration `08-enc-regions.sql` gỡ các
định nghĩa tham khảo đã cài trước đó; endpoint được suy ra từ kho ENC local.

Zoom dưới 9 hiển thị vùng phủ; nhãn tên vùng và mã cell hiện tới zoom 12,
có tránh chồng nhãn. Bấm vùng hoặc nhãn để xem metadata và phạm vi hải đồ.
Khung cell vẫn hiển thị khi zoom gần.
Từ zoom 9, ký hiệu phao/đèn, nhãn và SOUNDG được phép hiển thị. Viewer xem trước
đối tượng điểm sớm hơn SCAMIN; với các lớp khác, SCAMIN được nới hệ số 4 và điều
kiện tỷ lệ cell dùng hệ số 32. Đây là quy tắc xem trước, không thay đổi dữ liệu nguồn.
Đến trước zoom 16, SOUNDG lấy một giá trị nông nhất mỗi ô lưới màn hình (64 px
ở zoom 9–11, 40 px ở zoom 12–13, 24 px ở zoom 14–15). Từ zoom 16 không lọc lưới;
MapLibre vẫn tránh chồng nhãn. Có nhãn đường đồng sâu và điểm nhỏ đại diện phao/đèn
ngay cả khi icon bị tránh chồng. Khung cell mờ dần tới zoom 14.
Thanh điều khiển có thể thu gọn, mặc định thu gọn trên màn hình nhỏ.
Tỷ lệ màn hình dùng thế giới 512 pixel ở zoom 0 và vĩ độ tâm tile trong phép
chiếu Web Mercator. Đây là profile viewer, chưa tương đương toàn bộ symbology Njord.

ENC mặc định mở **Tất cả hải đồ đã công bố**, ghép cell từ nhiều lần upload.
Chọn lần nhập chỉ là bộ lọc kiểm tra và quản lý; upload mới bổ sung vào danh mục
chung khi worker hoàn tất. Xem mô hình phiên bản, quy tắc trùng/xung đột và hướng
dẫn nâng cấp trong [CATALOG.md](CATALOG.md).

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

Giao diện nhận ZIP S-57 hoặc một file cell `.000` (mỗi file tối đa 100 MiB),
tạo job và theo dõi trạng thái. Worker GDAL kiểm tra archive, cell trùng, update
thiếu và checksum trước khi ghi dữ liệu; với `.000` lẻ, GDAL đọc cell gốc không
có update. Dataset chỉ được mở để đọc khi toàn bộ import đã commit.
Các đường đọc dành cho viewer; thao tác lưu dùng workspace riêng theo
[enc-editing.md](../docs/enc-editing.md). Chưa xuất ngược S-57.

Chạy queue worker từ thư mục gốc:

```powershell
docker compose -f infra/compose.yaml --profile enc up -d --build --no-deps enc-import-worker
```

Upload và xóa dataset không yêu cầu token quản trị.

## Import thủ công

Đặt archive tại `data/enc/` rồi chạy từ `infra/`:

```powershell
docker compose --profile tools run --rm enc-importer --zip /data/enc/OneWeek_ENCs.zip --dataset noaa-one-week
```

Có thể truyền trực tiếp một cell `.000`; hãy dùng ZIP nếu cần áp dụng chuỗi update:

```powershell
docker compose --profile tools run --rm enc-importer --source /data/enc/US5WI32M.000 --dataset us5wi32m-base
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
đất, đường bờ, đường đẳng sâu, vùng hạn chế, sounding, phao/đèn và nhãn.
Registry sprite và phạm vi mapping được mô tả trong [SPRITES.md](SPRITES.md).
Các nhánh chọn ký hiệu đã đối chiếu catalogue S-52 PresLib 4.0(.3), gồm biến
thể theo thuộc tính/geometry, cung đèn tạo động, QUAPOS từ primitive và ngữ
cảnh độ sâu cùng cell. Safety contour mặc định 6 m chọn đường đồng sâu kế
tiếp sâu hơn nếu cần. Chi tiết phạm vi và kiểm tra nằm trong [SPRITES.md](SPRITES.md);
chưa triển khai toàn bộ LUT/CSP hoặc settings theo người dùng.

Glyph PBF lấy từ `https://openenc.com/v1/content/fonts/Roboto%20Bold/` (range
0–255, 256–511). Sprite do người dùng cung cấp từ OpenENC/Njord. Giữ provenance
và license của tài sản nguồn khi đóng gói phân phối.
