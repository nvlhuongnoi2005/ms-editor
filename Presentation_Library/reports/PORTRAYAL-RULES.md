# Hoàn thiện quy tắc hiển thị ENC

## Đã triển khai

- **Pivot và kích thước điểm:** `ENC/tools/audit_sprites.py` đọc vị trí pivot, bounding box và line weight từ catalogue được cung cấp, sau đó sinh `editor-web/src/domains/enc/spriteSpecs.generated.ts`. Renderer đổi mm sang CSS px ở 96 dpi; sprite giữ đúng điểm neo và kích thước danh nghĩa khi đổi zoom. Bản atlas có 499 ảnh/theme; 495 ảnh đối chiếu được trong catalogue.
- **Nét:** nét mặc định 0.3 mm, nét nhấn 0.6 mm được đổi sang CSS px. Các line texture cáp ngầm, ống và bờ thiếu chính xác dùng line weight có trong catalogue khi có dữ liệu.
- **Đặc tính đèn:** LIGHTS được vẽ theo màu, sector, hướng, độ mờ và loại CATLIT hiện có; nhãn đèn bổ sung đặc tính LITCHR, nhóm SIGGRP, màu, chu kỳ SIGPER và tầm danh nghĩa VALNMR.
- **Safety depth:** cài đặt ngưỡng (mặc định 6 m) tô số SOUNDG nông hơn hoặc bằng ngưỡng bằng màu nổi; số sâu hơn dùng màu phụ.
- **Safety contour:** cài đặt ngưỡng (mặc định 6 m) đổi phân lớp màu vùng sâu và làm nổi DEPCNT. Nếu cell không có đúng đường đồng sâu đã chọn, renderer dùng đường sâu kế tiếp trong cell. Cả hai ngưỡng được lưu trong trình duyệt và gửi tới API tile.
- **Display category:** `Cơ bản` chỉ hiện Display Base; `Chuẩn` hiện Base + Standard; `Tất cả` thêm Other. Feature được gắn `s52_display_category` trong tile, không cần sửa hay nhập lại cơ sở dữ liệu.

## Nguồn và giới hạn

Metadata pivot, kích thước và line weight lấy từ S-52 Presentation Library 4.0(.3), catalogue trong PDF do người dùng cung cấp. Có thể sinh lại metadata bằng lệnh:

```powershell
python ENC/tools/audit_sprites.py --catalogue 'C:\path\to\S-52 PresLib Ed 4.0.3 Part I Addendum.pdf'
```

Display category hiện là **profile phân nhóm theo object class**: lớp nền được gán BASE, các lớp đã khai báo trong tile SQL được gán STANDARD, lớp chưa có trong danh sách được gán OTHER. S-52 lookup có thể đổi category theo geometry, thuộc tính và nhánh CSP; cần các bảng LUT/CSP chính thức để thay profile này bằng kết quả đúng cho từng feature. Catalogue người dùng cung cấp không chứa toàn bộ các bảng đó.

Các texture LC hiện có vẫn chỉ hỗ trợ một số lớp. Việc thêm line weight không biến chúng thành bộ giải mã đầy đủ cho mọi LC; dynamic SYMINS và thủ tục suy luận độ sâu còn thiếu vẫn nằm ngoài phần này. IHO hiện công bố Presentation Library Edition 4.0(4) trong danh sách tiêu chuẩn có hiệu lực; bản triển khai trong repo đối chiếu theo PDF 4.0(.3) được cung cấp. Xem [IHO Standards in Force](https://iho.int/standards-in-force) và [IHO ENC Portrayal](https://iho.int/en/enc-portrayal).
