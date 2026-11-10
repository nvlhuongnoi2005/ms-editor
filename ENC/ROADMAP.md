# Giai đoạn 2 — Hiển thị ENC liên tục

Triển khai từng phần. Sau mỗi phần, báo cáo kết quả và dừng; chỉ làm phần kế
tiếp khi người dùng nói “tiếp tục”.

## 1. Chọn cell theo tỷ lệ và xử lý chồng lấn — đã triển khai

Logic nằm trong `editor-api/internal/enc/tile.sql`:

- Đọc tỷ lệ biên tập `DSPM_CSCL` và cấp sử dụng `DSID_INTU` đã lưu từ GDAL.
- Mẫu số chọn cell là `279541132.014 / 2^zoom`, dùng cùng giá trị cho toàn bộ
  tile tại một zoom. Tránh thay cell giữa các hàng tile vì khác vĩ độ.
  Đây là profile của viewer, không phải tỷ lệ giấy hoặc toàn bộ quy chuẩn S-52.
  SCAMIN hiện vẫn dùng mẫu số theo vĩ độ như trước.
- Cell phù hợp có mẫu số biên tập >= một nửa mẫu số chọn cell. Trong nhóm
  phù hợp, cell chi tiết nhất được ưu tiên. INTU dùng phân xử khi cùng tỷ lệ.
- Cell quá chi tiết vẫn được giữ làm dự phòng: ưu tiên cell tổng quát nhất
  trong nhóm này, sau đó dùng các cell còn lại để lấp vùng chưa có dữ liệu.
  Cell thiếu tỷ lệ đứng cuối; không tự gán tỷ lệ từ tên file hoặc INTU.
- Vùng phủ dùng M_COVR/CATCOV=1, trừ CATCOV=2. Nếu thiếu vùng phủ dương,
  dùng bounds và vẫn trừ vùng loại trừ. Region API dùng cùng quy tắc này.
- Xếp hạng ổn định bằng tỷ lệ, INTU, producer, tên cell, edition/update và ID.
  Trừ vùng đã được cell ưu tiên phủ trước khi cắt feature vào MVT, tránh
  hiển thị nhiều bộ đối tượng tại cùng vùng chồng lấn.
- Khi chọn riêng một cell, bỏ điều kiện tỷ lệ để phục vụ tra cứu dữ liệu nguồn.
- MVT bổ sung `compilation_scale`, `intended_usage`, `cell_selection` để có
  thể tra cứu lý do chọn cell ngay trong bảng thuộc tính đối tượng.
- Bump portrayal URL lên 7 để phân biệt tile với phiên bản hiển thị cũ.

Không sửa dữ liệu nguồn, active revision hoặc cấu trúc database; không cần
import lại ZIP. Zoom dưới 9 vẫn hiển thị tổng quan theo hành vi hiện tại.
Giữ hành vi mật độ sounding, ký hiệu và SCAMIN cho phần 2.

Build Go và frontend thành công. API local đã cập nhật; yêu cầu tile thực tế
tại Manitowoc ở zoom 9, 12 và 14 đều trả HTTP 200. Chưa chạy bộ kiểm thử tự
động hoặc đánh giá đầy đủ các đường biên trên nhiều producer.

