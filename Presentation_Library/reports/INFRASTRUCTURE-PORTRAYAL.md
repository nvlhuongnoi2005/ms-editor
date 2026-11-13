# Bổ sung hạ tầng và nước nội địa — 11/11/2026

## Phạm vi hoàn thành

15 lớp, 13852 đối tượng nguồn trong 70 cell active đã có layer phù hợp với
hình học ở lần rà soát này:

| Nhóm | Biểu diễn |
|---|---|
| CBLOHD | Cáp trên không: nét đứt xám, nhãn VERCSA/VERCLR hợp lệ; radar nổi bật khi CONRAD 1/3 |
| CBLSUB | Cáp ngầm: đường lượn magenta; CATCBL 6 dùng nét đứt cho cáp phà |
| PIPOHD | Ống trên không: nét liền xám, nhãn độ cao thông thủy nếu có |
| PIPSOL | CATPIP 2/3/4/5 hoặc PRODCT 3: ống nước/xả/hút, xám với vòng nhỏ; còn lại: magenta với vòng lớn |
| PONTON/FLODOC | Đường: nét bờ; vùng: nền công trình và viền, không gắn icon vào mọi đoạn cầu phao |
| SLCONS điểm | MORFAC03 theo point lookup; QUAPOS không chắc chắn bổ sung cảnh báo, không dùng dấu hỏi fallback cho cả lớp |
| SLCONS đường/vùng | CONDTN 1/2: nét đứt mảnh; CATSLC 6/15/16: nét liền đậm; WATLEV 3/4: nét đứt; còn lại: nét liền |
| SLCONS độ tin cậy thấp | Nét kèm dấu hỏi thay nét bờ thường; không thêm LOWACC01 ở tâm một polygon SLCONS |
| SLCONS vùng chìm | WATLEV 3 giữ nền độ sâu phía dưới; WATLEV 4 dùng màu vùng triều; WATLEV thiếu không tự tô đất |
| RIVERS/CANALS/LAKARE | Vùng nước, viền bờ hoặc đường sông/kênh; nhãn nếu có OBJNAM. Nhãn vùng dùng anchor từ hình học gốc |
| DYKCON/DAMCON | Đê/đập dạng đường hoặc vùng; viền và nền tương ứng |
| DRYDOC/FNCLNE/CONVYR | Ụ khô, hàng rào và băng tải có nét/nền tương ứng; băng tải phân biệt CATCON và radar CONRAD |

CONDTN/CATSLC/CATCBL/CATPIP/PRODCT/CATCON/CATDAM/STATUS được chuẩn hóa trong
tile cùng các thuộc tính khác; giữ nguyên thuộc tính nguồn. Mọi kiểm tra danh
sách xét mã đầy đủ, không chỉ phần tử đầu. SCAMIN và chọn cell tiếp tục áp dụng.

## Sửa FSHFAC03

Hình thật của cọc đăng đã có trong pattern FSHFAC03P của atlas được cung cấp.
Đã đối chiếu hình năm cọc với SY(FSHFAC03), catalogue p.137, rồi sửa metadata
FSHFAC03 ở cả day/dusk/night từ `(0,-140)` sang `(2754,280)`, giữ kích thước
48×14 và pixelRatio=2. Đây là cùng hình, không thay bằng icon khác và không
vẽ lại PNG. Đã bổ sung pivot của FSHFAC03 theo catalogue.

## Kết quả rà soát

- Trước bổ sung: 6221 đối tượng không có layer phù hợp; 44 fallback dấu hỏi.
- Sau bổ sung: 2140 đối tượng không có layer phù hợp; 0 fallback dấu hỏi trong
  phép đánh giá hình học nguồn. Thêm biểu diễn cho 4125 đối tượng trước đó bị bỏ sót/fallback.
- 232 ảnh/theme của giai đoạn này đều có ô ảnh hợp lệ; không còn lỗi tọa độ FSHFAC03.
  Sau đó đã mở rộng thành 499 ảnh/theme, xem [sprites/README.md](sprites/README.md).
- Đã build frontend và xem trực tiếp các lớp mới tại 15 vị trí dữ liệu thật;
  nguồn ảnh pattern nạp được ở ba theme, không thấy lỗi runtime trong phiên xem.
- Không thêm hoặc chạy bộ test tự động trong đợt này. Audit là truy vấn SELECT
  và đánh giá khả năng đi vào layer, không xác nhận mọi placement hoặc mọi CSP.

Chi tiết từng lớp: [DATASET-PORTRAYAL-COVERAGE.md](DATASET-PORTRAYAL-COVERAGE.md).

## Căn cứ và giới hạn

Đối chiếu catalogue IHO 4.0(.3) người dùng cung cấp: SY(MORFAC03) p.174,
SY(FSHFAC03) p.137; LC(CBLSUB06) p.482, LC(LOWACC21) p.504,
LC(PIPSOL05/06) p.513–514. Tham khảo cấu trúc lookup và phân nhánh công trình tại
[OpenCPN chartsymbols.xml](https://github.com/OpenCPN/OpenCPN/blob/master/data/s57data/chartsymbols.xml)
và [SLCONS03](https://github.com/OpenCPN/OpenCPN/blob/master/libs/s52plib/src/s52cnsy.cpp).
Point lookup SLCONS cũng được ghi trong
[tài liệu IHO về thay đổi LUT](https://legacy.iho.int/mtg_docs/com_wg/TSMAD/TSMAD26/TSMAD26_DIPWG5-9.1C_S-101_Portrayal_LUT_Changes.pdf).
Không đưa mã hoặc tài sản OpenCPN vào ứng dụng.

Trong bản atlas mở rộng 499 ảnh/theme, các texture LC được đóng gói từ SVG vào
JSON/PNG thay cho Canvas trong resolver ảnh:
đường lượn cáp, đường nối vòng của ống và dấu chất lượng bờ. Đây là cách dựng
nét liên tục theo profile CSS px; chưa phải bộ giải mã đầy đủ mọi lệnh LC/HPGL,
chưa hiệu chuẩn kích thước mm, chưa xác nhận căn pha pattern tại mọi đường
biên tile hoặc QUAPOS riêng từng đoạn primitive. Không coi bổ sung này là chứng nhận S-52.

Những lớp ngoài phạm vi yêu cầu như SEAARE, ADMARE, OBSTRN dạng đường,
SLOTOP, ROADWY/RUNWAY/TUNNEL, RAPIDS… vẫn được liệt kê riêng trong audit.
