# Chọn ký hiệu ENC theo S-52

Registry: `editor-web/src/domains/enc/sprites.ts`. Áp dụng cho ENC local;
nguồn demo sử dụng style của server demo.

## Tài liệu đã đối chiếu

S-52 PresLib Ed 4.0(.3), Part I Addendum, December 2020, **S-52 ENC Symbol
Catalogue** (564 trang PDF) do người dùng cung cấp. Trang PDF bằng số trang
in cộng 6. Catalogue mô tả SY, LC, AP, ý nghĩa, kích thước, màu và dẫn chiếu
tới look-up table/CSP; không chứa toàn bộ bảng tra và sơ đồ CSP của Part I.

`simplified` trong tên atlas là tên bộ ký hiệu điểm của IHO. Các nhánh chọn
ký hiệu vẫn xét thuộc tính, geometry và ngữ cảnh.

## Phạm vi atlas

- 499 ảnh/theme, cùng bộ key trong day/dusk/night; 231 ảnh có tham chiếu runtime.
  Gồm 232 ảnh gốc, 263 SVG bổ sung và 4 texture đường từ SVG của viewer.
  Atlas mới có kích thước 2048×961; JSON và PNG phải được thay cùng nhau.
- Đã sửa `FSHFAC03`: dùng hình cọc đăng đầu tiên trong FSHFAC03P tại
  `(2754,280,48,14)` trong bản gốc lưu tại `sprites/base/`, thay tọa độ lỗi `y=-140`.
  Atlas mới đã đóng gói lại các ô ảnh, giữ nguyên pixel và kích thước ảnh gốc.
- 6 ảnh giữ riêng: CHINFO08/09 là ghi chú của mariner; CHINFO10/11 là ghi chú
  của nhà sản xuất; DNGHILIT là highlight nguy hiểm của mariner; OBSTRN02
  thuộc thủ tục OBSTRN cũ (catalogue p.182).
- DISMAR06, SISTAT03 và SISTAW03 có trong atlas nhưng không thấy tên tương
  ứng trong catalogue 4.0(.3). Inventory ghi rõ, không coi là bằng chứng phù hợp phiên bản.

Toàn bộ ảnh, trạng thái và trang tham chiếu: [SPRITE-INVENTORY.md](SPRITE-INVENTORY.md).

## Quy tắc chính

