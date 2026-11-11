# Bộ sprite ENC mở rộng

Các file `day_simplified@2x`, `dusk_simplified@2x`, `night_simplified@2x`
(JSON và PNG) tại thư mục này là **đầu ra đang được ứng dụng sử dụng**.
Mỗi theme có 499 ô ảnh, pixelRatio 2, atlas 2048×961.

## Thành phần và nguồn

- `base/`: 232 ảnh/theme được cung cấp ban đầu, đã sửa metadata FSHFAC03.
  Đây là đầu vào để đóng gói lại; không phải atlas mở rộng đang chạy.
  Packer giữ nguyên pixel, kích thước và metadata stretch của các ảnh gốc.
- `sources/svg/`: 263 SVG nguyên bản từ
  [Njord](https://github.com/manimaul/njord) tại commit
  `88ddaceecb7ef14f1cf7d65ade55eab69c007292`, thư mục `sprites/svg` và
  `sprites/svg_unused`. README nguồn dẫn tới
  [OpenS100](https://github.com/S-100ExpertTeam/OpenS100).
  Các SVG này giữ giấy phép [MPL-2.0](sources/LICENSE-MPL-2.0.txt).
- `sources/manifest.json`: đường dẫn upstream, SHA-256, loại SY/AP, ý nghĩa
  và trang đối chiếu catalogue cho từng SVG. Chỉ lấy các tên đã đối chiếu với
  catalogue S-52 4.0(.3) người dùng cung cấp; loại các tên chưa xác nhận.
- `sources/colors.json`: palette upstream cho day/dusk/night.
- `sources/lines/`: 4 SVG texture do viewer dựng cho cáp ngầm, hai loại ống và
  công trình bờ có vị trí không chắc chắn. Key `LC_` phân biệt với SY/AP.
  Các hình này chuyển từ cách dựng Canvas trước đây, chưa phải triển khai đầy đủ LC/HPGL.
- `additions.json`: metadata sinh khi đóng gói, bao gồm pivot của SVG mới.

Giấy phép Apache-2.0 của mã Njord không thay thế MPL-2.0 của các SVG bổ sung,
cũng không thay đổi nguồn gốc của atlas do người dùng cung cấp.

## Tạo lại JSON và PNG

Chạy từ gốc repository, cần Node.js và Google Chrome:

```powershell
node ENC/tools/build_sprites.mjs
```

Có thể đặt biến `CHROME_BIN` nếu Chrome nằm ở vị trí khác. Không cần tải mạng
hoặc cài npm package khi đóng gói. Packer dùng Chrome để rasterize SVG với palette
từng theme, giữ viewBox và khoảng trống chứa pivot; các ảnh gốc được sao chép
không đổi kích thước. Các ô ảnh được xếp cùng tọa độ ở cả ba theme, có gutter 2 px.
Packer kiểm tra ảnh mới không rỗng và tạo đủ ba theme trước khi thay đầu ra.

Khi thay atlas cần thay đồng thời JSON và PNG, đồng thời tăng phiên bản cache URL
trong style và bảng ký hiệu. Không sử dụng JSON trong `base/` với PNG đầu ra mới.

## Phạm vi sử dụng

Bảng ký hiệu đọc toàn bộ 499 mục. Một số mô tả mới giữ tiếng Anh theo catalogue.
Các texture đường cố định được đọc trực tiếp từ atlas; cung đèn với góc và màu
theo dữ liệu vẫn được dựng động trong `lightSectors.ts`.
Chỉ thêm lựa chọn ảnh vào renderer khi đã có quy tắc thuộc tính tương ứng;
số lượng ảnh không phải số lớp hoặc số quy tắc đã triển khai.
Bộ bổ sung này chưa xác nhận toàn bộ LUT/CSP hoặc sự phù hợp S-52 đầy đủ.
