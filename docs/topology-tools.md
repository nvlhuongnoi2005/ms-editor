# Công cụ topology

Chọn way trên bản đồ để mở **Công cụ topology** trong bảng thuộc tính.
Click một vertex (điểm tròn) hoặc chọn node trong danh sách; vertex đang chọn
được tô vàng. Kéo quá 3 pixel mới được tính là di chuyển node.

| Thao tác | Cách dùng | Kết quả |
| --- | --- | --- |
| Tách way | Chọn đỉnh giữa của đường mở, bấm Tách way | Giữ ID/version đoạn đầu, tạo ID âm cho đoạn sau, cập nhật relation |
| Nối way | Chọn way thứ hai trong danh sách endpoint, bấm Nối | Giữ ID way đang chọn, nối node refs/hình học, xóa way thứ hai, cập nhật relation |
| Tách node khỏi way | Chọn vertex, bấm Tách node | Tạo node cùng tọa độ cho way đang chọn; node cũ giữ POI tags và membership |
| Đảo chiều | Bấm Đảo chiều | Đảo refs/hình học, đổi tag hướng được hỗ trợ và role forward/backward |
| Xóa đỉnh khỏi way | Chọn vertex, bấm Xóa đỉnh | Bỏ ref khỏi way; giữ nguyên node entity cho các way/relation khác |
| Tiếp tục từ endpoint | Chọn đầu/cuối của đường mở, bấm Tiếp tục | Click thêm điểm, Enter hoàn tất, Esc hủy; giữ ID/tags/chiều của way |

Mỗi thao tác là một transaction local, Ctrl+Z/Ctrl+Shift+Z hoàn tác/làm lại
toàn bộ thay đổi node/way/relation. Dữ liệu được ghi server khi bấm Lưu.

## Điều kiện bảo toàn dữ liệu

- Split/merge chỉ áp dụng cho đường mở. Không tách tại node lặp hoặc endpoint.
- Merge cần hai way chung đúng một endpoint và thuộc tính thống nhất. Tag
  chỉ có trên một way cũng cần thống nhất trước, tránh mở rộng nhầm ý nghĩa
  như bridge/tunnel sang toàn bộ đường sau khi nối.
- Parent relation được tải bằng endpoint chỉ đọc `/api/topology/way-parents`
  khi thực hiện split/merge/reverse, không phụ thuộc giới hạn vùng nhìn thấy.
  API phải được khởi động lại sau khi cập nhật backend.
- Hỗ trợ cập nhật member của route, multipolygon và boundary. Với route,
  split/merge yêu cầu role forward/backward rõ ràng; merge yêu cầu hai member
  liền nhau và đúng thứ tự đi qua. Restriction và relation khác cần xử lý thủ công.
- Đảo chiều hỗ trợ oneway, incline, direction và khóa có thành phần
  forward/backward hoặc left/right. Các trường hợp hướng chưa hỗ trợ được
  báo lỗi để xử lý thủ công, gồm tag điều kiện, tag làn phức tạp, waterway,
  coastline, cliff và một số công trình có hướng.
- Xóa đỉnh giữ tối thiểu 2 node cho đường hoặc 3 đỉnh riêng biệt cho vòng kín.
  Không tự xóa node rời: node có thể thuộc đối tượng ngoài vùng tải.
- Backend tiếp tục kiểm tra toàn bộ topology/geometry/relation và version
  trước khi commit. Bản gốc của entity đang sửa được giữ khi pan/zoom để
  payload không biến modify thành create hoặc mất thông tin delete.

## Kiểm tra

Trong `editor-web`: `npm run test:topology` và `npm run build:react`.
Trong `editor-api`: `go test ./...`.

Kiểm thử endpoint trên DB local (chỉ đọc) có thể bật bằng biến môi trường
`EDITOR_TEST_DB=1` và chạy `go test ./cmd/editor-api -run TestWayParentsReadIntegration -v`.