| Nhóm | Điều kiện |
|---|---|
| BOYCAR / BCNCAR | Bốn CATCAM; thiếu mã dùng BOYDEF03 / BCNDEF13 |
| BOYLAT / BCNLAT / BCNSAW / BCNSPP | CATLAM, BOYSHP/BCNSHP, màu chính COLOUR; CATSPM chọn notice/refuge/unknown |
| BOYSPP | CATSPM ODAS/LANBY/unknown; BOYSHP chọn conical, can, spherical/barrel, pillar/spar/ice, super-buoy; dùng BOYSPP35 theo ý nghĩa p.54 |
| LIGHTS | CATLIT chọn đèn pha/spotlight LIGHTS82, đèn dải LIGHTS81; đèn thường dùng flare theo COLOUR (p.155–160) |
| Cung đèn | SECTR1/SECTR2, xử lý cung qua 0°; hai giới hạn bằng nhau hoặc 0–360 là toàn hướng. VALNMR ≥10 không có sector dùng vòng toàn hướng, trừ CATLIT 5/6 và LITCHR 12; CATLIT 8/9/11 dùng icon riêng |
| Màu/hướng đèn | Xét tổ hợp COLOUR trắng/đỏ và trắng/xanh, màu không xác định dùng magenta. Flare trắng/vàng/cam 45°, màu khác 135°; đèn định hướng dùng ORIENT đối hướng. LITVIS 3/7/8 trên sector dùng cung đen nét đứt |
| TOPMAR / DAYMAR | 33 mã TOPSHP; nền nổi/cố định trong cùng cell |
| UWTROC | Thiếu VALSOU: luôn chìm → UWTROC03; covers/uncovers hoặc awash → UWTROC04 (p.461–462) |
| Độ sâu hazard | VALSOU hợp lệ: âm → DANGER03; 0–20 m → DANGER01; >20 m → DANGER02 (p.95–97). Null, trống và lỗi không trở thành độ sâu 0 |
| Nguy hiểm biệt lập | VALSOU không lớn hơn safety contour và có DEPARE/DRGARE xung quanh đủ sâu; loại WATLEV 1/2; không suy ra chỉ từ độ sâu đối tượng |
| Safety contour | Mặc định 6 m; thiếu DEPCNT 6 m thì chọn đường đồng sâu kế tiếp sâu hơn trong cùng cell, ổn định giữa các tile |
| WRECKS thiếu độ sâu | CATWRK/WATLEV chọn wreck nguy hiểm/không nguy hiểm/phần thân lộ/distributed remains |
| OBSTRN | CATOBS: fish haven, foul ground, tackle, floating boom; WATLEV: nổi/chìm/ngập theo triều |
| Độ tin cậy | QUAPOS từ primitive bổ sung LOWACC01, không thay biểu tượng hazard; QUASOU nghi ngờ bổ sung dấu hỏi cho nhãn độ sâu |
| LNDMRK / BUISGL | FUNCTN, CATLMK, CONVIS; xét toàn bộ danh sách mã. Thiếu ảnh không conspicuous thì dùng vị trí chung, không dùng nhầm ảnh conspicuous |
| SILTNK | CATSIL, CONVIS; TOWERS12 là tháp nước conspicuous, TOWERS02 là tháp nước thường (p.447,450) |
| HRBFAC | CATHAF 1 → RoRo, 4 → cảng cá, 5 → marina; các loại khác dùng thông tin HO |
| CHKPNT / RSCSTA | CATCHP 1 hoặc FUNCTN customs → CHKPNT01; rescue station → RSCSTA02 |
| RDOCAL | ORIENT hợp lệ; TRAFIC 1/2/3 → RDOCAL02, 4 → RDOCAL03; thiếu → RCLDEF01 (p.204–207) |
| TS_FEB / TS_PAD | CAT_TS và ORIENT chọn flood/ebb/current; thiếu hướng → CURDEF01; bảng tidal stream → TIDSTR01 |
| PRDARE | CATPRA, CONVIS, geometry: refinery/tank farm/wind farm vùng khác công trình điểm |
| ACHARE | Điểm → ACHARE02; tâm vùng → ACHARE51 (p.3–4) |
| Vùng công trình | BUISGL/LNDMRK/SILTNK hiển thị footprint/outline, không gắn icon điểm vào mọi polygon |
| Hạ tầng và nước nội địa | `infrastructure.ts` vẽ cáp/ống, pontoon, công trình bờ, sông/kênh/hồ; SLCONS điểm dùng MORFAC03, đường/vùng xét CONDTN/CATSLC/WATLEV/QUAPOS. Chi tiết trong INFRASTRUCTURE-PORTRAYAL.md |
| Pattern | CATFIF/CATLND/CATOBS; wood/mangrove theo CATVEG; DEPARE thiếu DRVAL1/2 → PRTSUR01P; unknown NEWOBJ → pattern dấu hỏi |
| Drying sounding | DEPTH âm dùng trị tuyệt đối và gạch chân SOUNDSA1 (p.402) |

## Hợp đồng tile

Giữ attributes gốc, bổ sung trường nội bộ:

- `sym_<attribute>`: mã đầu tiên cho thuộc tính cần thứ tự (màu chính).
- `list_<attribute>`: danh sách `|1|11|` để xét đủ mã, phân biệt 1 với 11.
- `s52_geometry`: dimension geometry nguồn 0/1/2, trước khi chuyển sang điểm neo.
- `s52_quapos`: chất lượng vị trí từ feature/primitive RCID và RCNM liên kết.
- `s52_surrounding_depth`: DRVAL1 lớn nhất của DEPARE/DRGARE cắt geometry gốc,
  chỉ trong cùng dataset/cell và trước khi cắt tile.
- `s52_safety_contour`: DEPCNT kế tiếp không nông hơn mặc định 6 m.
- `topmark_floating`: nền nổi ở đúng tọa độ, cell và revision.

`enc_symbols` dùng điểm neo từ geometry gốc, không tạo tâm mới ở mỗi mảnh tile.
Trường nội bộ không xuất hiện trong properties UI. Tile URL và sprite dùng phiên bản `14`.
Không cần migration hay import lại ENC.

Rà soát theo dữ liệu đang công bố: [PORTRAYAL-AUDIT.md](PORTRAYAL-AUDIT.md).
Tạo lại thống kê mức bao phủ bằng `node scripts/enc-dataset-audit.mjs ../ENC/DATASET-PORTRAYAL-COVERAGE.md`
từ thư mục `editor-web`. Đây là kiểm tra bộ lọc, không phải chứng nhận S-52.

`lightSectors.ts` dựng ảnh cung đèn qua `setMissingStyleImageResolver` của MapLibre 6;
không gọi dịch vụ ngoài hay thay atlas. Bearing SECTR nhìn từ biển vào đèn,
vì vậy cung quanh vị trí đèn dùng hướng cộng 180°.

## Điểm neo LIGHTS và cụm hải đăng

