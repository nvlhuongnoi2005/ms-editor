# Kiểm tra tích hợp Presentation Library — 12/11/2026

- TypeScript và production build: qua.
- Bộ frontend trước thay đổi bổ sung: 152/152 qua; ba ca mới kiểm tra cấu hình,
  tile safety context, visibility và phân màu cũng qua.
- Go `./cmd/editor-api ./internal/enc`: qua; ca tích hợp đường dẫn thư viện mới
  xác nhận 12 URL atlas, glyph, whitelist và biến thay thư mục assets.
- Auditor catalogue: 499 ảnh/theme, 231 tham chiếu runtime, 268 ảnh còn lại
  available/reserved; 466 pivot và 465 kích thước vật lý đọc từ catalogue.
- SHA-256: 290 tệp assets và PDF, hình chữ nhật atlas nằm trong biên PNG trên cả ba theme.
- Chrome thực ở 1440 và 390 px: cấu hình chỉ áp dụng khi xác nhận, chặn ngưỡng sai,
  không tràn ngang; biên tập tạo điểm, tọa độ chính xác, lưu, Undo/Redo, reload,
  retry cùng commit, xóa và bảo vệ bản nháp giữa hai tab đều qua.
- Docker target `app`: build thành công với tài sản từ thư mục mới.

Ảnh giao diện được xem trực tiếp trong lần kiểm tra; browser dùng API fixture/tile
rỗng để cô lập tương tác. Các kiểm tra trên không thay việc đối chiếu Chart 1/S-64,
không chứng minh đã triển khai đầy đủ LUT/CSP hoặc xác nhận ECDIS.
Các báo cáo coverage khác là snapshot lịch sử; không tự coi là kết quả mới với mọi dataset.
