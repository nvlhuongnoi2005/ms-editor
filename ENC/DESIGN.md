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

- Nhận diện và menu ENC dùng `WorkspaceNavigation` chung của GEODATA; trạng thái
  **Xem hải đồ/Biên tập ENC** hiện cạnh menu, tác vụ dữ liệu ở cuối header.
- Lề danh mục màu giấy ngà, ghép sát mép bản đồ, không bóng nổi hay thẻ lồng thẻ.
- Tên vùng hiện hành là nội dung nổi bật nhất trong lề; mã cell và edition/update
  là dấu nhận diện dữ liệu, chỉ hiện khi có dữ liệu thực.
- Mục **Nhập dữ liệu** và nút header **Dữ liệu / Import ENC** mở dialog cùng
  cấu trúc với OSM: dữ liệu đã xử lý, upload, tác vụ gần đây. Upload không chiếm
  lề bản đồ khi xem.
- Chân bản đồ là một dòng tọa độ, zoom, đơn vị độ sâu và trạng thái đọc dữ liệu.

## Tokens

Biên tập cơ bản mở thanh tác vụ cạnh lề atlas và dùng bảng thuộc tính bên phải
để sửa. Mobile giữ thanh tác vụ phía trên và bảng thuộc tính phía dưới, mỗi phần
cuộn độc lập; nút mở lề vẫn truy cập được. Lưu, Undo/Redo và bản sao bản nháp ở
cùng một nhóm. Điểm/đường/vùng đỏ biểu thị phần chỉnh sửa của workspace riêng.
Trạng thái lưu đang chờ xác nhận khóa sửa tiếp và cho kiểm tra lại cùng lần lưu.
Kiểm tra Chrome với viewport 1440 và 390 px: tạo/sửa/xóa điểm, tọa độ chính xác,
Undo/Redo, reload, gửi lại lần lưu và bố cục không tràn ngang.

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

Font lưu tại `editor-web/src/shared/assets/`; nguồn IBM/plex, giấy phép
SIL Open Font License đi kèm trong `PLEX-LICENSE.txt`. Không tải font bên ngoài
khi người dùng mở ứng dụng. `DESIGN.md` ở gốc khai báo font dùng chung để
kiểm tra design system nhận biết phạm vi thay đổi. Tên font là
`GeodataSans`; palette và typography cấp hệ thống theo `../DESIGN.md`.
Bảng thuộc tính đưa OBJNAM, độ sâu, màu và đặc tính đèn lên trước mã nguồn;
các trường đo độ sâu/chiều cao ghi đơn vị mét cạnh tên trường.

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

### Ảnh bảng ký hiệu — 12/11/2026

Bảng ký hiệu, bộ chọn điểm và ảnh MapLibre dùng tài sản đóng gói từ Presentation
Library với URL có hash, không phụ thuộc API asset root. Đã xem BOYSAW12 trong
Chrome 1440/390 px trên localhost:4173, với đường dẫn assets API cũ bị ép trả 404:
ảnh 2048×961 tải thành công, ô ký hiệu hiển thị đúng và không còn cảnh báo lỗi ảnh.

### Tương tác biên tập — 12/11/2026

Giữ bố cục và ký hiệu hiện có. Preview theo frame, cập nhật đối tượng đổi bằng ID;
không chặn Undo/Redo vì tile nền đang tải. Scope xem/biên tập đổi nguồn tile mà
không dựng lại toàn bộ style. Ghi nháp gộp các cập nhật liên tiếp, nhưng Lưu và Về
chế độ xem vẫn chờ ghi an toàn và giữ kiểm tra CAS. Đã kiểm tra Chrome desktop và
mobile, kể cả tile bị giữ chậm; số đo và giới hạn trong `docs/enc-edit-performance.md`.

### Ký hiệu và thuộc tính theo schema — 12/11/2026

