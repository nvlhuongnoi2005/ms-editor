# Mức chi tiết khi xem ENC

Mặc định hiển thị mọi nhóm đối tượng, tên, sounding và chất lượng vị trí.
“Tất cả” là mọi nhóm trong profile; không ép mọi nhãn hoặc mọi điểm đo cùng
xuất hiện ở mọi mức zoom. Vẫn áp dụng SCAMIN, lựa chọn cell theo tỷ lệ, tránh đè
nhãn và lưới sounding chọn điểm nông hơn trong mỗi ô. Zoom gần tăng chi tiết.

## Đơn giản hóa hình học trên bản sao render

Nguồn chính: `tile.sql`, CTE `display_profile` và khối `RENDER_LOD_PROFILE`.

| Nhóm | Zoom 9–11 | Zoom 12–15 | Zoom ≥16 |
| --- | --- | --- | --- |
| ROADWY, RAILWY, LNDELV dạng đường | Sai số tối đa 0,5 px | 0,25 px | Giữ hình gốc |
| BUAARE, VEGATN dạng vùng | Sai số tối đa 0,5 px | 0,25 px | Giữ hình gốc |
| Bờ biển, vùng đất/nước, đồng sâu, kênh, khu hạn chế và các lớp khác | Giữ hình gốc | Giữ hình gốc | Giữ hình gốc |
| Điểm đo, đèn, phao, chướng ngại và các đối tượng điểm | Giữ tọa độ | Giữ tọa độ | Giữ tọa độ |

Pixel theo tile 512 px, quy đổi sang EPSG:3857 bằng độ rộng tile / 512. Dung sai
chỉ phụ thuộc zoom, không phụ thuộc vị trí tile. Simplify feature gốc trước khi
cắt theo coverage/tile; pivot, thuộc tính và ngữ cảnh độ sâu lấy từ nguồn gốc.
Lưu trữ, thao tác chọn đối tượng và biên tập vẫn đọc hình học chính xác.
Các MVT vẫn có lượng tử hóa/cắt hình học để truyền và vẽ như trước.

Dùng [ST_SimplifyPreserveTopology](https://postgis.net/docs/ST_SimplifyPreserveTopology.html)
cho danh sách lớp cho phép. Hàm giữ topology trong từng geometry, không đảm bảo
ranh chung giữa các polygon độc lập. Vì vậy không simplify riêng từng vùng nước,
đất/bờ biển hoặc coverage; không áp dụng đại trà vào lớp dẫn đường.
Đường dài vẫn được chia nhỏ để tránh vượt giới hạn mesh MapLibre.

## Kiểm tra

`python Presentation_Library/tools/check_lod_db.py`: chỉ đọc PostGIS, chuẩn bị
SQL tile thực và kiểm tra 48 tổ hợp lớp/zoom bằng fixture. Xác nhận hình được bảo
vệ giữ nguyên, geometry hợp lệ, sai số không vượt dung sai và giảm số đỉnh ở lớp
được phép. Fixture hỗn hợp giảm từ 52.400 xuống 32.227 đỉnh ở zoom 9, 32.885 ở
zoom 12, giữ 52.400 ở zoom 16. Đây là số liệu tổng hợp, chưa phải benchmark tốc độ
cho dữ liệu người dùng; mức cải thiện thực tế phụ thuộc tỷ trọng các lớp được simplify.

Renderer version 17 làm mới URL tile khi cập nhật quy tắc. Backend cần build/chạy
lại để nhúng SQL mới; không cần import lại dữ liệu.
