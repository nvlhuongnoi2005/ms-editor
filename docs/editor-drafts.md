# Bảo vệ công việc biên tập

## Cốt lõi

- Nháp được lưu tự động trong IndexedDB `geodata-editor-drafts`, theo **ID và tên dataset**, sau khi ngừng thay đổi 250 ms. Không tự upload dữ liệu.
- Giữ nguyên baseline/version, create/modify/delete, tọa độ, node refs, relation members, selection và Undo/Redo. ID tạm được cấp tiếp sau cả lịch sử Undo/Redo, không tái sử dụng ID đã có.
- Khi mở lại dataset, chọn khôi phục hoặc xóa nháp. Không tự ghi đè dữ liệu server. Khôi phục kiểm tra snapshot của entity đã sửa/xóa; version khác mở quy trình giải quyết xung đột hiện có. Khi offline, vẫn khôi phục được local; server tiếp tục kiểm tra version lúc lưu.
- Có `beforeunload` khi còn thay đổi, bản vẽ dở hoặc phiên lưu đang xử lý. Chuyển dataset vẫn bị chặn khi chưa xử lý công việc hiện tại.
- Nháp chỉ được xóa sau khi server xác nhận upload, hoặc khi người dùng chủ động hủy/xóa. HTTP rejection giữ công việc để sửa tiếp.

## Bổ sung

- Lưu bản vẽ dở, snapping/way extension, bộ đếm ID tạm và camera (tâm, zoom, góc xoay, độ nghiêng). Giữ khóa tạm cùng nháp đang biên tập.
- Giá trị thuộc tính đang nhập, chưa blur, cũng được chụp vào nháp. Không thay đổi cách commit/Undo của phiên đang làm; khi khôi phục, phần nhập dở trở thành một transaction thuộc tính có thể Undo.
- Nút quản lý nháp ở thanh trạng thái: xem trạng thái/lỗi, thử lưu lại, xuất JSON và nhập JSON vào đúng dataset. Nhập chỉ được bật khi không còn thay đổi hoặc bản vẽ dở. Tệp nhập tối đa 50 MB, được kiểm tra trước khi khôi phục.
- Nháp lỗi/khác schema không bị tự xóa hay ghi đè; có thể xuất dữ liệu gốc. Khi storage không khả dụng, chỉ tiếp tục sau lựa chọn rõ ràng của người dùng; vẫn có thể lưu lên server, nhưng không hứa bảo vệ local.
- Compare-and-swap đọc revision và ghi/xóa trong cùng transaction IndexedDB. Tab chậm không ghi đè nháp của tab khác. Giữ phần đang sửa trong bộ nhớ để xuất JSON; không tự “giành quyền” ghi.
- Trước upload, ghi mã changeset vào nháp. Nếu request mất kết nối hoặc trả kết quả không xác định, khóa biên tập và chuyển sang đối soát. `GET /api/0.6/changeset/:id` xác nhận commit; nếu chưa commit, chỉ retry **cùng changeset, cùng payload bất biến**. Backend khóa row và chỉ cho một commit. Không tạo changeset mới từ một upload chưa rõ kết quả.
- Có thể đóng phiên chưa commit để quay lại sửa nháp; thao tác đóng được tuần tự hóa với upload đang chạy. Nếu đã commit, phải đối soát thay vì khôi phục dữ liệu cũ.
- Chỉ lưu dependency của phần đang sửa/lịch sử/snapping, không sao chép toàn bộ viewport cache. Flush thêm khi tab bị ẩn.

## Giới hạn cần biết

- Không phải backup đám mây; đổi trình duyệt/origin, xóa browser data hoặc chế độ riêng tư có thể làm mất nháp. Xuất JSON khi cần thêm bản sao.
- Browser/OS tắt đột ngột trước khi transaction IndexedDB hoàn tất có thể mất những thao tác cuối. `beforeunload` và xử lý visibility không đảm bảo chạy khi mobile bị kill. Nội dung cảnh báo rời trang do trình duyệt quyết định, thường cần tương tác người dùng trước đó.
- Phải hoàn tất/hủy bản vẽ dở trước khi upload dữ liệu. Nháp vẫn bảo vệ bản vẽ đó; không gửi bản vẽ chưa hoàn chỉnh vào hệ thống.
- Khôi phục version không thay thế validation topology/dependency trên server; vẫn cần backend lúc lưu. Không tự xử lý lỗi storage bằng cách xóa các nháp khác.

## Kiểm thử

```powershell
npm --prefix editor-web run test:editor
npm --prefix editor-web run build:react
```

Browser regression dùng Chrome + Playwright đã cài (không thêm dependency runtime). Khởi động Vite trước:

```powershell
npm --prefix editor-web run dev -- --host 127.0.0.1 --port 5178
# Terminal khác: đường dẫn module Playwright đã cài của máy chạy test
$env:PLAYWRIGHT_MODULE = 'file:///C:/path/to/node_modules/playwright/index.mjs'
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node editor-web/scripts/drafts.browser.mjs
```

`EDITOR_URL` có thể đổi địa chỉ Vite; `DRAFT_BROWSER_FILTER` lọc tên scenario. Browser regression chạy app thật và IndexedDB thật nhưng mock API/dataset, cố ý chặn raster tiles. Không ghi vào database production. Các ca bao gồm reload/restore/ID/undo/redo, hủy nháp, save fail/success, sketch/camera, nhập/xuất JSON màn hình nhỏ, nhiều tab, upload mất phản hồi trước/sau commit, storage bị chặn/hết quota, schema lỗi, version conflict.
