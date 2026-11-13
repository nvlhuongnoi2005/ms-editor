# Menu chuột phải trong biên tập ENC

Sau khi mở bản biên tập cell, bấm chuột phải vào đối tượng hoặc bounding box để
chọn đúng đối tượng và mở menu tại con trỏ. Nếu dữ liệu nguồn chưa có trong cache,
menu hiển thị trạng thái đang lấy dữ liệu và khóa lệnh cho đến khi tải xong.
Chuột phải vào nền trống mở các lệnh theo vị trí, không dùng đối tượng đang chọn
trước đó làm đích xóa/sửa.

| Nhóm | Thao tác |
|---|---|
| Chọn | Chỉnh sửa thuộc tính; tập trung khung kéo/đổi kích thước; xem toàn bộ đối tượng; bỏ chọn |
| Điểm | Sao chép; dán tại vị trí chuột phải; nhân bản lệch 24 pixel; cắt có xác nhận; thêm loại điểm đang chọn tại vị trí chuột phải |
| Kích thước | Tăng/giảm 10%; khôi phục kích thước ký hiệu điểm |
| Bản biên tập | Hoàn tác; làm lại; lưu hoặc kiểm tra lại lần lưu chưa xác nhận |
| Xóa | Mở xác nhận xóa điểm, theo đúng quyền API |

Menu dùng MUI Menu/MenuItem như OSM: định vị theo con trỏ, giới hạn kích thước theo
màn hình, hỗ trợ điều hướng bàn phím và Escape. Menu đóng khi di chuyển bản đồ,
thay style hoặc kết thúc workspace. Bấm chuột phải trực tiếp lên bounding box cũng
mở cùng menu. Đây là menu của chế độ biên tập; chế độ xem không mở các lệnh sửa.

Sao chép/nhân bản/dán chỉ áp dụng cho điểm 2D thuộc lớp được API cho phép tạo.
Chỉ sao chép thuộc tính được phép theo schema và kích thước hiển thị; định danh,
LNAM và liên kết primitive nguồn không được mang sang. Mỗi bản dán có UUID mới,
tham gia cùng luồng draft, Undo/Redo và lưu. Clipboard chỉ nằm trong bộ nhớ tab.

**Cắt điểm** sao chép vào clipboard và mở xác nhận xóa. Nếu hủy, đối tượng vẫn
giữ nguyên. Xác nhận được cuộn vào vùng nhìn trong bảng thuộc tính.

Đường/vùng đủ quyền vẫn dùng được lệnh kéo/đổi tỷ lệ, tăng/giảm kích thước và xem
toàn bộ đối tượng. Sao chép/xóa đường/vùng, nhóm, xoay, tách/gộp hoặc biên tập
primitive dùng chung chưa được mở bởi thay đổi này; không ánh xạ tùy tiện sang
các lệnh node/way/relation của OSM.

Các lệnh ghi bị khóa khi đang lưu, bản nháp lỗi hoặc còn lần lưu chưa xác nhận.
Lệnh lưu vẫn dùng lại receipt và requestId hiện tại. API tiếp tục kiểm tra schema,
quyền hình học và phiên bản; menu không vượt qua các kiểm tra này.

Kiểm tra: `scripts/enc-edit-commands.test.mjs` kiểm tra bản sao không mang liên kết
nguồn; `scripts/enc-editing.browser.mjs` kiểm tra menu, paste/duplicate, Escape,
xác nhận cắt và bảo vệ polygon ở desktop/mobile, cùng các luồng lưu/Undo/Redo cũ.
