# Đề xuất bổ sung và tối ưu ENC — 13/11/2026

## Thay đổi đã thực hiện trong lượt này

Đã bỏ ô vuông nét đứt khi rê chuột: xóa DOM overlay, cập nhật vị trí và CSS liên
quan. Con trỏ vẫn báo đối tượng có thể chọn. Chỉ đối tượng đã chọn có bounding
box để kéo/đổi kích thước. Không thay cơ chế chọn, Undo/Redo hoặc lưu.

## Cơ sở đánh giá

Rà mã frontend ENC, API tile/workspace và kiểm tra quyền biến đổi. Các đề xuất
dưới đây chưa phải kết quả benchmark mới và chưa được triển khai trong lượt này.
Không suy ra số người đồng thời từ tổng số 3.000 tài khoản. Cần đo số tab đang mở,
số người xem bản đồ đồng thời và tỷ lệ người đang biên tập.

| Ưu tiên | Nội dung | Hiện trạng và phương án | Mức thay đổi |
|---|---|---|---|
| P1 | Tự phục hồi polling | `EncPreview.tsx` chỉ lên lịch lần kế tiếp sau fetch thành công; catch hiện chỉ đặt thông báo lỗi. Bổ sung retry có backoff và jitter, phục hồi khi online/focus, giảm hoặc tạm dừng ở tab ẩn. Giữ nhịp nhanh khi thực sự đang import. | Nhỏ |
| P1 | Cache tile và gộp truy vấn trùng | API ENC trả `Cache-Control: no-store`. Đo truy vấn tile lặp rồi thêm cache có giới hạn dung lượng/TTL và gộp các yêu cầu đồng thời cùng khóa. Khóa phải bao gồm z/x/y, revision/catalog, dataset/cell và tham số an toàn. Workspace vẫn kiểm tra quyền và dùng phạm vi cache riêng; không public-cache nội dung riêng. | Vừa |
| P1 | Giải thích quyền kéo/resize | Hiện API trả `canMove`, giao diện chỉ giải thích chung. Trả mã lý do như dùng chung cạnh, dùng chung nút, thiếu primitive, SOUNDG hoặc Face. Hiển thị lý do ngay cạnh đối tượng và các thao tác đang khả dụng. | Nhỏ–vừa |
| P1 | Đo hiệu năng thực tế | Ghi thời gian tải tile, truy vấn DB, lấy đối tượng, commit và khôi phục workspace; theo dõi p50/p95, bytes, timeout, CPU/RAM và số kết nối DB. Tạo kịch bản pan/zoom và sửa cùng cell. Không log token hoặc nội dung nháp. | Vừa |
| P2 | Tối ưu tra cứu topology | `exclusiveEdgesSQL` và truy vấn quyền hiện duyệt JSON primitive và quan hệ đầu mút. Chạy EXPLAIN ANALYZE trên cell lớn, rồi cân nhắc bảng liên kết feature–primitive và edge–node có index. Dùng revision bất biến để tránh tính lại toàn bộ quan hệ trên từng lần chọn/lưu. Giữ kiểm tra server khi commit. | Vừa–lớn |
| P2 | Chọn đối tượng chồng nhau | Hit-test hiện ưu tiên symbol, rồi line, rồi fill. Bổ sung danh sách chọn khi nhiều đối tượng cùng vị trí, hoặc chuyển lựa chọn bằng phím. Hiển thị lớp, tên, cell và ảnh ký hiệu để tránh sửa nhầm LIGHTS/LNDMRK/FOGSIG đồng vị trí. | Vừa |
| P2 | Snap và nhập biến đổi chính xác | Bổ sung bắt dính đỉnh/cạnh với khoảng cách theo pixel; nhập độ dịch chuyển theo mét và tỷ lệ %. Chỉ bật khi dữ liệu cần thiết đã tải đủ. Việc bắt dính không tự trao quyền sửa nút dùng chung. | Vừa |
| P2 | Giảm tải workspace lớn | API hiện trả toàn bộ document khi mở workspace; giới hạn hiện tại là 1.000 override và 500 thay đổi/lần lưu, payload POST 4 MiB. Đo kích thước phản hồi, thời gian parse/IndexedDB, rồi cân nhắc tải tăng dần theo version hoặc tách danh sách và geometry. Không tăng giới hạn trước khi đo. | Vừa |
| P2 | Khung thao tác với hình học phức tạp | Khung đã chiếu bốn góc phạm vi; bỏ SVG phụ khi vượt 4.096 đỉnh. Tiếp tục đo bước chuẩn bị lựa chọn và biến đổi khi thả chuột; chỉ chuyển phần tính toán sang worker nếu main thread thực sự bị chặn. Gộp cập nhật camera trong một animation frame khi cần. | Nhỏ–vừa |
| P2 | Bổ sung biểu diễn còn thiếu | Snapshot audit trước ghi nhận 2.158/129.187 đối tượng địa lý chưa có layer phù hợp. Chạy lại audit sau mỗi lần thay dữ liệu; ưu tiên theo mức ảnh hưởng hàng hải, không chỉ theo số lượng đối tượng. Đối chiếu LUT/CSP, không tự thay bằng icon gần giống. | Theo từng nhóm |
| P3 | Biên tập topology dùng chung | Muốn kéo cả đối tượng dùng chung cần tải đủ nhóm liên kết, biến đổi nguyên tử và xác thực toàn bộ cạnh/nút liên quan. Cell có Face hiện bị chặn theo cách bảo thủ. Không mở khóa chỉ bằng việc đổi `canMove` ở frontend. | Lớn |
| P3 | Quy trình rà soát và công bố | Bổ sung diff trước/sau, duyệt bản biên tập, quyền theo người/nhóm, lịch sử theo người thực hiện, xử lý nguồn cập nhật và công bố revision. Hiện workspace dùng khóa truy cập, chưa phải hệ phân quyền tài khoản đầy đủ. | Lớn |
| P3 | Kiểm tra sản phẩm và xuất ENC | Bổ sung quy tắc nghiệp vụ, kiểm tra S-58 và bộ xuất `.000`/chuỗi update có kiểm tra topology/metadata. Việc chỉnh được geometry hoặc có atlas đầy đủ không đồng nghĩa file ENC đầu ra đạt chuẩn. | Lớn |

