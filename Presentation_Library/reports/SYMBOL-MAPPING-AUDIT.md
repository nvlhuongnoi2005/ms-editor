# Rà soát ánh xạ ký hiệu — 12/11/2026

Đã kiểm tra 499 ảnh/theme ở cả ngày, chạng vạng và đêm: cùng mã, cùng hình chữ nhật cắt ảnh, nằm trong PNG, có giải thích. Mọi đầu ra tĩnh trong các registry điểm/vùng/điểm neo đường/đường/pattern đều có ảnh và tìm được bằng lớp đối tượng. 228 ảnh có liên kết lớp trong các registry này hoặc texture hạ tầng. Các ảnh còn lại có thể là chữ số, thành phần bổ trợ, ảnh dự trữ hoặc nhánh chưa triển khai; không mặc định là sai ảnh.

## Trường hợp Manitowoc Marina

Dữ liệu active: cell US5WI32M, LNAM 02267C8AC27E5F16, lớp HRBFAC, CATHAF=["5"]. Nhánh chọn đúng là SMCFAC02 (bến du thuyền). HRBFAC09 là cảng cá, CATHAF=4. CATHAF=1 chọn ROLROL01; loại chưa có nhánh chuyên biệt chọn CHINFO07. Không suy ra hình chỉ từ tiền tố tên lớp.