`spritePivotOffsets` trong `sprites.ts` đổi pivot của catalogue sang CSS px
theo kích thước ô ảnh và pixelRatio=2 của atlas đang dùng. LIGHTS11/12/13,
LITDEF11, LIGHTS81/82, FOGSIG01 và TOWERS03 dùng anchor `center` kèm offset
riêng, để pivot bám tọa độ nguồn trước khi MapLibre xoay và phóng ký hiệu.
Không dùng chung anchor `bottom` cho mọi kiểu đèn hoặc tâm ảnh cho tháp.

Pivot FOGSIG01 nằm ngoài ô ảnh; các cung âm thanh nằm về một phía của vị trí
phát tín hiệu. Vòng/sector động vẫn lấy tâm tại tọa độ LIGHTS. Những offset
này chỉ điều chỉnh biểu diễn, không thay tọa độ S-57/PostGIS. Cần cập nhật
kích thước trong bảng pivot nếu thay atlas; cả ba theme hiện cùng kích thước.

## Kiểm tra

```powershell
cd editor-web
node --test scripts/enc-portrayal.test.mjs scripts/enc-import.test.mjs
npm run build:react
cd ..
python ENC/tools/check_portrayal_db.py
cd editor-api
go test ./internal/enc
```

Kiểm tra browser dùng dữ liệu local và fixture chỉ trong trình duyệt:

```powershell
cd editor-web
$env:ENC_PREVIEW_URL = 'http://127.0.0.1:4173/?mode=enc'
$env:ENC_PORTRAYAL_FIXTURES = '1'
node scripts/enc-local.browser.mjs
```

Fixture gồm các biến thể không nhất thiết có trong dữ liệu local, cung đèn
qua hướng Bắc và toàn hướng, ở cả ba theme. Kiểm tra SQL chỉ dùng bảng tạm
và rollback; không thay dữ liệu canonical.

Tạo lại inventory (cần PyMuPDF cho tác vụ offline):

```powershell
python ENC/tools/audit_sprites.py --catalogue 'path/to/S-52 Part I Addendum.pdf'
```

## Phần chưa có trong bộ tài sản/catalogue này

231 tham chiếu không có nghĩa là toàn bộ Presentation Library đã được triển
khai. Atlas đã bổ sung bộ chữ số SOUNDG/SOUNDS, SAFCON và nhiều SY/AP, nhưng có
ảnh trong atlas chưa đồng nghĩa đã có quy tắc chọn ảnh tương ứng. Bốn texture LC
chỉ phục vụ các lớp hiện tại, chưa phải bộ giải mã LC đầy đủ. Pivot, kích thước
nominal và line weight hiện lấy theo catalogue; Safety Depth/Contour có thể cấu hình
theo người dùng. Display category dùng phân nhóm theo object class làm profile;
feature chưa có phân loại được đưa vào OTHER. Đây chưa phải cách chạy đầy đủ LUT/CSP:
phân loại thực tế có thể phụ thuộc geometry, thuộc tính và nhánh điều kiện. Dynamic
SYMINS cùng thủ tục LEAST_DEPTH/SEABED_DEPTH khi thiếu VALSOU vẫn chưa triển khai.
Cần LUT/CSP chính thức và tài sản tương ứng để đối chiếu đủ. Zoom/SCAMIN, chọn cell,
thinning và collision vẫn là profile viewer.

## Hiển thị theo tỷ lệ

`tile.sql` áp dụng SCAMIN theo tỷ lệ mặt đất tại tile, kể cả khi chọn riêng một
cell. Khi mẫu số tỷ lệ hiển thị lớn hơn SCAMIN, chi tiết được bỏ khỏi cả hai lớp
MVT để icon, cung đèn và nhãn cùng ẩn; zoom vào sẽ hiển thị lại với đầy đủ quy
tắc chọn sprite. Không dùng ngoại lệ cho toàn bộ nhóm phao/đèn hoặc nới SCAMIN
bốn lần. Nền đất/nước (`DEPARE`, `DRGARE`, `LNDARE`, `COALNE`) được giữ liên tục;
SCAMIN thiếu, sai định dạng hoặc bằng 0 không đặt ngưỡng ẩn.

## Nguồn và giấy phép

Catalogue người dùng cung cấp là căn cứ đối chiếu ý nghĩa ký hiệu; không
sao chép PDF vào repo. Quy tắc trước đây chuyển thể từ
[Njord symbology](https://github.com/manimaul/njord/tree/master/crates/njord-symbology/src/layers)
giữ giấy phép Apache-2.0 tại `NJORD-LICENSE.txt`. Atlas vẫn là tài sản người
dùng cung cấp; giấy phép mã nguồn không thay giấy phép của ảnh.

263 SVG bổ sung lấy từ Njord/OpenS100 tại commit cố định, giữ giấy phép MPL-2.0.
Nguồn, manifest và cách tạo lại JSON/PNG: [sprites/README.md](sprites/README.md).
