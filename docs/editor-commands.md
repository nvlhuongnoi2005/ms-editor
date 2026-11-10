# Quy ước command biên tập

## Phạm vi lựa chọn

- Nhân bản, Cut/Copy, Xóa và biến đổi geometry dùng toàn bộ tập lựa chọn, không chỉ đối tượng active cuối cùng.
- Click thành viên của collection chọn đầy đủ các thành viên nhóm đã tải. Nhóm thiếu dữ liệu hoặc có thành viên khóa không được chọn một phần.
- Double-click chọn riêng một thành viên. Nhân bản/copy thành viên này không tự mở rộng thành cả nhóm.
- Chọn trực tiếp relation collection rồi Nhân bản vẫn sao chép đầy đủ thành viên; nhóm lồng nhau được tạo theo thứ tự phụ thuộc, dùng ID mới.
- Khi toàn bộ thành viên đã được chọn, Nhân bản/Copy giữ các collection đầy đủ trong bản sao. Node dùng chung trong tập sao chép vẫn dùng chung ở bản sao nhưng độc lập với nguồn.
- Inspector thuộc tính/thành viên relation và công cụ chỉnh một đỉnh vẫn có phạm vi đối tượng/đỉnh active, không tự áp tag hoặc topology đơn lẻ cho toàn bộ selection.

## Xóa và bỏ nhóm

- Xóa nhiều đối tượng là một transaction. Chọn trực tiếp collection để xóa sẽ bao gồm thành viên và wrapper nhóm; nếu đã chọn mọi thành viên, wrapper đầy đủ cũng được xóa.
- Bỏ nhóm chỉ gỡ liên kết/wrapper, không xóa geometry thành viên.
- Không tự xóa các đối tượng bên ngoài lựa chọn để giải quyết phụ thuộc. Khi node còn được way sử dụng, đối tượng còn được relation tham chiếu, hoặc thiếu dữ liệu nhóm/cha đã biết, command bị chặn.
- Các kiểm tra client chỉ dựa trên dữ liệu đã tải. Server vẫn kiểm tra tham chiếu và phiên bản trên toàn dataset khi Lưu.

## Kết quả transaction

`replaceFeature`, `replaceFeatures`, `updateTags`, Undo và Redo trả `CommandResult`:

| Trạng thái | Ý nghĩa | Phản hồi UI |
| --- | --- | --- |
| `applied` | Đã cập nhật nguyên khối; có `changedKeys` | Có thể đổi selection, dọn nét vẽ, báo hoàn tất |
| `noop` | Không có khác biệt nội dung cần lưu | Không tăng dirty count, không thêm Undo, không xóa Redo; thông báo không có thay đổi |
| `blocked` | Không được cập nhật; có `message` | Giữ selection/nét vẽ/tham số, không báo thành công |

Store cập nhật trạng thái tham chiếu đồng bộ trước khi trả kết quả; React vẫn chịu trách nhiệm render. Các thao tác tiếp theo trong cùng sự kiện đọc đúng trạng thái vừa commit.

## Thao tác không đổi

So sánh dựa trên nội dung canonical: tags không phụ thuộc thứ tự key; node theo tọa độ E7; way theo ordered node references; relation theo ordered members/role/sequence. Metadata như name suy ra từ tag, style và danh sách cha không tạo thay đổi cần lưu.

Way preview lấy tọa độ từ node override: chỉ di chuyển node không cần tạo thêm upload way nếu node references/tags không đổi. Xoay 0°/bội số 360° và Scale 100% không tạo mutation sau khi xác nhận đủ thành viên lựa chọn.

Các lần ghi cùng key trong một transaction được gộp theo kết quả cuối cùng. Nếu giá trị cuối bằng trước transaction, không tạo lịch sử. Thay đổi thực sự về lại baseline vẫn là một command có thể Undo, nhưng không còn dirty override cho đối tượng đó.

## Kiểm thử

- `npm --prefix editor-web run test:editor`
- `npm --prefix editor-web run build:react`
- `commands.test.mjs`: multi-selection, nhóm trực tiếp/lồng, node chung, khóa, net-zero/E7, tham chiếu ngoài tập xóa, Undo/Redo và chọn nhóm nguyên khối.
- Browser smoke với API giả lập: chọn 3 điểm → Nhân bản → Xóa → Undo/Redo; tạo nhóm → Ctrl+D → xóa nhóm bản sao; xoay 0° không dirty; hoàn tất đường khi layer khóa → giữ nét vẽ → mở khóa → hoàn tất → Undo nguyên khối.

Không thay thế kiểm thử lưu/tải lại với DB thật hoặc kiểm thử đa người dùng.
