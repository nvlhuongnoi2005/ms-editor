# Công cụ geometry trong menu chuột phải

## Cách sử dụng

Ở chế độ Chọn, chọn một hoặc nhiều đối tượng (Ctrl/Cmd + click), rồi chuột phải:

- **Khóa đối tượng / layer:** khóa lựa chọn hoặc một lớp Điểm, Đường, Vùng, Quan hệ. Đối tượng vẫn hiển thị nhưng không thể chọn/sửa. Nhấn **Đang khóa** trên bản đồ hoặc chuột phải → **Quản lý khóa** để xem danh sách, sau đó **Mở khóa tất cả**. Khóa thuộc phiên trình duyệt/dataset, không phải phân quyền server và không được ghi thành tag.
- **Biến đổi hình học:** Circularize cho một way khép kín; nhập bán kính mét hoặc để trống để tự tính. Xoay nhận góc độ (dương ngược chiều kim đồng hồ); Scale nhận phần trăm (100% giữ tỷ lệ). Tâm mặc định là tâm bounding box; có thể nhập kinh/vĩ độ cụ thể.
- **Căn chỉnh / Phân bố:** căn ít nhất 2 đối tượng hoặc phân bố ít nhất 3 đối tượng. Đông–Tây căn các tâm cùng tung độ; Bắc–Nam căn cùng hoành độ. Phân bố giữ hai tâm ngoài cùng, chia đều tâm còn lại, không phải chia đều khoảng trống giữa cạnh.
- **Phép toán vùng:** chọn ít nhất 2 vùng hoặc relation multipolygon; chọn tường minh vùng chính, rồi Tạo lỗ / Union / Intersection / Difference. Difference trừ mọi vùng còn lại khỏi vùng chính. Tạo lỗ yêu cầu vùng tác động ở hoàn toàn bên trong và không chạm biên.

Phép toán vùng **tạo kết quả mới, giữ nguyên nguồn**, dùng tag của vùng chính. Vùng đơn tạo way mới; kết quả nhiều phần hoặc có lỗ tạo relation `type=multipolygon` với member way `outer`/`inner` và node mới. Vùng gốc vẫn ở bên dưới nên có thể vẫn nhìn thấy dữ liệu nền trong phần lỗ. Không tự xóa nguồn hoặc hòa giải tag giữa các vùng.

## Bảo vệ dữ liệu

- Mỗi phép biến đổi/tạo vùng là một transaction undo/redo. Ctrl/Cmd+Z hoàn tác; Lưu mới ghi vào canonical DB.
- Biến đổi giữ node ID và cập nhật các way dùng chung node đã tải. Căn chỉnh tạo yêu cầu khác nhau cho cùng node sẽ bị từ chối, không âm thầm tách node.
- Khóa được kiểm tra tại reducer cho chọn, sửa thuộc tính, xóa, chỉnh node, thao tác nhiều đối tượng và undo/redo. Khóa relation bảo vệ các thành viên đã tải; khóa layer áp dụng khi dữ liệu mới được tải vào client. Không thay thế kiểm soát truy cập hoặc khóa đồng thời ở server.
- ID khóa tạm được ánh xạ sang ID canonical sau khi lưu đối tượng mới.
- Thiếu member, vòng hở/tự giao, kết quả rỗng hoặc geometry suy biến ở độ chính xác E7 sẽ không được commit.
- Tính toán biến đổi dùng hệ mét cục bộ với bán kính Trái Đất trung bình, không phải một CRS trắc địa được cấu hình. Chỉ hỗ trợ lựa chọn trong phạm vi tối đa 1° và ngoài vùng cực (|vĩ độ tâm| ≤ 85°). Đây không phải công cụ đo đạc địa chính chính xác theo ellipsoid.
- Mỗi vòng được kiểm tra tối đa 2.000 đỉnh để giới hạn chi phí kiểm tra tương tác. Các vòng multipolygon chạm nhau bị chặn theo ràng buộc canonical hiện tại. Quan hệ lồng dạng multipolygon chưa được hỗ trợ; cần member way đầy đủ.
- Backend vẫn kiểm tra toàn bộ topology, version và phụ thuộc ngoài vùng dữ liệu client đã tải khi Lưu.

Phép toán polygon dùng [polygon-clipping](https://github.com/mfogel/polygon-clipping), sau đó kiểm tra và chuyển kết quả thành topology OSM.

## Kiểm thử nhanh

1. Khóa một đường, thử click/drag/Delete và sửa node dùng chung từ đường khác; dữ liệu khóa không được thay đổi. Mở khóa rồi thử lại.
2. Khóa lớp Vùng, pan sang khu vực khác: các vùng mới tải cũng không chọn được. Đổi dataset hoặc tải lại trang sẽ kết thúc phiên khóa.
3. Circularize một vùng 4–8 đỉnh với bán kính 20 m; kiểm tra đóng vòng, node ID và Undo/Redo. Thử bán kính âm hoặc quá nhỏ: phải báo lỗi.
4. Chọn nhóm, xoay 90° và scale 150%; đối chiếu tâm, bố cục và các node chung. Thử tâm nhập thiếu: phải báo lỗi.
5. Chọn 3 đối tượng có khoảng cách lệch nhau, thử căn hàng/phân bố theo cả hai trục; hai đầu ngoài cùng của phân bố phải giữ nguyên.
6. Hai vùng giao nhau: chạy Union, Intersection, Difference với từng vùng chính; nguồn còn nguyên. Hai vùng rời nhau: Intersection báo rỗng, Union tạo nhiều outer.
7. Vùng nhỏ trong vùng lớn: Tạo lỗ tạo outer/inner. Vùng nhỏ chạm biên hoặc nằm ngoài phải bị chặn. Lưu, tải lại, kiểm tra topology; Undo trước Lưu phải gỡ toàn bộ node/way/relation mới cùng lúc.

Tự động: `npm --prefix editor-web run test:editor`, `npm --prefix editor-web run build:react`, `go test ./...` trong `editor-api`. Test DB tích hợp cần môi trường DB riêng; các kiểm tra trên không thay thế thử trình duyệt và lưu/tải lại với DB thật.
