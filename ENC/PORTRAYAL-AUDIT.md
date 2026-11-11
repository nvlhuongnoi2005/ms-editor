# Rà soát biểu diễn ENC — 11/11/2026

## Kết luận

**Chưa thể coi bộ hiển thị là đầy đủ hoặc chính xác toàn bộ theo S-52.**
Atlas có đủ ảnh cho các nhánh hiện được gọi; vẫn có lớp nguồn chưa được vẽ,
nhánh dùng ký hiệu chung và các thủ tục CSP chưa triển khai đầy đủ.

## Đối tượng LIGHTS trong ảnh

- Cell `US5WI32M`, LNAM `0226A7C7C7A43039`, RCID 30.
- Vị trí `-87.6438122, 44.0926969`.
- `COLOUR=[1]` (trắng), `VALNMR=10.4`, `LITCHR=7`, `CATLIT=null`;
  không có SECTR1/SECTR2. SCAMIN 29999, HEIGHT 15.8 m, SIGPER 6 s.
- Bộ chọn hiện gọi ảnh động vòng 360°, không gọi LIGHTS13. Đây là nhánh
  đèn toàn hướng tầm xa của LIGHTS06; không suy ra chọn nhầm icon chỉ vì
  tên lớp là LIGHTS. Browser xác nhận hình vuông ở tâm thuộc BUISGL đồng vị trí.
- Tại đúng vị trí có LNDMRK (Manitowoc Breakwater Light, CATLMK 17), FOGSIG,
  LIGHTS và BUISGL. Đó là bốn đối tượng riêng cùng vị trí trong dữ liệu.
- Browser xác nhận trước sửa: BUISGL giành placement của LNDMRK, nên chỉ
  thấy hình vuông công trình ở tâm, còn tháp và tín hiệu sương mù bị ẩn.
  Đã tách layer ưu tiên LNDMRK trước BUISGL và tách FOGSIG thành thành
  phần ghép cùng vị trí, như LIGHTS/TOPMAR; không ép mọi icon thường chồng nhau.
- Vòng này là ký hiệu trên màn hình, không phải đường tròn địa lý bán kính
  10.4 hải lý. Bán kính hiện tại 80 CSS px là profile viewer, chưa hiệu chuẩn
  kích thước vật lý 26 mm của sơ đồ LIGHTS06.

## Phạm vi đã kiểm tra

- 70 revision/cell active; 130252 bản ghi feature kể cả metadata.
- Sau khi bỏ M_* và primitive: 128615 đối tượng địa lý, 106 lớp.
- 232 ảnh/theme, cùng key ở day/dusk/night; 226 ảnh có tham chiếu, 6 ảnh
  được giữ riêng. Tất cả tên đầu ra bộ chọn có key trong atlas, nhưng **FSHFAC03
  có y=-140 ở cả ba theme**, là ô ảnh không hợp lệ. Chưa có FSHFAC/CATFIF=1
  trong dữ liệu active nên lỗi này chưa ảnh hưởng đối tượng đang được rà soát.
  Cần ảnh FSHFAC03 hợp lệ; không tự thay bằng một ký hiệu khác nghĩa.
- Chạy bộ lọc style thật ở z17, với hình học nguồn và điểm neo enc_symbols:
  6221 đối tượng không có biểu diễn phù hợp; 44 đối tượng chỉ có dấu hỏi
  dự phòng (SLCONS dạng điểm). Bảng chi tiết tại
  [DATASET-PORTRAYAL-COVERAGE.md](DATASET-PORTRAYAL-COVERAGE.md).
- 1727 LIGHTS: 278 dùng cung/vòng; 1447 dùng flare; 2 đèn đặc biệt.

Các số trên là **khả năng đi vào layer**, không chứng minh placement trên
màn hình, collision, chọn cell, lọc SCAMIN hay mọi nhánh CSP đúng. Chưa dựng
lại toàn bộ ngữ cảnh độ sâu/QUAPOS trong audit bộ lọc. Các trường hợp không
có biểu diễn còn bao gồm đối tượng chỉ mang tên hoặc thiếu thuộc tính để vẽ;
không được diễn giải tất cả 6221 trường hợp là thiếu icon cần gắn tùy ý.

## Lỗi LIGHTS đã sửa sau rà soát

- Không coi giới hạn sector bằng nhau hoặc 0–360 là sector thực.
- Không ép CATLIT 5/6 (đèn hàng không/chướng ngại hàng không) hoặc LITCHR 12
  (Morse) thành vòng đèn toàn hướng tầm xa. Dữ liệu có 7 trường hợp bị ảnh hưởng.
