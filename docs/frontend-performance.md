# Tải trang và thao tác bản đồ

Các tối ưu này áp dụng cho cả OSM và ENC khi chạy qua API Go.

## Build và phân phối tài nguyên

`npm run build:react` trong `editor-web` kiểm tra TypeScript, chạy Vite và tạo
bản `.gz` cho HTML, JavaScript, CSS, JSON và SVG khi nén có lợi. Cần triển khai
cả thư mục `dist`, bao gồm các file `.gz`. API chọn bản gzip theo
`Accept-Encoding`; trình duyệt không hỗ trợ gzip vẫn nhận file gốc.

HTML dùng `Cache-Control: no-cache` để trình duyệt kiểm tra phiên bản mới.
Tài nguyên trong `assets/` do Vite tạo có tên chứa hash nội dung, được cache
một năm với `immutable`. Khi triển khai phiên bản mới, nên giữ tài nguyên có
hash của phiên bản trước để các tab đang mở vẫn tải được công cụ khi cần.
Không đặt file có tên cố định, có thể thay đổi nội dung trong `dist/assets/`.
Đây là cache tài nguyên giao diện; dữ liệu biên tập vẫn theo chính sách API.

Các bảng quản lý dữ liệu, lịch sử, xung đột, khóa hình học, xác nhận thay đổi
OSM và các bảng import/ký hiệu ENC tải khi mở. Trong lúc tải có trạng thái chờ
và nút đóng. Lỗi tải công cụ được giữ trong bảng, bảo toàn màn làm việc.
Bộ dựng SVG của biểu tượng POI OSM chỉ tải khi cần biểu tượng chi tiết từ Z18.

## Cập nhật bản đồ

- Tọa độ con trỏ OSM cập nhật thành phần thanh trạng thái riêng. Màn biên tập
  nhận cập nhật mức zoom khi zoom thay đổi; rê chuột không render lại toàn màn.
- ENC chỉ kiểm tra đối tượng dưới con trỏ tối đa một lần mỗi khung hình.
  Click vẫn kiểm tra ngay vị trí thực tế của sự kiện.
- ENC luôn hiển thị tất cả danh mục đối tượng, vẫn áp dụng quy tắc mức zoom.
  Giao diện không còn bộ chọn danh mục và các trường ngưỡng an toàn; thiết lập
  cũ trong localStorage không được sử dụng. Safety depth và safety contour dùng
  giá trị mặc định 6 m; đường đồng sâu khả dụng vẫn được chọn theo từng cell.

## Phạm vi số liệu

Kích thước chunk và file gzip trong log build phản ánh dung lượng tài nguyên.
Chúng không phải số đo thời gian mở trang hoặc FPS. Tốc độ thực tế còn phụ
thuộc mạng, dữ liệu trong vùng nhìn, thời gian truy vấn tile và GPU của máy.
Các bộ preset OSM và thư viện bản đồ vẫn là những chunk lớn cần theo dõi.

Sau khi cập nhật mã Go, khởi động lại API để áp dụng header nén và cache mới.
Chế độ Vite dev không dùng chính sách phân phối file của API Go.
