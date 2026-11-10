# Mapping sprite ENC local

Registry: `editor-web/src/domains/enc/sprites.ts`. Style gọi registry thay cho
mapping 9 nhóm phao/đèn trước đây. Áp dụng cho ENC local; nguồn demo giữ style
do server demo cung cấp.

## Phạm vi

- 85 lớp đối tượng trong registry point symbol, bao gồm lớp có geometry vùng.
- 9 lớp pattern vùng và 5 lớp ký hiệu lặp trên đường.
- 209 tên sprite được tham chiếu; tất cả tồn tại trong cả ba atlas day/dusk/night.
- Mỗi atlas có 232 tên và cùng bộ key. Có 23 tài sản dự phòng chưa kích hoạt,
  được liệt kê trong inventory bên dưới; không ép dùng mỗi ảnh chỉ để đủ số.

## Quy tắc chính

| Nhóm | Thuộc tính / cách chọn |
|---|---|
| BOYCAR, BCNCAR | CATCAM: đủ bốn phương vị; thiếu dùng ký hiệu phao/beacon không xác định |
| BOYLAT | CATLAM, BOYSHP và COLOUR: conical/can/spherical/pillar/spar, đỏ/xanh/khác |
| BCNLAT, BCNSAW, BCNSPP | BCNSHP, COLOUR, CATSPM: dạng ngắn/dài, cairn, notice/refuge |
| BOYSPP | CATSPM và BOYSHP; LANBY/unknown có fallback riêng |
| BOYISD, BCNISD, BOYSAW | Ký hiệu nguy hiểm biệt lập, nước an toàn và biến thể màu |
| LIGHTS | COLOUR: đỏ/xanh/vàng hoặc LITDEF11; flare xoay 135 độ |
| TOPMAR | Đủ 33 mã TOPSHP, phân biệt nền nổi/cố định; thiếu dùng TMARDEF1/2 |
| DAYMAR | TOPSHP: vuông/tam giác lên/tam giác xuống |
| WRECKS | CATWRK, WATLEV, VALSOU; ngưỡng viewer hiện tại 6 m |
| UWTROC | WATLEV: chìm/ngập theo triều/khác |
| OBSTRN | CATOBS, WATLEV, VALSOU, QUASOU: fish haven, tackle, boom, nổi/chìm, độ tin cậy thấp |
| LNDMRK, BUISGL | FUNCTN, CATLMK, CONVIS: công trình tôn giáo, tháp, ống khói, cột, mái vòm, windmill… |
| SILTNK | CATSIL và CONVIS: silo, tank, grain elevator, water tower |
| MORFAC | CATMOR: dolphin, bollard, pile, mooring buoy |
| PRDARE | CATPRA: quarry, mine, refinery, timber yard, tank farm, wind farm |
| RESARE | RESTRN: hạn chế neo/hạn chế vào vùng |
| RECTRC, TWRTPT | CATTRK, TRAFIC: một chiều/hai chiều, theo hệ thống mốc/khác |
| RCTLPT, CURENT, RDOCAL | Có ORIENT dùng biến thể định hướng; thiếu có fallback |
| FSHFAC, LNDRGN, OBSTRN | Pattern theo CATFIF, CATLND, CATOBS |
| Các nhóm khác | Sprite riêng: radar, fog signal, pilot, harbour facility, current, tide, kelp… |

## Hợp đồng tile

API giữ nguyên attributes gốc, bổ sung các trường phục vụ style:

- `sym_<attribute>`: giá trị đầu tiên để đọc mã scalar hoặc list nhất quán.
- `list_<attribute>`: danh sách có dấu phân cách để kiểm tra nhiều mã, tránh
  nhầm mã 1 với 11. Dùng cho FUNCTN, CATSPM, RESTRN, QUASOU, NATSUR…
- `topmark_floating`: có phao hoặc light vessel/platform nổi tại đúng tọa độ,
  trong cùng cell và phiên bản. Không suy luận nền nổi từ một đối tượng bất kỳ.

Lớp MVT `enc_symbols` chứa điểm neo cho geometry không phải point. Điểm được
tính từ geometry nguồn trước khi cắt tile, rồi xét quyền phủ của cell. Không
tạo một tâm mới cho mỗi mảnh tile. Polygon LNDARE không nhận icon giữa đất liền;
LNDARE dạng point vẫn dùng LNDARE01. Click symbol vùng mở cùng bảng properties.

Các trường chuẩn hóa nội bộ không xuất hiện trong bảng properties. Không cần
thay schema hoặc import lại dữ liệu. Tile URL dùng portrayal 9.

## Tránh thiếu và chọn nhầm icon

- Symbol class chưa có quy tắc riêng dùng dấu hỏi ở zoom 13+, vẫn chọn được.
- SBDARE dùng chữ viết tắt NATSUR, không dùng hình thay cho chất đáy biển.
  LNDELV có nhãn ELEVAT; sounding tiếp tục dùng số độ sâu.
- Icon dùng image fallback QUESMRK1 nếu bộ atlas triển khai thiếu một ảnh.
- Icon phao/beacon và hazard có collision. TOPMAR và flare LIGHTS là các phần
  ghép tại cùng tọa độ, cho phép chồng lên ký hiệu nền.
- Nhãn/sounding giữ cơ chế ưu tiên và lọc mật độ ở phần 2; đối tượng phụ còn
  chịu SCAMIN và mức zoom. Mapping không đồng nghĩa mọi đối tượng luôn hiện.

## Giới hạn

Đây là profile simplified atlas. Chưa có sector light tạo động, toàn bộ
conditional symbology và kiểm tra độ sâu vùng lân cận của S-52. Một số lớp
như HRBFAC/SMCFAC hiện dùng biểu tượng chung của lớp; không có đủ ảnh trong
atlas để biểu diễn mọi danh mục con. Các tài sản dự phòng chưa có quy tắc
đáng tin cậy được giữ nguyên thay vì tự gán sang lớp có tên gần giống.

Đã build Go và frontend; xem dữ liệu Manitowoc zoom 10/14, mobile zoom 12 và
ba theme, không có lỗi JavaScript/MapLibre trong phiên xem. Chưa chạy bộ kiểm
thử tự động; dữ liệu hiện tại không chứa mọi biến thể trong registry.

## Nguồn và giấy phép

Quy tắc được đối chiếu và chuyển thể từ
[Njord symbology](https://github.com/manimaul/njord/tree/master/crates/njord-symbology/src/layers).
Những điều chỉnh của viewer như collision, fallback, anchor và ngưỡng độ sâu
được ghi ở trên. Giấy phép Apache-2.0 của mã tham chiếu được giữ trong
`NJORD-LICENSE.txt`. Sprite atlas vẫn là bộ người dùng đã cung cấp; provenance
của ảnh không được thay thế bằng giấy phép mã nguồn.

Danh mục từng ảnh: [SPRITE-INVENTORY.md](SPRITE-INVENTORY.md).