Tham chiếu trường metadata: [GDAL S-57](https://gdal.org/en/stable/drivers/vector/s57.html).

Giới hạn: một nguồn ENC thiếu cell tổng quan vẫn chỉ có thể dùng cell chi tiết
làm dự phòng. Thuật toán không tạo thêm dữ liệu ngoài vùng phủ. M_CSCL cục bộ
trong một cell chưa tham gia chọn tỷ lệ; hiện dùng DSPM_CSCL của toàn cell.
Chính sách chọn giữa các producer hiện có thứ tự ổn định, chưa có cấu hình ưu
tiên nhà cung cấp theo người dùng.

## 2. Độ sâu, ký hiệu và nhãn theo tỷ lệ — đã triển khai

Profile MVT và style local được cập nhật, portrayal URL phiên bản 8:

| Mức zoom | Hiển thị |
|---|---|
| <9 | Tổng quan và tên vùng theo luồng hiện có |
| 9–10 | Ký hiệu phao/đèn, sounding lọc ô 64 px; chữ độ sâu từ 13 px |
| 11–13 | Sounding lọc ô 32 px, tăng số điểm để đọc vùng tiếp cận |
| 14–16 | Sounding lọc ô 16 px; collision tiếp tục chống chữ chồng nhau |
| >=17 | Không lọc ô sounding ở API; collision vẫn hoạt động trên client |

Khoảng cách ô quy đổi theo tile 512 px ở zoom nguyên. Trong mỗi ô, ưu tiên
điểm có độ sâu nhỏ nhất. Các bước 64/32/16 chia hết kích thước tile và căn vào
lưới thế giới để giảm thay đổi lựa chọn tại đường biên. Đây là lọc hiển thị,
không phải lọc hoặc xóa dữ liệu nguồn.

- Giữ vùng độ sâu, đất, bờ và đường đẳng sâu từ zoom 9 cùng các nhóm điểm
  quan trọng. Các nhóm khác vẫn giữ profile SCAMIN nới bốn lần hiện tại.
- SOUNDG thiếu DEPTH dạng số không tham gia tile hoặc cạnh tranh mật độ.
  Giá trị thiếu không được tạo thành `0`; vùng thiếu DRVAL1 dùng màu nước sâu
  mặc định thay vì bị tô thành vùng triều. Giữ nguyên số âm hợp lệ và số 0 thực.
- Thứ tự collision: icon phao/đèn, sounding, nhãn đường đẳng sâu, tên đối tượng.
  Trong lớp icon, ưu tiên LIGHTS và các nhóm phao nguy hiểm/phương vị theo
  profile viewer; trong sounding, điểm nông có ưu tiên cao hơn.
- Nhãn đường đẳng sâu và tên đối tượng bắt đầu zoom 10. Tên có bốn vị trí
  quanh điểm để tránh va chạm; bổ sung tên cho các nhóm phao/beacon đã hỗ trợ.
- Tên vùng kết thúc ở zoom 9 để không tranh chỗ với dữ liệu chi tiết. Chấm
  chân phao bắt đầu zoom 12; zoom xa dùng icon có collision để giảm cụm chấm.
- Tăng kích thước điểm chướng ngại vật từ 3 lên 4 px theo zoom. Đây vẫn là
  ký hiệu đơn giản, chưa triển khai toàn bộ conditional symbology S-52.

Build Go/frontend thành công; API local đã cập nhật. Đã xem bản đồ thực tế
Manitowoc ở zoom 10/14, mobile zoom 12 và theme day/dusk/night; không ghi nhận
lỗi JavaScript hoặc sự kiện lỗi MapLibre trong phiên xem. Ở viewport desktop
đã chụp, zoom 10 có 1 nhãn sounding/5 icon, zoom 14 có 406 nhãn sounding/17 icon.
Số lượng phụ thuộc vùng nhìn và dữ liệu đã nhập; không cam kết mọi nơi có cùng
mật độ. Không chạy bộ kiểm thử tự động.

Giới hạn: các quy tắc không tạo thêm điểm đo hoặc vùng phủ. Bộ ZIP chỉ chứa
cell chi tiết nhỏ vẫn nhìn thành mảnh nhỏ khi zoom xa; cần nhập cell tổng quan
phù hợp để có dữ liệu liên tục ở ngoài mảnh đó. Chưa thêm thiết lập safety
depth/contour, format sounding theo S-52, hoặc ký hiệu đèn có điều kiện đầy đủ.

Tham chiếu collision và variable anchor:
[MapLibre Style Spec](https://maplibre.org/maplibre-style-spec/layers/).

Bổ sung theo yêu cầu sau phần 2: registry sprite, chuẩn hóa thuộc tính và điểm
neo symbol vùng đã triển khai. Xem [SPRITES.md](SPRITES.md) và inventory đi kèm.

## 3. Region nguồn và hiển thị tổng quan — chưa triển khai

Tổ chức metadata region, tên vùng và chuyển từ tổng quan sang hải đồ chi tiết.

## 4. Tối ưu tile/cache — chưa triển khai

Cache theo revision và cấu hình hiển thị, tối ưu truy vấn trên nhiều bộ dữ liệu.
