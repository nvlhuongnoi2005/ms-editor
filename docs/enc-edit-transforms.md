# Chọn, kéo và đổi kích thước đối tượng ENC

Trong bản biên tập, bấm vào ký hiệu, đường hoặc vùng để chọn. Khung chọn có bốn
góc thao tác. Kéo bên trong khung để đổi vị trí; kéo góc để đổi kích thước đồng đều,
giữ nguyên tỷ lệ hình dạng. Bấm đối tượng khác để đổi lựa chọn. Với hình học đang
được bảo vệ, khung chỉ hiển thị phạm vi và không cho kéo vị trí.
Khung hiện “Khóa vị trí” khi không được di chuyển; kéo trên khung này không kéo
bản đồ. Khi kéo đối tượng được phép, khung giữ nguyên màu và chỉ đổi con trỏ.

- **Điểm:** đổi kích thước hiển thị từ 50% đến 400%, có nút khôi phục kích thước
  chuẩn trong bảng thuộc tính. Đổi kích thước không thay đổi tọa độ hoặc thuộc tính
  S-57. Kéo vị trí vẫn phải có quyền `canMove` từ API.
- **Đường/vùng:** di chuyển và đổi tỷ lệ hình học trong hệ chiếu Mercator; giữ
  nguyên loại hình học, các đỉnh, vòng khép kín, lỗ trong vùng và giá trị Z.
- **Bàn phím:** Tab đến khung rồi dùng phím mũi tên để di chuyển 1 pixel;
  Shift + mũi tên di chuyển 10 pixel. Tab đến nút góc rồi dùng mũi tên để tăng/giảm
  kích thước 10%. Escape hủy thao tác kéo đang thực hiện.
- Mỗi lần thả chuột tạo một mục Undo/Redo. Hủy, chuyển bản đồ hoặc mất focus
  trình duyệt trong lúc kéo không ghi thay đổi chưa hoàn tất.

## Quyền biến đổi hình học

API kiểm tra lại quyền từ phiên bản nguồn khi lưu; không tin cờ quyền do trình duyệt
gửi lên. Điểm 2D độc lập dùng các lớp hỗ trợ Point trong schema, trừ SOUNDG và M_*;
không phụ thuộc danh sách giới hạn tạo/xóa điểm. Điểm dùng chung vẫn được bảo vệ.
Quyền nguồn được nạp lại một lần khi mở đối tượng từ bản nháp cũ, giữ nguyên nội
dung đã sửa và lịch sử. Đường/vùng chỉ có quyền khi:

1. Không dùng chung primitive hoặc liên kết đối tượng với feature khác.
2. Mọi tham chiếu là cạnh có bản ghi nguồn đầy đủ; các nút đầu mút cũng có bản ghi.
3. Các nút đầu mút không được cạnh khác hoặc đối tượng khác dùng chung.
4. Cell không có primitive Face cần bộ xử lý topology riêng.

Trường hợp thiếu bằng chứng về quyền sở hữu vẫn cho chọn và xem thuộc tính nhưng
không cho biến đổi. Xóa đường/vùng chưa được mở rộng bởi thay đổi này.

API chỉ chấp nhận phép tịnh tiến và tỷ lệ dương đồng đều của toàn bộ hình học.
Đổi loại, xóa đỉnh, bỏ lỗ, mở vòng, đổi Z, biến dạng từng đỉnh hoặc tọa độ vượt
phạm vi Mercator đều bị từ chối. Bản biên tập lưu overlay; dữ liệu công bố và
các bản ghi primitive nguồn không bị viết lại. Đây chưa phải bộ biên tập topology
hoặc bộ xuất ENC S-57 hoàn chỉnh.

## Lưu và khôi phục

`symbolScale` là metadata tùy chọn của document biên tập, mặc định 1; không nằm
trong `attributes`. Nó được kiểm tra ở trình duyệt và API, lưu cùng geometry trong
bản nháp, workspace, receipt lưu và lịch sử Undo/Redo. Bản nháp cũ không có trường
này giữ kích thước chuẩn. Nó không làm thay đổi thư viện ký hiệu hoặc kiểu hiển thị
của hải đồ công bố.

## Tối ưu và phần dùng chung

- `featurePicking.ts`: dùng chung hit-test cho xem, biên tập và hover; ưu tiên ký
  hiệu/đường trước fill. Chọn overlay đi qua cùng luồng, không query thêm lần nữa.
- `geometryTransform.ts`: tập trung kiểm tra tọa độ, hệ chiếu và phép biến đổi.
  Không tái dùng trực tiếp phép biến đổi OSM vì OSM cần cập nhật graph/node và làm
  tròn E7, trong khi ENC phải giữ độ chính xác và Z của nguồn.
- `EncTransformBox.tsx`: quản lý vòng đời pointer, capture, hủy, bàn phím và khung
  xem trước. Dùng CSS để xem trước; chỉ duyệt các đỉnh một lần khi thả chuột.
- Rê chuột chỉ đổi con trỏ khi có thể chọn đối tượng; không vẽ khung hover.
  Hit-test tối đa một query trong mỗi animation frame; không nạp lại style hoặc
  đẩy geometry vào worker theo từng sự kiện chuột.
- Chọn lại đối tượng dùng document/cache hiện có; cache được xóa khi mở workspace.
  Lựa chọn cũ không kéo focus trở lại sau khi đổi bằng danh sách hoặc đóng bảng.
- Lịch sử chụp đối tượng đầu vào một lần, rồi dùng chung giá trị bất biến giữa
  documents, saved và Undo/Redo; không nhân bản toàn bộ hình học mỗi lần hoàn tác.
- Đã loại phần chọn overlay trùng, phép so sánh document riêng và các khai báo
  TypeScript/CSS không còn dùng. Rà `noUnusedLocals/noUnusedParameters` toàn frontend.

## Kiểm tra

`npm run test:editor`, `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`,
`npm run build:react`, `go test ./...`.

`TestEditingPersistence` chạy trên database dùng một lần `enc_editing_test`, kiểm
tra quyền đối với đường/vùng và cạnh dùng chung đầu mút. Browser regression trong
`editor-web/scripts/enc-editing.browser.mjs` kiểm tra kéo, resize, Undo/Redo, polygon,
lưu/khôi phục kích thước ký hiệu, retry và CAS hai tab ở desktop/mobile. Các hình
thử trên trình duyệt không ghi vào dữ liệu ENC công bố.