Nguồn đối chiếu: [IHO Symbol Catalogue 4.0(.3), SMCFAC02 và HRBFAC09](https://iho.int/uploads/user/pubs/standards/s-52/S-52%20PresLib%20Ed%204.0.3%20Part%20I%20Addendum_Clean.pdf). Đây là catalogue hình; kiểm tra atlas không thay cho LUT/CSP đầy đủ của Presentation Library.

Đã sửa bảng tra cứu để tìm theo lớp và mọi nhánh thuộc tính từ chính registry của renderer. Bảng thuộc tính hiển thị mã và ảnh ký hiệu chính, đồng thời đưa CATHAF/CATSCF lên gần tên đối tượng. Ký hiệu chính không bao gồm toàn bộ thành phần ghép (cung đèn, chữ, texture, dấu chất lượng).

## Giới hạn và khoảng thiếu

Ảnh hợp lệ, giải thích tồn tại và nhánh chọn không trỏ ảnh thiếu không đủ chứng minh mọi tình huống đúng S-52. Kiểm thử có đối chiếu các trường hợp nguy hiểm, đèn, phương vị, dấu đỉnh, conspicuity, hình học và cảng; chưa có chứng nhận đầy đủ LUT/CSP/S-64. Các trường hợp dùng fallback CHINFO07 và nhánh chưa triển khai vẫn cần đối chiếu bộ quy tắc gốc.

Audit active hiện tại: 129.187 đối tượng địa lý, 107 lớp; 2.158 đối tượng chưa có layer phù hợp, không có ảnh yêu cầu bị thiếu hoặc sprite ngoài atlas. Xem [chi tiết theo lớp](DATASET-PORTRAYAL-COVERAGE.md). Audit đọc thuộc tính từ runtime chuẩn trong Presentation_Library; đã sửa đường dẫn đọc cũ vốn chỉ còn wrapper export.

Chạy lại: node --test scripts/enc-symbol-mapping.test.mjs scripts/enc-portrayal.test.mjs, node scripts/enc-symbol-audit.mjs, node scripts/enc-dataset-audit.mjs ../Presentation_Library/reports/DATASET-PORTRAYAL-COVERAGE.md. Kiểm tra trên dữ liệu thực và giao diện: scripts/enc-symbol-mapping.browser.mjs.

## Danh sách toàn bộ atlas

Liên kết dưới đây là tập nhánh có thể chọn, không phải khẳng định mọi đối tượng của một lớp đều dùng cùng một hình. Các điều kiện thuộc tính vẫn do runtime/sprites.ts quyết định. Cung đèn động được dựng riêng, không phải ảnh tĩnh trong bảng.

| Mã hình | Giải thích | Lớp và cách dùng trong registry |
|---|---|---|
| ACHARE02 | Khu neo đậu biểu diễn bằng điểm; điểm neo của hệ thống dây neo ở tỷ lệ lớn. | OBSTRN (điểm), ACHARE (điểm), ACHPNT (điểm), OBSTRN (vùng), ACHPNT (vùng) |
| ACHARE51 | Khu neo đậu, ký hiệu đặt giữa vùng. | ACHARE (vùng) |
| ACHBRT07 | Vị trí neo được chỉ định cho một tàu. | ACHBRT (điểm), ACHBRT (vùng) |
| ACHRES51 | Khu vực cấm hoặc hạn chế thả neo. | RESARE (điểm), RESARE (vùng) |
| ACHRES61 | Khu vực cấm hoặc hạn chế thả neo; có cảnh báo bổ sung. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| ACHRES71 | Khu vực cấm hoặc hạn chế thả neo; có thông tin bổ sung. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| AIRARE02 | Sân bay, biểu diễn bằng điểm. | AIRARE (điểm), AIRARE (vùng) |
| AIRARE02P | Mẫu phủ khu vực sân bay. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BCNCAR01 | Mốc phương vị hướng Bắc; vùng nước an toàn ở phía Bắc của báo hiệu. | BCNCAR (điểm), BCNCAR (vùng) |
| BCNCAR02 | Mốc phương vị hướng Đông; vùng nước an toàn ở phía Đông của báo hiệu. | BCNCAR (điểm), BCNCAR (vùng) |
| BCNCAR03 | Mốc phương vị hướng Nam; vùng nước an toàn ở phía Nam của báo hiệu. | BCNCAR (điểm), BCNCAR (vùng) |
| BCNCAR04 | Mốc phương vị hướng Tây; vùng nước an toàn ở phía Tây của báo hiệu. | BCNCAR (điểm), BCNCAR (vùng) |
| BCNDEF13 | Mốc báo hiệu cố định chưa xác định được loại. | BCNCAR (điểm), BCNSAW (điểm), BCNSPP (điểm), BCNLAT (điểm), BCNCAR (vùng), BCNSAW (vùng), BCNSPP (vùng), BCNLAT (vùng) |
| BCNGEN01 | Mốc báo hiệu cố định; dạng tổng quát trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BCNGEN03 | Mốc báo hiệu cố định; dạng mặc định trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BCNISD21 | Mốc báo hiệu nguy hiểm biệt lập. | BCNISD (điểm), BCNISD (vùng) |
| BCNLAT15 | Mốc báo hiệu luồng chính, màu đỏ. | BCNSAW (điểm), BCNSPP (điểm), BCNLAT (điểm), BCNSAW (vùng), BCNSPP (vùng), BCNLAT (vùng) |
| BCNLAT16 | Mốc báo hiệu luồng chính, màu xanh lục. | BCNSAW (điểm), BCNSPP (điểm), BCNLAT (điểm), BCNSAW (vùng), BCNSPP (vùng), BCNLAT (vùng) |
| BCNLAT21 | Mốc báo hiệu luồng phụ, màu đỏ. | BOYLAT (điểm), BCNSAW (điểm), BCNSPP (điểm), BCNLAT (điểm), BOYLAT (vùng), BCNSAW (vùng), BCNSPP (vùng), BCNLAT (vùng) |
| BCNLAT22 | Mốc báo hiệu luồng phụ, màu xanh lục. | BOYLAT (điểm), BCNSAW (điểm), BCNSPP (điểm), BCNLAT (điểm), BOYLAT (vùng), BCNSAW (vùng), BCNSPP (vùng), BCNLAT (vùng) |
| BCNLTC01 | Mốc báo hiệu cố định dạng giàn; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BCNSAW13 | Mốc báo hiệu vùng nước an toàn, dạng chính. | BCNSAW (điểm), BCNSPP (điểm), BCNLAT (điểm), BCNSAW (vùng), BCNSPP (vùng), BCNLAT (vùng) |
| BCNSAW21 | Mốc báo hiệu vùng nước an toàn, dạng phụ. | BOYLAT (điểm), BCNSAW (điểm), BCNSPP (điểm), BCNLAT (điểm), BOYLAT (vùng), BCNSAW (vùng), BCNSPP (vùng), BCNLAT (vùng) |
| BCNSPP13 | Mốc báo hiệu chuyên dùng, dạng chính. | BCNSAW (điểm), BCNSPP (điểm), BCNLAT (điểm), BCNSAW (vùng), BCNSPP (vùng), BCNLAT (vùng) |
| BCNSPP21 | Mốc báo hiệu chuyên dùng, dạng phụ. | BOYLAT (điểm), BCNSAW (điểm), BCNSPP (điểm), BCNLAT (điểm), BOYLAT (vùng), BCNSAW (vùng), BCNSPP (vùng), BCNLAT (vùng) |
| BCNSTK02 | Mốc báo hiệu cố định dạng cọc hoặc sào; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BCNTOW01 | Mốc báo hiệu cố định dạng tháp; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BLKADJ01 | Dấu kiểm tra màn hình; dùng để điều chỉnh độ sáng và độ tương phản. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYBAR01 | Phao hình thùng; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYCAN01 | Phao hình trụ; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYCAR01 | Phao phương vị hướng Bắc; vùng nước an toàn ở phía Bắc của báo hiệu. | BOYCAR (điểm), BOYCAR (vùng) |
| BOYCAR02 | Phao phương vị hướng Đông; vùng nước an toàn ở phía Đông của báo hiệu. | BOYCAR (điểm), BOYCAR (vùng) |
| BOYCAR03 | Phao phương vị hướng Nam; vùng nước an toàn ở phía Nam của báo hiệu. | BOYCAR (điểm), BOYCAR (vùng) |
| BOYCAR04 | Phao phương vị hướng Tây; vùng nước an toàn ở phía Tây của báo hiệu. | BOYCAR (điểm), BOYCAR (vùng) |
| BOYCON01 | Phao hình nón; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYDEF03 | Phao chưa xác định được loại. | BOYLAT (điểm), BOYCAR (điểm), BOYSPP (điểm), BOYINB (điểm), BOYLAT (vùng), BOYCAR (vùng), BOYSPP (vùng), BOYINB (vùng) |
| BOYGEN03 | Phao báo hiệu; dạng mặc định trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYINB01 | Phao phục vụ công trình; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYISD12 | Phao báo hiệu nguy hiểm biệt lập. | BOYISD (điểm), BOYISD (vùng) |
| BOYLAT13 | Phao luồng hình nón, màu xanh lục. | BOYLAT (điểm), BOYLAT (vùng) |
| BOYLAT14 | Phao luồng hình nón, màu đỏ. | BOYLAT (điểm), BOYLAT (vùng) |
| BOYLAT23 | Phao luồng hình trụ, màu xanh lục. | BOYLAT (điểm), BOYLAT (vùng) |
| BOYLAT24 | Phao luồng hình trụ, màu đỏ. | BOYLAT (điểm), BOYLAT (vùng) |
| BOYMOR01 | Phao neo hình thùng; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYMOR03 | Phao neo hình trụ; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYMOR11 | Phao neo hoặc phao phục vụ công trình. | MORFAC (điểm), MORFAC (vùng), MORFAC (điểm neo trên đường) |
| BOYPIL01 | Phao dạng cột; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYSAW12 | Phao báo hiệu vùng nước an toàn. | BOYLAT (điểm), BOYSAW (điểm), BOYLAT (vùng), BOYSAW (vùng) |
| BOYSPH01 | Phao hình cầu; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYSPP11 | Phao chuyên dùng hình cầu, hình thùng hoặc dạng mặc định. | BOYLAT (điểm), BOYSAW (điểm), BOYSPP (điểm), BOYLAT (vùng), BOYSAW (vùng), BOYSPP (vùng) |
| BOYSPP15 | Phao chuyên dùng phân luồng, đánh dấu phía mạn phải của làn giao thông. | BOYLAT (điểm), BOYSPP (điểm), BOYLAT (vùng), BOYSPP (vùng) |
| BOYSPP25 | Phao chuyên dùng phân luồng, đánh dấu phía mạn trái của làn giao thông. | BOYLAT (điểm), BOYSPP (điểm), BOYLAT (vùng), BOYSPP (vùng) |
| BOYSPP35 | Phao chuyên dùng dạng cột, dạng sào hoặc phao băng. | BOYSPP (điểm), BOYSPP (vùng) |
| BOYSPR01 | Phao dạng sào; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYSUP01 | Phao báo hiệu cỡ lớn; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BOYSUP02 | Phao lớn dùng cho quan trắc hải dương ODAS hoặc báo hiệu tự động LANBY. | BOYLAT (điểm), BOYSPP (điểm), BOYLAT (vùng), BOYSPP (vùng) |
| BOYSUP03 | Phao báo hiệu hàng hải tự động cỡ lớn (LANBY); dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| BRIDGE01 | Cầu có thể mở cho tàu đi qua. | BRIDGE (vùng), BRIDGE (điểm neo trên đường) |
| BRTHNO01 | Ký hiệu số hiệu vị trí cầu bến. | BERTHS (điểm), BERTHS (vùng) |
| BUAARE02 | Khu vực xây dựng, biểu diễn bằng điểm ở tỷ lệ nhỏ. | BUAARE (điểm), BUAARE (vùng) |
| BUIREL01 | Công trình tôn giáo Cơ Đốc giáo. | LNDMRK (điểm), BUISGL (điểm) |
| BUIREL04 | Công trình tôn giáo ngoài Cơ Đốc giáo. | LNDMRK (điểm), BUISGL (điểm) |
| BUIREL05 | Nhà thờ Hồi giáo hoặc tháp giáo đường. | LNDMRK (điểm), BUISGL (điểm) |
| BUIREL13 | Công trình tôn giáo Cơ Đốc giáo dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm) |
| BUIREL14 | Công trình tôn giáo ngoài Cơ Đốc giáo dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm) |
| BUIREL15 | Nhà thờ Hồi giáo hoặc tháp giáo đường dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm) |
| BUISGL01 | Tòa nhà đơn lẻ. | BUISGL (điểm) |
| BUISGL11 | Tòa nhà đơn lẻ dễ nhận biết từ biển. | BUISGL (điểm) |
| CAIRNS01 | Ụ đá dùng làm mốc nhận biết. | LNDMRK (điểm), BUISGL (điểm) |
| CAIRNS11 | Ụ đá dễ nhận biết từ biển. | BCNSAW (điểm), BCNSPP (điểm), BCNLAT (điểm), LNDMRK (điểm), BUISGL (điểm), BCNSAW (vùng), BCNSPP (vùng), BCNLAT (vùng) |
| CBLARE51 | Khu vực có cáp ngầm dưới biển. | CBLARE (điểm), CBLARE (vùng) |
| CGUSTA02 | Trạm tuần duyên. | CGUSTA (điểm), CGUSTA (vùng) |
| CHCRDEL1 | Dấu cập nhật thủ công; đối tượng đã được xóa hoặc sửa đổi. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CHCRID01 | Dấu cập nhật thủ công; đối tượng đã được cập nhật. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CHDATD01 | Dấu phụ thuộc thời gian; đối tượng có hiệu lực theo ngày quy định. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CHIMNY01 | Ống khói. | LNDMRK (điểm), BUISGL (điểm) |
| CHIMNY11 | Ống khói dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm) |
| CHINFO06 | Ghi chú cảnh báo của cơ quan thủy đạc. | CTNARE (điểm), RESARE (điểm), CTNARE (vùng), RESARE (vùng) |
| CHINFO07 | Ghi chú thông tin của cơ quan thủy đạc. | HRBFAC (điểm), CTSARE (điểm), DMPGRD (điểm), ICNARE (điểm), PIPARE (điểm), SPLARE (điểm), HRBFAC (vùng), CTSARE (vùng), DMPGRD (vùng), ICNARE (vùng), PIPARE (vùng), SPLARE (vùng) |
| CHINFO08 | Ghi chú thông tin do người đi biển tạo. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CHINFO09 | Ghi chú cảnh báo do người đi biển tạo. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CHINFO10 | Ghi chú thông tin của nhà sản xuất hệ thống. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CHINFO11 | Ghi chú cảnh báo của nhà sản xuất hệ thống. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CHKPNT01 | Hải quan hoặc điểm kiểm soát hải quan. | BUISGL (điểm), CHKPNT (điểm), CHKPNT (vùng) |
| CHKSYM01 | Dấu kiểm tra kích thước ký hiệu; kích thước chuẩn 5 mm × 5 mm. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CHRVDEL1 | Dấu cập nhật tự động; đối tượng đã được xóa. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CHRVID01 | Dấu cập nhật tự động; đối tượng đã được thêm hoặc sửa đổi. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CRANES01 | Cần cẩu. | CRANES (điểm), CRANES (vùng) |
| CTNARE51 | Khu vực cần thận trọng; có ghi chú cảnh báo riêng. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CTYARE51 | Khu vực cần thận trọng khi hành hải. | OSPARE (điểm), OSPARE (vùng) |
| CTYARE71 | Khu vực cần thận trọng; có thông tin bổ sung. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| CURDEF01 | Dòng chảy hoặc dòng triều chưa xác định hướng. | CURENT (điểm), TS_FEB (điểm), CURENT (vùng), TS_FEB (vùng) |
| CURENT01 | Dòng chảy không do thủy triều; hướng mũi tên theo hướng dòng chảy. | CURENT (điểm), TS_FEB (điểm), CURENT (vùng), TS_FEB (vùng) |
| DANGER01 | Chướng ngại dưới nước có độ sâu xác định, không lớn hơn 20 m. | WRECKS (điểm), UWTROC (điểm), OBSTRN (điểm), WRECKS (vùng), UWTROC (vùng), OBSTRN (vùng) |
| DANGER02 | Chướng ngại dưới nước có độ sâu lớn hơn 20 m. | WRECKS (điểm), UWTROC (điểm), OBSTRN (điểm), WRECKS (vùng), UWTROC (vùng), OBSTRN (vùng) |
| DANGER03 | Chướng ngại lúc nổi lúc chìm theo thủy triều. | WRECKS (điểm), UWTROC (điểm), OBSTRN (điểm), WRECKS (vùng), UWTROC (vùng), OBSTRN (vùng) |
| DAYSQR01 | Dấu hiệu ban ngày hình vuông hoặc hình chữ nhật. | DAYMAR (điểm), DAYMAR (vùng) |
| DAYSQR21 | Dấu hiệu ban ngày hình vuông hoặc hình chữ nhật; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DAYTRI01 | Dấu hiệu ban ngày hình tam giác, đỉnh hướng lên. | DAYMAR (điểm), DAYMAR (vùng) |
| DAYTRI05 | Dấu hiệu ban ngày hình tam giác, đỉnh hướng xuống. | DAYMAR (điểm), DAYMAR (vùng) |
| DAYTRI21 | Dấu hiệu ban ngày hình tam giác, đỉnh hướng lên; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DAYTRI25 | Dấu hiệu ban ngày hình tam giác, đỉnh hướng xuống; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DIAMOND1P | Mẫu phủ vùng nước có độ sâu nhỏ hơn giá trị đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DIRBOY01 | Hướng quy ước của hệ thống báo hiệu phao. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DIRBOYA1 | Hướng báo hiệu khi vào cảng theo hệ thống IALA vùng A; phao đỏ ở bên trái tàu. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DIRBOYB1 | Hướng báo hiệu khi vào cảng theo hệ thống IALA vùng B; phao xanh lục ở bên trái tàu. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DISMAR06 | Mốc khoảng cách, biến thể trong bộ ký hiệu hiện có. | DISMAR (điểm), DISMAR (vùng) |
| DNGHILIT | Lớp đánh dấu trong suốt để người đi biển làm nổi bật nguy hiểm. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DOMES001 | Công trình dạng mái vòm. | LNDMRK (điểm), BUISGL (điểm) |
| DOMES011 | Công trình mái vòm dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm) |
| DQUALA11P | Mẫu phủ chất lượng khảo sát A1; độ chính xác vị trí 5 m, khảo sát bao phủ toàn bộ đáy biển. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DQUALA21P | Mẫu phủ chất lượng khảo sát A2; độ chính xác vị trí 20 m, khảo sát bao phủ toàn bộ đáy biển. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DQUALB01P | Mẫu phủ chất lượng khảo sát B; độ chính xác vị trí 50 m, khảo sát theo các tuyến đo sâu liên tục. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DQUALC01P | Mẫu phủ chất lượng khảo sát C; độ chính xác thấp hoặc dữ liệu chưa đầy đủ. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DQUALD01P | Mẫu phủ chất lượng khảo sát D; dữ liệu không đáng tin cậy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DQUALU01P | Mẫu phủ chất lượng khảo sát U; chưa đánh giá chất lượng dữ liệu. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DRFSTA01 | Trạm tham chiếu định vị vệ tinh vi sai (DGPS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DRGARE01P | Mẫu phủ phủ khu vực được nạo vét. | DRGARE (mẫu phủ) |
| DSHAER01 | Ăng-ten chảo. | LNDMRK (điểm), BUISGL (điểm) |
| DSHAER11 | Ăng-ten chảo dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm) |
| DWRTPT51 | Một phần tuyến nước sâu. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| DWRUTE51 | Tuyến hành hải dành cho tàu có mớn nước sâu. | DWRTPT (điểm), DWRTPT (vùng) |
| EBBSTR01 | Dòng triều rút; tốc độ thể hiện cho kỳ triều cường. | TS_FEB (điểm), TS_FEB (vùng) |
| EBLVRM11 | Gốc dịch chuyển của đường phương vị điện tử (EBL) hoặc vòng cự ly biến đổi (VRM). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| ENTRES51 | Khu vực cấm hoặc hạn chế đi vào. | RESARE (điểm), RESARE (vùng) |
| ENTRES61 | Khu vực cấm, hạn chế ra vào hoặc cần tránh; có cảnh báo bổ sung. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| ENTRES71 | Khu vực cấm, hạn chế ra vào hoặc cần tránh; có thông tin bổ sung. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| ESSARE01 | Khu vực biển nhạy cảm về môi trường (ESSA); ký hiệu đặt giữa vùng. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| FAIRWY51 | Luồng hàng hải một chiều; hướng đi theo ký hiệu chỉ dẫn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| FAIRWY52 | Luồng hàng hải hai chiều. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| FLASTK01 | Tháp đốt khí. | LNDMRK (điểm), BUISGL (điểm), PRDARE (điểm) |
| FLASTK11 | Tháp đốt khí dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm), PRDARE (điểm) |
| FLDSTR01 | Dòng triều lên; tốc độ thể hiện cho kỳ triều cường. | TS_FEB (điểm), TS_FEB (vùng) |
| FLGSTF01 | Cột cờ. | LNDMRK (điểm), BUISGL (điểm) |
| FLTHAZ02 | Vật nổi gây nguy hiểm cho hàng hải. | OBSTRN (điểm), OBSTRN (vùng) |
| FOGSIG01 | Thiết bị phát tín hiệu sương mù. | FOGSIG (điểm), FOGSIG (vùng) |
| FORSTC01 | Công trình phòng thủ hoặc thành lũy. | FORSTC (điểm), FORSTC (vùng) |
| FORSTC11 | Công trình phòng thủ dễ nhận biết từ biển. | FORSTC (điểm), FORSTC (vùng) |
| FOULAR01P | Mẫu phủ vùng đáy biển có vật cản. | OBSTRN (mẫu phủ) |
| FOULGND1 | Đáy biển có vật cản: có thể hành hải nhưng không an toàn để thả neo. | WRECKS (điểm), OBSTRN (điểm), WRECKS (vùng), OBSTRN (vùng) |
| FRYARE51 | Khu vực tuyến phà. | FERYRT (đường) |
| FRYARE52 | Khu vực tuyến phà kéo cáp. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| FSHFAC02 | Cọc hoặc hàng cọc phục vụ đánh bắt cá. | FSHFAC (điểm), FSHFAC (vùng) |
| FSHFAC03 | Ký hiệu cọc đánh bắt cá trong vùng. | FSHFAC (điểm), FSHFAC (vùng) |
| FSHFAC03P | Mẫu phủ vùng có cọc đánh bắt cá. | FSHFAC (mẫu phủ) |
| FSHFAC04P | Mẫu phủ vùng có bẫy cá, đăng cá hoặc lưới cố định. | FSHFAC (mẫu phủ) |
| FSHGRD01 | Ngư trường. | FSHGRD (điểm), FSHGRD (vùng) |
| FSHHAV01 | Khu vực tạo nơi trú cho cá bằng công trình hoặc vật thể dưới nước. | OBSTRN (điểm), OBSTRN (vùng) |
| FSHHAV02P | Mẫu phủ vùng công trình đánh bắt cá. | FSHFAC (mẫu phủ) |
| FSHRES51 | Khu vực cấm hoặc hạn chế đánh bắt cá hoặc kéo lưới. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| FSHRES61 | Khu vực cấm hoặc hạn chế đánh bắt cá hoặc kéo lưới; có cảnh báo bổ sung. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| FSHRES71 | Khu vực cấm hoặc hạn chế đánh bắt cá hoặc kéo lưới; có thông tin bổ sung. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| GATCON03 | Cửa âu hoặc cửa cống có thể cho tàu đi qua. | GATCON (điểm), GATCON (vùng), GATCON (đường) |
| GATCON04 | Cửa âu hoặc cửa cống không cho tàu đi qua. | GATCON (điểm), GATCON (vùng), GATCON (đường) |
| HILTOP01 | Đỉnh đồi hoặc đỉnh núi. | SLOGRD (điểm), SLOTOP (điểm) |
| HILTOP11 | Đỉnh đồi hoặc đỉnh núi dễ nhận biết từ biển. | SLOTOP (điểm) |
| HRBFAC09 | Cảng cá. | HRBFAC (điểm), HRBFAC (vùng) |
| HULKES01 | Xác tàu được giữ lại để sử dụng cố định. | HULKES (điểm), HULKES (vùng) |
| ICEARE04P | Mẫu phủ vùng băng, chẳng hạn sông băng. | ICEARE (mẫu phủ) |
| INDHLT01 | Dấu làm nổi bật thông tin; do người đi biển sử dụng. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| INFARE51 | Khu vực có hạn chế nhỏ hoặc thông báo thông tin. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| INFORM01 | Dấu thông tin bổ sung; chọn đối tượng để tra cứu. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| ISODGR01 | Nguy hiểm biệt lập nông hơn đường đồng sâu an toàn trong vùng nước an toàn. | WRECKS (điểm), UWTROC (điểm), OBSTRN (điểm), WRECKS (vùng), UWTROC (vùng), OBSTRN (vùng) |
| ITZARE51 | Vùng giao thông ven bờ. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| LC_CBLSUB06 | Đường cáp ngầm. | CBLSUB |
| LC_LOWACC21 | Đường bờ hoặc công trình bờ có vị trí chưa chắc chắn. | SLCONS |
| LC_PIPSOL05 | Đường ống dầu, khí hoặc chưa rõ loại. | PIPSOL |
| LC_PIPSOL06 | Đường ống nước, xả thải hoặc hút nước. | PIPSOL |
| LIGHTS11 | Tia sáng của đèn màu đỏ. | LIGHTS (điểm), LIGHTS (vùng) |
| LIGHTS12 | Tia sáng của đèn màu xanh lục. | LIGHTS (điểm), LIGHTS (vùng) |
| LIGHTS13 | Tia sáng của đèn màu trắng hoặc vàng. | LIGHTS (điểm), LIGHTS (vùng) |
| LIGHTS81 | Đèn dải. | LIGHTS (điểm), LIGHTS (vùng) |
| LIGHTS82 | Đèn pha chiếu sáng. | LIGHTS (điểm), LIGHTS (vùng) |
| LITDEF11 | Tia sáng của đèn, dạng mặc định. | LIGHTS (điểm), LIGHTS (vùng) |
| LITFLT01 | Phao đèn; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| LITFLT02 | Phao đèn. | LITFLT (điểm), LITFLT (vùng) |
| LITVES01 | Tàu đèn; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| LITVES02 | Tàu đèn. | LITVES (điểm), LITVES (vùng) |
| LNDARE01 | Phần đất biểu diễn bằng điểm ở tỷ lệ nhỏ. | LNDARE (điểm) |
| LOCMAG01 | Vị trí tra cứu thông tin dị thường từ trường. | LOCMAG (điểm), LOCMAG (vùng), LOCMAG (điểm neo trên đường) |
| LOCMAG51 | Điểm tra cứu dị thường từ trường; áp dụng cho đối tượng dạng đường hoặc vùng. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| LOWACC01 | Đối tượng hoặc vùng có độ chính xác vị trí thấp. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| MAGVAR01 | Vị trí tra cứu thông tin độ lệch từ. | MAGVAR (điểm), MAGVAR (vùng) |
| MAGVAR51 | Điểm tra cứu độ lệch từ; áp dụng cho đối tượng dạng đường hoặc vùng. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| MARCUL02 | Khu nuôi trồng thủy sản. | MARCUL (điểm), MARCUL (vùng) |
| MARCUL02P | Mẫu phủ vùng nuôi trồng thủy sản. | MARCUL (mẫu phủ) |
| MARSHES1P | Mẫu phủ vùng đầm lầy. | LNDRGN (mẫu phủ) |
| MONUMT02 | Tượng đài. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| MONUMT12 | Tượng đài hoặc công trình tưởng niệm dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm) |
| MORFAC03 | Trụ hoặc cụm cọc phục vụ neo buộc tàu. | MORFAC (điểm), SLCONS (điểm), MORFAC (vùng), MORFAC (điểm neo trên đường) |
| MORFAC04 | Trụ neo dùng để hiệu chỉnh độ lệch la bàn. | MORFAC (điểm), MORFAC (vùng), MORFAC (điểm neo trên đường) |
| MSTCON04 | Cột hoặc cột buồm. | LNDMRK (điểm), BUISGL (điểm) |
| MSTCON14 | Cột hoặc cột buồm dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm) |
| NEWOBJ01 | Đối tượng mới chưa có trong hệ thống lớp đối tượng tiêu chuẩn. | NEWOBJ (điểm), NEWOBJ (vùng), NEWOBJ (điểm neo trên đường) |
| NODATA03P | Mẫu phủ vùng không có dữ liệu hải đồ. | UNSARE (mẫu phủ) |
| NORTHAR1 | Mũi tên chỉ hướng Bắc. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| NOTBRD11 | Bảng thông báo dễ nhận biết từ biển. | BCNSPP (điểm), BCNSPP (vùng) |
| OBSTRN01 | Chướng ngại chưa có thông tin độ sâu. | OBSTRN (điểm), OBSTRN (vùng) |
| OBSTRN02 | Chướng ngại trong vùng triều; ký hiệu của thủ tục OBSTRN cũ. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| OBSTRN03 | Chướng ngại lúc nổi lúc chìm theo thủy triều. | OBSTRN (điểm), OBSTRN (vùng) |
| OBSTRN11 | Chướng ngại luôn nằm trên mặt nước. | OBSTRN (điểm), OBSTRN (vùng) |
| OFSPLF01 | Giàn hoặc công trình ngoài khơi. | OFSPLF (điểm), OFSPLF (vùng) |
| OVERSC01P | Mẫu phủ phần hiển thị vượt tỷ lệ biên tập; màn hình sử dụng dữ liệu thuộc nhiều mục đích hàng hải. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| PILBOP02 | Vị trí đón, trả hoa tiêu. | PILBOP (điểm), PILBOP (vùng) |
| PILPNT02 | Cọc hoặc bích neo. | MORFAC (điểm), PILPNT (điểm), MORFAC (vùng), PILPNT (vùng), MORFAC (điểm neo trên đường) |
| POSGEN01 | Vị trí của đối tượng dạng điểm. | LNDMRK (điểm), BUISGL (điểm), GATCON (điểm), PRDARE (điểm), VEGATN (điểm), GATCON (vùng), PRDARE (vùng), VEGATN (vùng) |
| POSGEN03 | Vị trí của đối tượng dạng điểm dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm), PYLONS (điểm), PYLONS (vùng) |
| POSGEN04 | Vị trí điểm độ cao hoặc điểm khống chế. | CHKPNT (điểm), CTRPNT (điểm), LNDELV (điểm), LNDRGN (điểm), CHKPNT (vùng), CTRPNT (vùng) |
| PRCARE12 | Khu vực cần thận trọng trong tổ chức giao thông hàng hải. | PRCARE (điểm), PRCARE (vùng) |
| PRCARE51 | Khu vực cần thận trọng khi tổ chức giao thông hàng hải. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| PRDINS02 | Mỏ hoặc nơi khai thác khoáng sản. | PRDARE (điểm) |
| PRICKE03 | Cọc báo hiệu bằng cành cây ở bên trái luồng; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| PRICKE04 | Cọc báo hiệu bằng cành cây ở bên phải luồng; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| PRTSUR01P | Mẫu phủ vùng chưa được khảo sát đầy đủ. | DEPARE (mẫu phủ) |
| PSSARE01 | Vùng biển đặc biệt nhạy cảm (PSSA); ký hiệu đặt giữa vùng. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| QUAPOS01 | Dấu chất lượng vị trí; vị trí gần đúng. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| QUARRY01 | Mỏ đá. | PRDARE (vùng) |
| QUESMRK1 | Đối tượng chưa đủ mô tả để chọn ký hiệu hoặc chưa có ký hiệu tương ứng. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| QUESMRK1P | Mẫu phủ vùng chưa đủ mô tả để chọn ký hiệu. | NEWOBJ (mẫu phủ) |
| RACNSP01 | Đối tượng có tính phản xạ ra-đa nổi bật. | PIPOHD (đường), CONVYR (đường), CBLOHD (đường) |
| RADRFL03 | Bộ phản xạ ra-đa. | RADRFL (điểm), RADRFL (vùng) |
| RASCAN01 | Ăng-ten quét ra-đa. | LNDMRK (điểm), BUISGL (điểm) |
| RASCAN11 | Ăng-ten quét ra-đa dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm) |
| RCKLDG01P | Mẫu phủ bãi đá hoặc san hô lộ ra khi triều rút. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| RCLDEF01 | Điểm gọi vô tuyến chưa xác định hướng. | RDOCAL (điểm), RDOCAL (vùng), RDOCAL (điểm neo trên đường) |
| RCTLPT52 | Hướng giao thông khuyến nghị giữa các phần của hệ thống phân luồng. | RCTLPT (điểm), RCTLPT (vùng), RCTLPT (điểm neo trên đường) |
| RDOCAL02 | Điểm gọi vô tuyến cho giao thông một chiều. | RDOCAL (điểm), RDOCAL (vùng), RDOCAL (điểm neo trên đường) |
| RDOCAL03 | Điểm gọi vô tuyến cho giao thông hai chiều. | RDOCAL (điểm), RDOCAL (vùng), RDOCAL (điểm neo trên đường) |
| RDOSTA02 | Trạm vô tuyến. | RADSTA (điểm), RDOSTA (điểm), RADSTA (vùng), RDOSTA (vùng) |
| RECDEF51 | Tuyến khuyến nghị dạng vùng, chưa xác định hướng trong dữ liệu. | RECTRC (đường) |
| RECTRC55 | Tuyến khuyến nghị hai chiều, không dựa trên các mốc cố định. | RECTRC (đường) |
| RECTRC56 | Tuyến khuyến nghị hai chiều, dựa trên các mốc cố định. | RECTRC (đường) |
| RECTRC57 | Tuyến khuyến nghị một chiều, không dựa trên các mốc cố định. | RECTRC (đường) |
| RECTRC58 | Tuyến khuyến nghị một chiều, dựa trên các mốc cố định. | RECTRC (đường) |
| RETRFL01 | Bộ phản quang; dùng trên hải đồ giấy. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| RETRFL02 | Bộ phản quang. | RETRFL (điểm), RETRFL (vùng) |
| RFNERY01 | Nhà máy lọc dầu. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| RFNERY11 | Nhà máy lọc dầu dễ nhận biết từ biển. | PRDARE (vùng) |
| ROLROL01 | Bến tàu chở phương tiện lên xuống bằng cầu dẫn (RoRo). | HRBFAC (điểm), HRBFAC (vùng) |
| RSCSTA02 | Trạm cứu nạn. | RSCSTA (điểm), RSCSTA (vùng) |
| RSRDEF51 | Khu vực có hạn chế; chưa xác định loại hạn chế. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| RTLDEF51 | Tuyến khuyến nghị chưa có hướng xác định trong dữ liệu. | RCTLPT (điểm), RCTLPT (vùng), RCTLPT (điểm neo trên đường) |
| RTPBCN02 | Báo hiệu đáp ứng ra-đa. | RTPBCN (điểm), RTPBCN (vùng) |
| SAFCON00 | Chữ số 0 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON01 | Chữ số 1 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON02 | Chữ số 2 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON03 | Chữ số 3 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON04 | Chữ số 4 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON05 | Chữ số 5 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON06 | Chữ số 6 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON07 | Chữ số 7 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON08 | Chữ số 8 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON09 | Chữ số 9 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON10 | Chữ số 0 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON11 | Chữ số 1 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON12 | Chữ số 2 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON13 | Chữ số 3 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON14 | Chữ số 4 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON15 | Chữ số 5 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON16 | Chữ số 6 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON17 | Chữ số 7 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON18 | Chữ số 8 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON19 | Chữ số 9 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON20 | Chữ số 0 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON21 | Chữ số 1 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON22 | Chữ số 2 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON23 | Chữ số 3 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON24 | Chữ số 4 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON25 | Chữ số 5 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON26 | Chữ số 6 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON27 | Chữ số 7 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON28 | Chữ số 8 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON29 | Chữ số 9 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON50 | Chữ số 0 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON51 | Chữ số 1 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON52 | Chữ số 2 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON53 | Chữ số 3 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON54 | Chữ số 4 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON55 | Chữ số 5 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON56 | Chữ số 6 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON57 | Chữ số 7 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON58 | Chữ số 8 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON59 | Chữ số 9 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON60 | Chữ số 0 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON61 | Chữ số 1 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON62 | Chữ số 2 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON63 | Chữ số 3 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON64 | Chữ số 4 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON65 | Chữ số 5 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON66 | Chữ số 6 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON67 | Chữ số 7 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON68 | Chữ số 8 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SAFCON69 | Chữ số 9 của đường đồng sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SCALEB10 | Thước tỷ lệ dài 1 hải lý; dùng khi tỷ lệ hiển thị lớn hơn 1:80.000. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SCALEB11 | Thước vĩ độ dài 10 hải lý; dùng khi tỷ lệ hiển thị nhỏ hơn 1:80.000. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SILBUI01 | Si-lô. | SILTNK (điểm) |
| SILBUI11 | Si-lô dễ nhận biết từ biển. | SILTNK (điểm) |
| SISTAT03 | Trạm tín hiệu giao thông, biến thể trong bộ ký hiệu hiện có. | SISTAT (điểm), SISTAT (vùng) |
| SISTAW03 | Trạm tín hiệu cảnh báo, biến thể trong bộ ký hiệu hiện có. | SISTAW (điểm), SISTAW (vùng) |
| SMCFAC02 | Cảng du thuyền hoặc bến tàu nhỏ. | HRBFAC (điểm), SMCFAC (điểm), HRBFAC (vùng), SMCFAC (vùng) |
| SNDWAV01P | Mẫu phủ vùng có sóng cát đáy biển. | SNDWAV (mẫu phủ) |
| SNDWAV02 | Sóng cát đáy biển. | SNDWAV (điểm), SNDWAV (vùng) |
| SOUNDG00 | Chữ số 0 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG01 | Chữ số 1 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG02 | Chữ số 2 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG03 | Chữ số 3 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG04 | Chữ số 4 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG05 | Chữ số 5 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG06 | Chữ số 6 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG07 | Chữ số 7 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG08 | Chữ số 8 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG09 | Chữ số 9 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG10 | Chữ số 0 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG11 | Chữ số 1 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG12 | Chữ số 2 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG13 | Chữ số 3 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG14 | Chữ số 4 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG15 | Chữ số 5 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG16 | Chữ số 6 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG17 | Chữ số 7 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG18 | Chữ số 8 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG19 | Chữ số 9 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG20 | Chữ số 0 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG21 | Chữ số 1 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG22 | Chữ số 2 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG23 | Chữ số 3 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG24 | Chữ số 4 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG25 | Chữ số 5 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG26 | Chữ số 6 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG27 | Chữ số 7 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG28 | Chữ số 8 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG29 | Chữ số 9 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG30 | Chữ số 0 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG31 | Chữ số 1 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG32 | Chữ số 2 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG33 | Chữ số 3 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG34 | Chữ số 4 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG35 | Chữ số 5 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG36 | Chữ số 6 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG37 | Chữ số 7 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG38 | Chữ số 8 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG39 | Chữ số 9 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG40 | Chữ số 0 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG41 | Chữ số 1 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG42 | Chữ số 2 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG43 | Chữ số 3 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG44 | Chữ số 4 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG45 | Chữ số 5 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG46 | Chữ số 6 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG47 | Chữ số 7 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG48 | Chữ số 8 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG49 | Chữ số 9 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG50 | Chữ số 0 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG51 | Chữ số 1 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG52 | Chữ số 2 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG53 | Chữ số 3 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG54 | Chữ số 4 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG55 | Chữ số 5 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG56 | Chữ số 6 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG57 | Chữ số 7 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG58 | Chữ số 8 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDG59 | Chữ số 9 trong ký hiệu độ sâu (SOUNDG). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDGB1 | Dấu độ sâu đã được kiểm tra bằng quét; áp dụng khi độ sâu lớn hơn độ sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDGC2 | Dấu chất lượng đo sâu; độ chính xác thấp. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS00 | Chữ số 0 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS01 | Chữ số 1 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS02 | Chữ số 2 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS03 | Chữ số 3 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS04 | Chữ số 4 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS05 | Chữ số 5 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS06 | Chữ số 6 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS07 | Chữ số 7 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS08 | Chữ số 8 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS09 | Chữ số 9 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS10 | Chữ số 0 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS11 | Chữ số 1 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS12 | Chữ số 2 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS13 | Chữ số 3 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS14 | Chữ số 4 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS15 | Chữ số 5 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS16 | Chữ số 6 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS17 | Chữ số 7 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS18 | Chữ số 8 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS19 | Chữ số 9 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS20 | Chữ số 0 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS21 | Chữ số 1 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS22 | Chữ số 2 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS23 | Chữ số 3 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS24 | Chữ số 4 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS25 | Chữ số 5 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS26 | Chữ số 6 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS27 | Chữ số 7 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS28 | Chữ số 8 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS29 | Chữ số 9 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS30 | Chữ số 0 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS31 | Chữ số 1 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS32 | Chữ số 2 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS33 | Chữ số 3 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS34 | Chữ số 4 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS35 | Chữ số 5 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS36 | Chữ số 6 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS37 | Chữ số 7 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS38 | Chữ số 8 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS39 | Chữ số 9 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS40 | Chữ số 0 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS41 | Chữ số 1 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS42 | Chữ số 2 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS43 | Chữ số 3 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS44 | Chữ số 4 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS45 | Chữ số 5 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS46 | Chữ số 6 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS47 | Chữ số 7 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS48 | Chữ số 8 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS49 | Chữ số 9 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS50 | Chữ số 0 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS51 | Chữ số 1 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS52 | Chữ số 2 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS53 | Chữ số 3 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS54 | Chữ số 4 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS55 | Chữ số 5 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS56 | Chữ số 6 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS57 | Chữ số 7 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS58 | Chữ số 8 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDS59 | Chữ số 9 trong ký hiệu độ sâu (SOUNDS). | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDSA1 | Dấu gạch chân của độ cao phần đáy lộ ra khi triều rút. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDSB1 | Dấu độ sâu đã được kiểm tra bằng quét; áp dụng khi độ sâu nhỏ hơn hoặc bằng độ sâu an toàn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SOUNDSC2 | Dấu chất lượng đo sâu; độ chính xác thấp. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| SPRING02 | Mạch nước hoặc suối. | SPRING (điểm), SPRING (vùng) |
| SWPARE51 | Khu vực đã được kiểm tra bằng quét. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| TIDEHT01 | Vị trí có thông tin độ cao thủy triều. | TIDEHT (điểm), TIDEHT (vùng) |
| TIDSTR01 | Vị trí hoặc vùng có bảng thông tin dòng triều. | TIDSTR (điểm), TS_PAD (điểm), TIDSTR (vùng), TS_PAD (vùng) |
| TMARDEF1 | Dấu đỉnh của mốc cố định, dạng cờ hoặc hình dạng khác. | TOPMAR (điểm), TOPMAR (vùng) |
| TMARDEF2 | Dấu đỉnh của phao, dạng cờ hoặc hình dạng khác. | TOPMAR (điểm), TOPMAR (vùng) |
| TMBYRD01 | Bãi gỗ. | PRDARE (điểm), PRDARE (vùng) |
| TNKCON02 | Bồn chứa. | BUISGL (điểm), SILTNK (điểm), PRDARE (điểm) |
| TNKCON12 | Bồn chứa dễ nhận biết từ biển. | BUISGL (điểm), SILTNK (điểm), PRDARE (điểm) |
| TNKFRM01 | Khu bồn chứa. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| TNKFRM11 | Khu bồn chứa dễ nhận biết từ biển. | PRDARE (vùng) |
| TOPMAR02 | Dấu đỉnh của phao, hình nón, đỉnh lên. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR04 | Dấu đỉnh của phao, hình nón, đỉnh xuống. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR05 | Dấu đỉnh của phao, hai hình nón cùng hướng đỉnh lên. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR06 | Dấu đỉnh của phao, hai hình nón cùng hướng đỉnh xuống. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR07 | Dấu đỉnh của phao, hai hình nón ghép đáy với đáy. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR08 | Dấu đỉnh của phao, hai hình nón ghép đỉnh với đỉnh. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR10 | Dấu đỉnh của phao, hình cầu. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR12 | Dấu đỉnh của phao, hai hình cầu. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR13 | Dấu đỉnh của phao, hình trụ. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR14 | Dấu đỉnh của phao, dạng bảng. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR16 | Dấu đỉnh của phao, hình lập phương đặt một đỉnh lên trên. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR17 | Dấu đỉnh của phao, dạng cờ hoặc hình dạng khác. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR18 | Dấu đỉnh của phao, hình chữ T. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR22 | Dấu đỉnh của mốc cố định, hình nón, đỉnh lên. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR24 | Dấu đỉnh của mốc cố định, hình nón, đỉnh xuống. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR25 | Dấu đỉnh của mốc cố định, hai hình nón cùng hướng đỉnh lên. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR26 | Dấu đỉnh của mốc cố định, hai hình nón cùng hướng đỉnh xuống. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR27 | Dấu đỉnh của mốc cố định, hai hình nón ghép đáy với đáy. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR28 | Dấu đỉnh của mốc cố định, hai hình nón ghép đỉnh với đỉnh. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR30 | Dấu đỉnh của mốc cố định, hình cầu. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR32 | Dấu đỉnh của mốc cố định, hai hình cầu. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR33 | Dấu đỉnh của mốc cố định, hình trụ. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR34 | Dấu đỉnh của mốc cố định, dạng bảng. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR36 | Dấu đỉnh của mốc cố định, hình lập phương đặt một đỉnh lên trên. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR65 | Dấu đỉnh của phao, hình chữ X. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR85 | Dấu đỉnh của mốc cố định, hình chữ X. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR86 | Dấu đỉnh của mốc cố định, hình chữ thập đứng. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR87 | Dấu đỉnh của mốc cố định, hình chổi, đầu hướng xuống. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR88 | Dấu đỉnh của mốc cố định, hình chổi, đầu hướng lên. | TOPMAR (điểm), TOPMAR (vùng) |
| TOPMAR89 | Dấu đỉnh của mốc cố định, hình chữ T. | TOPMAR (điểm), TOPMAR (vùng) |
| TOWERS01 | Tháp. | LNDMRK (điểm), BUISGL (điểm), SILTNK (điểm) |
| TOWERS02 | Tháp nước. | SILTNK (điểm) |
| TOWERS03 | Tháp dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm), SILTNK (điểm) |
| TOWERS05 | Tháp phát thanh hoặc truyền hình. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| TOWERS12 | Tháp nước dễ nhận biết từ biển. | SILTNK (điểm) |
| TOWERS15 | Tháp phát thanh hoặc truyền hình; dễ nhận biết từ biển. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| TREPNT04 | Cây đơn lẻ; dạng tổng quát. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| TREPNT05 | Cây ngập mặn. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| TSLDEF51 | Làn một chiều của hệ thống phân luồng; chưa xác định hướng đi trong dữ liệu. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| TSSCRS51 | Khu vực giao cắt luồng giao thông hàng hải. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| TSSJCT02P | Mẫu phủ khu vực cần thận trọng, giao cắt hoặc vòng xuyến của hệ thống phân luồng. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| TSSLPT51 | Hướng đi trong làn một chiều của hệ thống phân luồng. | TSSLPT (điểm), TSSLPT (vùng) |
| TSSRON51 | Vòng xuyến giao thông hàng hải. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| TWRDEF51 | Tuyến hai chiều chưa xác định hướng trong dữ liệu. | TWRTPT (điểm), TWRTPT (vùng) |
| TWRTPT52 | Hai hướng giao thông ngược nhau trong một phần tuyến hai chiều. | TWRTPT (điểm), TWRTPT (vùng) |
| TWRTPT53 | Một hướng giao thông trong một phần tuyến hai chiều. | TWRTPT (điểm), TWRTPT (vùng) |
| UWTROC03 | Đá ngầm nguy hiểm chưa rõ độ sâu. | UWTROC (điểm), UWTROC (vùng) |
| UWTROC04 | Đá lúc nổi lúc chìm hoặc ngang mặt nước khi triều thấp. | UWTROC (điểm), UWTROC (vùng) |
| VEGATN03P | Mẫu phủ vùng cây rừng. | VEGATN (mẫu phủ) |
| VEGATN04P | Mẫu phủ vùng cây ngập mặn. | VEGATN (mẫu phủ) |
| WATTUR02 | Vùng nước xoáy, nước đổ hoặc sóng vỡ. | WATTUR (điểm), WATTUR (vùng) |
| WEDKLP03 | Rong hoặc tảo bẹ. | WEDKLP (điểm), WEDKLP (vùng) |
| WIMCON01 | Tua-bin gió. | LNDMRK (điểm), BUISGL (điểm), PRDARE (điểm) |
| WIMCON11 | Tua-bin gió dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm), PRDARE (điểm) |
| WNDFRM51 | Khu điện gió. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| WNDFRM61 | Khu điện gió dễ nhận biết từ biển. | PRDARE (vùng) |
| WNDMIL02 | Cối xay gió. | Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường |
| WNDMIL12 | Cối xay gió dễ nhận biết từ biển. | LNDMRK (điểm), BUISGL (điểm) |
| WRECKS01 | Xác tàu có phần thân hoặc thượng tầng lộ tại mực chuẩn hải đồ. | WRECKS (điểm), WRECKS (vùng) |
| WRECKS04 | Xác tàu không nguy hiểm, chưa rõ độ sâu. | WRECKS (điểm), WRECKS (vùng) |
| WRECKS05 | Xác tàu nguy hiểm, chưa rõ độ sâu. | WRECKS (điểm), WRECKS (vùng) |