- Xét cả tổ hợp trắng/đỏ và trắng/xanh thay vì chỉ màu đầu tiên; dữ liệu có
  24 LIGHTS mang các tổ hợp này. Màu không xác định không bị đổi thành vàng.
- Hướng flare trắng/vàng/cam 45°, màu khác 135°; ORIENT của đèn định hướng
  được xử lý đối hướng. Đèn đặc biệt giữ hình riêng.
- Truyền LITVIS qua tile và vẽ sector bị che/kém nhìn thấy bằng cung đen
  nét đứt cho LITVIS 3/7/8; dữ liệu có 7 sector liên quan.

## Khoảng trống còn lại

- CBLOHD, CBLSUB, PIPSOL: chưa có đường cáp/ống; PIPOHD/CONVYR hiện chỉ có
  nhánh radar nổi bật, không có đường cơ sở khi nhánh đó không áp dụng.
- PONTON, DYKCON, DAMCON, DRYDOC, FLODOC, FNCLNE: thiếu biểu diễn công trình.
- RIVERS/CANALS/LAKARE, ROADWY/RUNWAY/TUNNEL/RAPIDS: thiếu đường/nền phù hợp.
- SEAARE chưa hiển thị tên; LNDRGN/SBDARE có trường hợp thiếu tên/thuộc tính.
- SLCONS dạng điểm dùng dấu hỏi; OBSTRN dạng đường và SLOTOP dạng đường chưa vẽ.
- Các khu vực hành chính/chuyên dụng như ADMARE, CONZNE, EXEZNE, TESARE,
  MIPARE, FSHZNE còn thiếu quy tắc biên/nhãn tương ứng.
- Nhiều layer tuy có thể vẽ vẫn chỉ dùng màu/nét/icon chung: kiểm tra độ bao
  phủ không xác nhận đúng CATCOA, CATSLC, CATSCF, mọi RESTRN hay display category.
- LIGHTS chưa đầy đủ LITDSN02 (chuỗi đặc tính đèn), mô tả ORIENT, leg-line
  định hướng, điều khiển Lights plus/full-length sectors và xử lý các sector
  trùng vị trí cần mở rộng bán kính. Chưa hiệu chuẩn kích thước vật lý.
- Các giới hạn CSP hazard, LC/AP và chữ số sounding đã ghi trong SPRITES.md
  vẫn còn; sử dụng đủ tên ảnh không thay thế triển khai các thủ tục này.

## Căn cứ

Đã đọc trực tiếp Symbol Catalogue 4.0(.3), Part I Addendum do người dùng
cung cấp (PDF 564 trang), nhất là p.155–160 cho LIGHTS11/12/13/81/82/LITDEF11.
Tài liệu này dẫn chiếu LIGHTS06 nhưng không chứa toàn bộ sơ đồ thủ tục.

Đối chiếu thêm sơ đồ và phần giải thích LIGHTS06 của
[IHO Part I draft 4.0.0, 2014](https://docs.iho.int/iho_pubs/draft_pubs/PresLib_e4.0.0/Part_I/S-52_PresLib_e4.0.0_Part%20I_Redline.pdf).
Đây là tài liệu bổ sung phiên bản cũ, không phải bằng chứng đã đạt toàn bộ
PresLib 4.0.3. Cần Part I/LUT/CSP đúng phiên bản và bộ kiểm tra chuẩn để xác
nhận đầy đủ; chưa đưa ra kết luận chứng nhận ở lần rà soát này.

## Chạy lại

```powershell
cd editor-web
node scripts/enc-dataset-audit.mjs ../ENC/DATASET-PORTRAYAL-COVERAGE.md
node --test scripts/enc-portrayal.test.mjs scripts/enc-import.test.mjs
npm run build:react
cd ..
python ENC/tools/check_portrayal_db.py
```

Audit chỉ SELECT từ dữ liệu active; fixture SQL dùng bảng tạm và rollback.

Kết quả sau sửa: build đạt; 22 test ENC đạt; `go test ./internal/enc` đạt;
fixture PostGIS đạt. Browser xác nhận LIGHTS/LNDMRK/FOGSIG cùng được đặt tại
tọa độ phản ánh trong ảnh, ở cả auto và explicit-cell scope; fixture đồng vị trí
và cung đèn đạt ở day/dusk/night, không có lỗi runtime hay request bên ngoài.