Bộ chọn Loại điểm dùng ô tìm mã lớp/mã sprite/mô tả, có hình cắt từ atlas cạnh
lựa chọn và giá trị đang chọn. Thả điểm và kéo điểm dùng ký hiệu thực thay pin;
khung chạm kéo 44 px trong suốt, chỉ gợi ý viền khi hover. Preview dùng theme
đang xem. Bảng thuộc tính cho thêm trường qua ô tìm schema của đúng lớp, enum/list
có bộ chọn, số không hợp lệ báo ngay tại trường và khóa Lưu. Không thêm trường
định danh hoặc cấu trúc nguồn vào biểu mẫu. Nút xóa trường có nhãn truy cập riêng.

Chrome 1440/390 px đã kiểm tra tìm BOYLAT14, preview/đặt sprite, thêm VERLEN,
chặn số sai và lưu 12.5, Undo/Redo, reload và tiếp tục workspace. Fixture UI không
thay đối chiếu Chart 1/S-64. Bố cục giữ toolbar trái, thuộc tính phải trên desktop;
mobile cuộn bảng độc lập, giữ diện tích đặt điểm giữa hai bảng.

### Bỏ thiết lập lớp hiển thị — 12/11/2026

Màn hình không còn khối **Hiển thị hải đồ** hoặc các checkbox tên/sounding/chất
lượng vị trí. Mặc định hiện cả Base/Standard/Other; không đọc cấu hình ẩn lớp lưu
trước đây. Theme vẫn chọn trong lề hải đồ. Độ chi tiết được xử lý theo zoom,
SCAMIN và profile LOD của runtime; giữ geometry gốc trong dữ liệu biên tập.
Mục Presentation Library bên dưới ghi nhận bố cục ở phiên bản trước thay đổi này.

### Thu gọn công cụ biên tập — 12/11/2026

Mặc định chỉ hiện icon bút trong một MapLibre control ngay dưới navigator góc phải.
Bấm icon mở/thu gọn bảng; bảng có nút đóng và hỗ trợ Escape. Việc thu gọn chỉ ẩn
giao diện, không đóng workspace hoặc xóa bản nháp. Khi đang biên tập, bảng thao tác
giữ vị trí bên trái để không che bảng thuộc tính bên phải. Bản nháp sau reload
được tiếp tục qua icon → **Tiếp tục bản biên tập**.

Kiểm tra Chrome ở desktop/mobile xác nhận vị trí icon dưới navigator, kích thước
gọn theo cụm điều hướng, mặc định không có bảng che bản đồ và có thể mở/đóng lại.

### Presentation Library — 12/11/2026

Giữ lề atlas, palette và typography hiện có. Khối **Hiển thị hải đồ** nằm sau
bộ chọn theme; nhóm các ngưỡng độ sâu theo lưới hai cột, ghi đơn vị m ngay trên
nhãn. Thay đổi là bản nháp đến khi bấm **Áp dụng hiển thị**. Cấu hình sai thứ tự
đồng sâu hiển thị lỗi tại khối này và giữ nguyên cấu hình bản đồ đang chạy.
Tùy chọn nguồn/phạm vi nằm trong disclosure, không chiếm diện tích bản đồ.

Đã xem ảnh Chrome 1440×900 và 390×900: nhãn, nút áp dụng và checkbox đọc được;
không tràn ngang, panel cuộn độc lập, nút chạm tối thiểu 44 px. Fixture kiểm thử
giao diện dùng tile rỗng; kết quả này xác nhận bố cục và tương tác, không xác nhận
nội dung hải đồ hoặc độ phù hợp S-52. Kiểm thử biên tập vẫn qua sau khi chuyển
sprite/glyph sang Presentation_Library.

Xem desktop và mobile với dữ liệu đã nhập; kiểm tra tên vùng dài, lề mở/đóng,
tab nhập, trạng thái bản đồ, lựa chọn theme và việc nhìn rõ bản đồ.
Không dùng số liệu minh họa hay nhãn vùng không có trong metadata nguồn.