## Thứ tự đề xuất

1. Sửa polling phục hồi, thêm lý do khóa thao tác và số đo API/tile.
2. Đo cell lớn; triển khai cache/gộp yêu cầu trước, tối ưu truy vấn topology theo
   query plan thực tế. Chọn hạn mức đồng thời và pool DB theo số đo.
3. Bổ sung chọn đối tượng chồng nhau, snap và nhập dịch chuyển/tỷ lệ chính xác.
4. Triển khai từng nhóm biểu diễn còn thiếu, sau đó lập dự án riêng cho topology,
   công bố và xuất ENC đạt quy tắc sản phẩm.

## Cách đánh giá kết quả

- So sánh cùng cell, zoom, thiết bị và tập thao tác trước/sau; tách cache lạnh/nóng.
- Đo thời gian từ click đến có khung chọn, từ thả chuột đến geometry cập nhật và
  commit được xác nhận. Phân biệt thời gian UI với thời gian DB/network.
- Mô phỏng mất kết nối, reload trong lúc lưu, hai tab và nguồn có revision mới.
- Cache phải giảm lượt tính tile mà vẫn cô lập workspace và thay đúng phiên bản.
- Mỗi tối ưu phải giữ nguyên tọa độ, Z, lỗ/vòng, receipt lưu và Undo/Redo.

Hướng dẫn tính năng hiện tại: [chọn và biến đổi đối tượng](enc-edit-transforms.md).
