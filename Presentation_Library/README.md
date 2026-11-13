# Presentation Library của hệ thống ENC

Đây là nguồn dùng chung cho tài liệu, sprite, glyph, palette và runtime hiển thị ENC.
Màn hình ENC và bản Docker sử dụng trực tiếp thư mục này; các module tại
`editor-web/src/domains/enc` chỉ giữ đường dẫn tương thích.

| Thư mục | Nội dung |
| --- | --- |
| `documents/` | S-52 6.1.1, Symbol Catalogue Addendum 4.0(.3), cấu trúc PresLib 4.0(.4), S-4 4.10.0 |
| `assets/sprites/` | Atlas day/dusk/night, bản gốc, SVG bổ sung, pivot, texture và giấy phép nguồn |
| `assets/fonts/` | Glyph PBF đang dùng cho nhãn |
| `runtime/` | Style MapLibre, chọn ký hiệu, light sectors, infrastructure, palette, cấu hình hiển thị |
| `reports/` | Bản kiểm kê và kết quả đối chiếu đã có; là snapshot, không phải chứng nhận |
| `tools/` | Kiểm tra tính toàn vẹn của thư viện |

## Sử dụng

Mở chế độ ENC → bảng Hải đồ để chọn Day/Dusk/Night. Màn hình mặc định bật toàn
bộ nhóm Base/Standard/Other, tên, sounding và chất lượng vị trí. Không còn bảng
tùy chọn Hiển thị hải đồ; các lựa chọn ẩn lớp lưu từ phiên bản cũ được bỏ qua.
Mức chi tiết tự điều chỉnh theo zoom/SCAMIN, mật độ sounding và tránh đè nhãn.
Xem [chính sách mức chi tiết](runtime/LOD.md). Các ngưỡng an toàn nội bộ vẫn ở
`runtime/profile.ts`; thay đổi hiển thị không sửa dữ liệu ENC hay bản nháp.

Frontend đóng gói PNG/JSON/glyph từ thư mục này thành URL có hash dưới `/assets/`.
Bảng ký hiệu và bộ chọn điểm dùng trực tiếp URL đó; MapLibre chuyển các yêu cầu
sprite/glyph đã biết sang cùng tài sản đóng gói. Việc tải ảnh không phụ thuộc vào
working directory hoặc asset root đã lưu của API đang chạy.

API vẫn giữ URL `/enc/assets/sprites/…` và `/enc/assets/fonts/…`, nhưng đọc từ
`Presentation_Library/assets`. Biến `EDITOR_ENC_ASSETS_ROOT` có thể thay thư mục assets.
Docker chỉ đóng gói assets/runtime/manifest, không phục vụ các PDF qua web.

```sh
python Presentation_Library/tools/verify.py
node ENC/tools/build_sprites.mjs
python ENC/tools/audit_sprites.py --catalogue "Presentation_Library/documents/S-52 PresLib Ed 4.0.3 Part I Addendum_Clean.pdf"
```

`checksums.json` ghi SHA-256 của tài liệu và assets; chỉ cập nhật có chủ đích sau khi
thay nguồn đã đối chiếu: `python Presentation_Library/tools/verify.py --update`.

## Phạm vi chuẩn và những phần còn thiếu

Đích đối chiếu là **S-52 Annex A 4.0(.4)**. Hình ký hiệu đang dựa vào catalogue
công khai **4.0(.3)**; số phiên bản catalogue không đồng nghĩa đã có đầy đủ
metadata/quy tắc 4.0(.4). Atlas có 499 ảnh mỗi theme, bao gồm ký hiệu và texture;
điều đó không có nghĩa tất cả đã có nhánh chọn hoặc đã phủ toàn bộ PresLib.

Hiện là **triển khai một phần**, chưa phải renderer được xác nhận phù hợp đầy đủ
S-52/ECDIS. Chưa có bộ LUT chính thức B–F, bảng màu Appendix A được xác minh,
toàn bộ CSP/DAI 4.0(.4), dữ liệu/kết quả đối chiếu Chart 1 và S-64.
Phân nhóm, thứ tự vẽ và lựa chọn ký hiệu hiện do runtime cùng `runtime/tile.sql`
thực hiện. Backend nhúng bản đồng bộ `editor-api/internal/enc/tile.sql` qua Go embed.
Sau khi sửa SQL trong thư viện, chạy `python Presentation_Library/tools/verify.py --sync-sql`;
kiểm tra mặc định sẽ báo lỗi nếu hai bản khác nhau.
Sounding hiện dùng glyph chữ, chưa thay toàn bộ bằng bộ digit ký hiệu.

S-4 dùng để tham chiếu ngữ nghĩa và biên tập hải đồ, không tự động thay quy tắc
trình bày ENC bằng quy tắc in hải đồ giấy. Xem [nguồn và quy trình cập nhật](STANDARDS.md).

Giữ nguyên copyright/giấy phép trong tài liệu và `assets/sprites/sources/`.
Việc tập hợp tại đây không cấp lại giấy phép cho tài liệu IHO hay atlas nguồn.
