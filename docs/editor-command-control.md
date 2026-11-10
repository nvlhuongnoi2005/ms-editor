# Kiểm soát thao tác biên tập

## Luồng geometry

Chọn → mở công cụ → nhập tham số → xem preview và phạm vi → xác nhận ảnh hưởng ngoài lựa chọn → Áp dụng → Hoàn tác nếu cần.

- Circularize, Xoay/Scale, Căn hàng/Phân bố và Tạo lỗ/Union/Intersection/Difference dùng `planGeometryCommand`. Hàm này gọi chính `transformGeometry` / `booleanGeometry` đang dùng để tính dữ liệu thực, rồi chạy `executeTransaction` để kiểm tra khóa, no-op và dependency trước khi áp dụng.
- Preview là GeoJSON riêng trên MapCanvas: gốc nét đứt đỏ, kết quả nét liền xanh. Không ghi EditorStore, không tạo Undo, không lưu nháp và không tiêu thụ ID tạm. Có thể pan/zoom nhưng không chọn/kéo sửa đối tượng trong khi panel mở.
- Panel nằm bên phải desktop, phía dưới mobile, không che toàn bộ bản đồ. Escape hoặc Hủy xóa overlay.
- Phạm vi hiển thị số lựa chọn, số đối tượng hình học sau mở rộng nhóm, số nhóm đầy đủ, số node **thực sự thay đổi**, số entity tạo/cập nhật và các đường/vùng/relation liên quan ngoài lựa chọn. Danh sách ID xem được trong panel.
- Nhóm collection được chọn đầy đủ thuộc phạm vi lựa chọn, không bị báo nhầm là relation bên ngoài. Relation khác có thành viên bị thay đổi được tính liên đới theo chuỗi, không đếm trùng.
- Kiểm tra điều kiện sơ bộ của form vẫn giữ vai trò hướng dẫn. Kết quả tính/preflight quyết định cuối cùng: tham số sai, thiếu thành viên, vùng rỗng, geometry không hợp lệ, khóa node dùng chung, phạm vi tọa độ không hỗ trợ và thao tác không thay đổi đều chặn Apply trước khi ghi dữ liệu. Khóa kèm các ID bị chặn.
- Khi có ảnh hưởng ngoài lựa chọn, phải xác nhận đã kiểm tra. Đổi tham số/phạm vi sẽ reset xác nhận. Trước commit, tính lại và đối chiếu fingerprint; nếu dữ liệu hoặc khóa đã đổi, yêu cầu xem lại thay vì áp dụng preview cũ.
- Phép toán vùng vẫn tạo kết quả mới và giữ các vùng đầu vào. Giữ nguyên nghiệp vụ hiện có; không tự xóa vùng nguồn.

## Xóa và kéo thả

- Xóa nhiều entity hoặc relation/nhóm mở hộp xác nhận. Menu chuột phải, nút trong Inspector và Delete cùng gọi một handler.
- Di chuyển cả đối tượng hoặc một node có ảnh hưởng ngoài lựa chọn mở hộp xác nhận và overlay kết quả sau khi thả chuột; Hủy giữ nguyên dữ liệu.
- Kéo thông thường không có ảnh hưởng ngoài lựa chọn vẫn áp dụng ngay, không hỏi lại không cần thiết.
- Xóa vẫn bị chặn nếu còn tham chiếu không thể xóa an toàn; không tự xóa dependency ngoài phạm vi.
- Thông báo kết quả dựa trên transaction thực tế. Nút Hoàn tác chỉ hiện khi transaction đó vẫn ở đầu lịch sử; không âm thầm undo một thao tác mới hơn.

## Giới hạn

Phạm vi liên đới chỉ tính được từ dữ liệu đã tải. Không khẳng định bao phủ toàn database; server tiếp tục kiểm tra version/dependency/topology khi Lưu. Tính theo mét cục bộ, độ chính xác E7 và các giới hạn polygon/CRS hiện có không đổi. Preview không phải kiểm định đo đạc địa chính.

Các thao tác topology riêng như merge/split/reverse chưa có preview tham số trong đợt này. Clipboard/nhân bản giữ cơ chế hiện có, không thêm hộp xác nhận vào mỗi thao tác thông thường.

## Kiểm thử

```powershell
npm --prefix editor-web run test:editor
npm --prefix editor-web run build:react
# Vite chạy tại 127.0.0.1:5178, Playwright đã cài ngoài dependency runtime:
$env:PLAYWRIGHT_MODULE = 'file:///C:/path/to/node_modules/playwright/index.mjs'
node editor-web/scripts/command-preview.browser.mjs
```

Browser regression dùng Chrome và IndexedDB thật, API/dataset giả lập, raster tiles bị chặn có chủ đích. Có kiểm tra desktop/mobile, cancel/no-op, scope/confirmation reset, area operations, multi-delete, drag và khóa node dùng chung. `PREVIEW_FILTER` lọc scenario; `REVIEW_SCREENSHOTS=1` lưu ảnh review vào `.impeccable/review/`.
