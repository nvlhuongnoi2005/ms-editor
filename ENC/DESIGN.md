# ENC — Lề atlas

## Phạm vi và mục tiêu

Mode: **Operate**. Áp dụng cho viewer ENC `?mode=enc`; không thay giao diện OSM.
Người dùng cần nhận ra hải đồ đang xem, xem đối tượng và độ sâu, quản lý lần nhập.
Đỏ GEODATA được giữ làm màu nhận diện. Dữ liệu và cách dựng hải đồ giữ nguyên.

## Hướng thiết kế

Một bản đồ có lề tra cứu, lấy cấu trúc rõ ràng của trang atlas: lề cố định,
tên địa danh có thứ bậc, nét phân cách mảnh, chú dẫn tọa độ và khoảng trống.
Không dùng hình la bàn, giấy giả cũ, đường trang trí hoặc mô phỏng thiết bị hàng hải.

Các hướng đã cân nhắc: bản đồ địa hình in, sách danh bạ địa danh, bảng thông tin
cảng, chú giải bản đồ chuyên đề, mục lục ấn phẩm địa lý, **lề atlas**, và lịch
trình tuyến biển. Hướng thứ sáu được dùng theo vòng concept-seed
`seed:1d9e7465e19cb82c`.

Đối chiếu các hướng đối trọng: kỷ luật căn hàng và trạng thái của emission rail
được giữ dưới dạng đường căn thống nhất; hình thức phổ sáng không phù hợp với
bản đồ đang làm việc. Cấu trúc poster streaming không phù hợp thao tác địa lý;
giữ yêu cầu chỉ một nội dung hoạt động nổi bật. Đây là triển khai trực tiếp theo
yêu cầu viết design và implement của người dùng.

## Signature

- Dấu **ENC** đỏ đặc nằm cạnh tên Hải đồ; nhận diện bằng chữ thay huy hiệu trang trí.
- Lề danh mục màu giấy ngà, ghép sát mép bản đồ, không bóng nổi hay thẻ lồng thẻ.
- Tên vùng hiện hành là nội dung nổi bật nhất trong lề; mã cell và edition/update
  là dấu nhận diện dữ liệu, chỉ hiện khi có dữ liệu thực.
- Mục **Nhập dữ liệu** và nút header **Dữ liệu / Import ENC** mở dialog cùng
  cấu trúc với OSM: dữ liệu đã xử lý, upload, tác vụ gần đây. Upload không chiếm
  lề bản đồ khi xem.
- Chân bản đồ là một dòng tọa độ, zoom, đơn vị độ sâu và trạng thái đọc dữ liệu.

## Tokens

| Token | Giá trị |
|---|---|
| Paper | `#f5f2e9` |
| Surface | `#fcfbf7` |
| Ink | `#252c2b` |
| Secondary ink | `#626a63` |
| Rule | `#d4d3c8` |
| Signature red | `#8b2235` |
| Red hover | `#681626` |
| Type | IBM Plex Sans Regular / SemiBold, self-hosted |
| Radius | 2–4 px controls; không dùng pill |

Font lưu tại `editor-web/src/domains/enc/assets/`; nguồn IBM/plex, giấy phép
SIL Open Font License đi kèm trong `PLEX-LICENSE.txt`. Không tải font bên ngoài
khi người dùng mở ứng dụng. `DESIGN.md` ở gốc đã khai báo font ENC riêng để
kiểm tra design system nhận biết phạm vi thay đổi.

## Bố cục

Desktop: header 60 px; lề 320 px có thể thu gọn; chân trang 32 px. Bản đồ giữ
phần diện tích còn lại; padding camera phản ánh phần lề đang mở.
Mobile: lề mặc định đóng, mở bằng nút Hải đồ; thao tác chạm tối thiểu 44 px.
Thuộc tính đối tượng mở trong bảng riêng bên phải (desktop), hoặc bảng dưới
cùng chiếm tối đa 46% bản đồ (mobile). Tiêu đề và nút đóng luôn hiện; thuộc tính
cuộn độc lập và có thể chọn sao chép. Dialog import cuộn nội dung và giữ nút đóng
ở chân dialog, không tạo cuộn toàn trang.

## Trạng thái và tương tác

Mục đang chọn dùng nền đỏ nhạt và gạch chân; trạng thái loading/error/empty giữ
thông điệp và thao tác phục hồi hiện có. Xóa vẫn có xác nhận. Chọn đối tượng mở
bảng thuộc tính riêng, không tự mở lề Hải đồ hoặc dịch camera. Chọn đối tượng khác
cập nhật bảng; đóng bằng nút X, Escape hoặc chọn khoảng trống không có đối tượng.
Tọa độ cập nhật khi kết thúc di chuyển, không render React mỗi frame.
Focus rõ bằng outline đỏ; selection, scrollbar và trường nhập dùng cùng palette.
Tôn trọng reduced motion; không thêm animation trang trí trên canvas.

## Độ sâu và nhãn trên bản đồ

Icon phao/đèn và sounding xuất hiện từ zoom 9; chữ sounding bắt đầu 13 px,
tăng đến 15 px khi zoom gần. Ưu tiên khoảng trống cho icon, rồi sounding, nhãn
đường đẳng sâu và tên đối tượng. Tên vùng chỉ ở mức tổng quan dưới zoom 9.
Tên đối tượng có thể chuyển giữa bốn góc quanh điểm để tránh đè lên nội dung.
Không dùng allow-overlap để ép mọi chữ lên màn hình. Số độ sâu thiếu không
hiện thành 0. Chi tiết profile và giới hạn dữ liệu nằm trong `ROADMAP.md`.

## Kiểm tra thực tế

Xem desktop và mobile với dữ liệu đã nhập; kiểm tra tên vùng dài, lề mở/đóng,
tab nhập, trạng thái bản đồ, lựa chọn theme và việc nhìn rõ bản đồ.
Không dùng số liệu minh họa hay nhãn vùng không có trong metadata nguồn.
