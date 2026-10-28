# Xung đột version và revert changeset

## Giải quyết xung đột Save

Khi upload bị từ chối vì version cũ, API trả HTTP 409 với
`code: version_conflict` và danh sách entity xung đột. Các lỗi 409 về
dependency hoặc trạng thái changeset giữ luồng báo lỗi riêng.

Editor giữ nguyên bản nháp, tải snapshot canonical theo ID bằng
`POST /api/entities/snapshots` (chỉ đọc), rồi mở bảng so sánh ba phiên bản:
bản gốc, local và server. Snapshot không phụ thuộc bbox hoặc Render DB.

- Trường được sửa độc lập tự ghép; bao gồm thêm/sửa/xóa tag.
- Trường được sửa khác nhau ở cả hai phía cần chọn Local hoặc Server.
- Tọa độ thuộc node; way xử lý thứ tự node references; relation xử lý danh
  sách member, role và thứ tự. Preview way dựng lại từ node đã giải quyết.
- Đối tượng bị xóa trên server không được tự hồi sinh bằng cách nâng version.
- Áp lại đưa kết quả vào preview. Người dùng kiểm tra rồi bấm Lưu; server
  vẫn kiểm tra version và topology trong transaction để chặn race mới.
- Tải lại bản server giữ draft và xóa các lựa chọn so sánh trước đó.
- Để sau đóng dialog và giữ draft. Lần Save sau sẽ kiểm tra lại.
- Bỏ toàn bộ bản nháp có xác nhận riêng, bỏ cả create và nhóm topology.

Baseline được cập nhật bằng version server. Lịch sử Undo cũ được thay bằng
một transaction giải quyết xung đột: Undo trở về baseline mới, Redo áp lại
kết quả, không đưa version cũ quay lại. Tham chiếu tới entity bị bỏ/xóa
được chặn trước khi áp dụng. Node hình học mới không còn được dùng được
loại khỏi draft, nhưng POI có tag vẫn giữ.

## Revert một trong ba changeset gần nhất

Mở **Xuất tệp → Lịch sử / Revert changeset**. Danh sách được tải từ server,
nên vẫn hoạt động sau khi reload trang, hiển thị ID, revision, ghi chú,
tác giả, thời gian Việt Nam và số create/modify/delete.

Chọn một changeset rồi bấm **Revert #ID** để xác nhận. Chỉ changeset được
chọn được hoàn tác; thao tác tạo một changeset mới có audit/outbox bình thường.

- Cửa sổ ba changeset tính theo revision đã commit của đúng dataset,
  bao gồm cả changeset revert; phiên lưu rỗng/chưa commit bị loại.
- Có thể revert changeset cũ trong cửa sổ nếu entity chưa bị sửa tiếp.
- Danh sách kiểm tra version, dependency, geometry và relation. Mục không
  thể revert bị vô hiệu hóa kèm lý do. Backend kiểm tra lại khi xác nhận.
- Hoàn tất lưu hoặc xử lý draft trước khi revert để không ghi đè công việc local.
- Lỗi hoặc xung đột rollback toàn bộ transaction, không hoàn tác từng phần.

Khởi động lại Editor API và reload frontend sau khi cập nhật code.

## Kiểm thử

- `editor-web`: `npm run test:editor`, `npm run build:react`.
- `editor-api`: `go test ./...`.
- Integration local: đặt `EDITOR_TEST_DB=1`, chạy
  `go test ./cmd/editor-api -run 'Test(SnapshotsReadIntegration|RecentChangesetsReadIntegration|ConflictRevertTransactionIntegration)$' -v`.
  Snapshot/history chỉ đọc. Fixture kiểm tra ghi/revert nằm trong một transaction
  riêng được rollback; không commit dữ liệu thử hoặc event cho render worker.
