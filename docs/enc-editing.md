# Biên tập ENC cơ bản

Phiên bản này bổ sung workspace theo cell, lưu phần thay đổi riêng và biên tập
thuộc tính/điểm và biến đổi đường/vùng độc lập. Hải đồ nguồn, primitive S-57 và catalog công bố được giữ nguyên.
Luồng preview và ghi nháp đã được tối ưu; xem [cơ chế và số đo](enc-edit-performance.md).
Chọn trực tiếp, khung kéo/đổi kích thước và quyền biến đổi: [hướng dẫn thao tác](enc-edit-transforms.md).
Các lệnh sao chép, dán, nhân bản, kích thước và lưu tại con trỏ: [menu chuột phải](enc-context-menu.md).

Khi bấm nơi có nhiều đối tượng chồng nhau, bảng **Chọn đối tượng** liệt kê các
đối tượng trong bán kính 6 pixel, kèm hình ký hiệu, mã lớp, tên và cell. Chọn một
dòng để xem chi tiết hoặc biên tập. Các lớp ký hiệu, đường viền, nhãn và mảnh tile
của cùng đối tượng chỉ xuất hiện một lần. Điểm, đường và vùng khác nhau vẫn được
liệt kê riêng. Chỉ một đối tượng thì mở trực tiếp; Escape/đóng danh sách không sửa
dữ liệu. Di chuyển bản đồ hoặc đổi nguồn đóng danh sách để tránh chọn kết quả cũ.

## Sử dụng

1. Mở ENC đã import, chọn cell trong **Phạm vi hiển thị**, mở icon bút dưới navigator
   rồi bấm **Biên tập cell**.
2. Bấm đối tượng trên bản đồ để lấy dữ liệu nguồn đầy đủ. **Thêm trường theo schema**
   cho tìm mã/tên và thêm thuộc tính được phép cho đúng lớp. Trường enum/list có
   danh sách giá trị; giá trị số sai chặn Lưu. Có thể xóa thuộc tính được phép.
3. **Loại điểm** cho tìm mã lớp, mã ký hiệu hoặc mô tả và hiện icon cạnh mỗi lựa chọn.
   Chọn biến thể rồi **Thêm điểm**: ký hiệu theo con trỏ trước khi đặt, sau khi đặt
   vẫn dùng sprite và cập nhật theo thuộc tính. Điểm độc lập hỗ trợ kéo ký hiệu hoặc
   nhập kinh/vĩ độ rồi **Áp dụng tọa độ**. **Xóa điểm** có xác nhận.
4. Bấm **Lưu** để lưu trên server. **Hoàn tác/Làm lại** giữ tối đa 150 thao tác,
   vẫn hoạt động sau khi lưu; thao tác hoàn tác sau lưu tạo thay đổi cần lưu tiếp.
5. Sau reload, mở icon bút rồi bấm **Tiếp tục bản biên tập**. Phần thay đổi, tọa độ và Undo/Redo
   được phục hồi từ IndexedDB. Không tự gửi thay đổi khi tải lại trang.

Danh sách **Đối tượng trong bản biên tập** giúp tìm lại điểm đã di chuyển ra khỏi
vùng nhìn, mở đối tượng đã sửa và khôi phục đối tượng nguồn đã đánh dấu xóa.
**Bỏ thay đổi chưa lưu** trở về nội dung của lần lưu gần nhất sau xác nhận.
Nút tải xuống xuất bản sao JSON để đối soát; đây không phải tệp S-57. Bản sao
chứa khóa truy cập workspace, nên chỉ chia sẻ cho người được phép mở bản biên tập.

## Cơ chế dùng lại từ OSM

- Dùng chung `readDraft`/`writeDraft`, cùng IndexedDB `geodata-editor-drafts`.
  Khóa ENC có tiền tố `enc:`; ghi bằng compare-and-swap trong một transaction
  để phát hiện tab khác đã đổi bản nháp. Không ghi đè bản nháp của OSM.
- Áp dụng cùng mô hình bản gốc + override, Undo/Redo có giới hạn, giữ nguyên
  tọa độ và nội dung lần lưu đang chờ xác nhận.
- Mỗi lần lưu có `requestId`, phiên bản dự kiến và dấu vết trước/sau. Backend
  khóa hàng workspace, kiểm tra toàn bộ thay đổi và commit nguyên tử. Gửi lại
  cùng yêu cầu trả cùng kết quả; dùng lại mã cho nội dung khác bị từ chối.
- ENC giữ kiểu dữ liệu S-57 riêng; không đổi đối tượng thành node/way/relation.

Workspace ghim `base_revision`; một lần nhập mới không thay nguồn đang sửa.
Tile nền trong chế độ biên tập cũng đọc revision đã ghim qua API workspace có
kiểm tra khóa; nguồn công bố đổi phiên bản không thay hình học nền đang sửa.
Nếu nguồn không còn là bản công bố, giao diện báo khi mở lại workspace. Xóa
lần nhập vẫn giữ revision, geometry và file nguồn mà workspace đang tham chiếu.
Xung đột phiên bản hoặc xung đột bản nháp giữ nguyên bản sao tại máy để đối soát.

## Phạm vi và giới hạn

- Biểu mẫu dùng từ điển GDAL S-57 theo lớp, kiểm tra kiểu và miền enum/list cả ở
  client lẫn backend. Xem [nguồn schema và giới hạn](../ENC/schema/README.md).
  Chưa có kiểm tra đầy đủ quy tắc nghiệp vụ của sản phẩm ENC/S-58.
- Di chuyển điểm nguồn 2D thuộc lớp hỗ trợ Point trong schema (trừ SOUNDG và
  metadata M_*), khi xác định được một IsolatedNode riêng và không có tham chiếu
  dùng chung. Ví dụ HRBFAC độc lập được kéo dù không thuộc danh sách tạo điểm.
  Tạo/xóa điểm vẫn giới hạn ở các lớp phao, beacon, đèn, landmark, vật cản, đá ngầm
  và xác tàu được liệt kê trong API. Điểm mới có định danh riêng trong workspace.
- Đường/vùng có cạnh và nút đầu mút thuộc riêng một đối tượng được di chuyển,
  đổi tỷ lệ đồng đều bằng khung chọn; API kiểm tra đủ primitive và không có liên kết
  dùng chung. Giữ nguyên đỉnh, lỗ và Z; chưa cho xóa đường/vùng.
- SOUNDG, điểm có Z, điểm dùng chung primitive/quan hệ và hình học đường/vùng chưa
  đủ điều kiện độc lập được bảo vệ. Thuộc tính định danh, liên kết và DEPTH dẫn xuất của SOUNDG không
  nhận sửa từ client. VALSOU được phép ở những lớp có định nghĩa trường này.
- Điểm trong preview dùng cùng biểu thức chọn sprite, kích thước và pivot của
  Presentation Library làm mặc định; có thể điều chỉnh kích thước hiển thị 50–400%
  trong bản biên tập bằng metadata `symbolScale`. Icon theo theme Ngày/Chạng vạng/Đêm. Đường/vùng vẫn đánh
  dấu màu đỏ. Chưa dựng lại toàn bộ ngữ cảnh CSP hoặc kiểm tra phù hợp S-52 đầy đủ
  cho đối tượng mới/sửa, đặc biệt quan hệ độ sâu xung quanh và compound symbols.
- Tối đa 500 đối tượng cho mỗi lần lưu, payload 4 MiB; 1000 override/workspace.
- Chưa có duyệt/công bố workspace, merge nguồn mới, xuất `.000`/chuỗi update,
  kiểm tra S-58 đầy đủ hoặc chức năng biên tập topology.

Mỗi workspace dùng khóa truy cập ngẫu nhiên, backend chỉ lưu SHA-256 của khóa.
Khóa nằm trong bản nháp của trình duyệt và được gửi qua header, không qua URL.
Các thao tác POST đi qua kiểm tra origin/header hiện có của editor. Đây là quyền
truy cập theo khóa workspace; chưa phải phân quyền tài khoản/nhóm hoặc audit theo
danh tính người dùng. Trước khi chia sẻ nhiều người cần nối vào hệ thống đăng nhập.

## API

| Phương thức | Đường dẫn | Mục đích |
|---|---|---|
| POST | `/api/enc/workspaces` | Tạo hoặc mở lại cùng `id`, `token`, `baseRevision` |
| GET | `/api/enc/workspaces/{id}` | Phiên bản và phần thay đổi đã lưu |
| GET | `/api/enc/workspaces/{id}/feature?key=...` | Đối tượng nguồn đầy đủ và quyền sửa hình học |
| GET | `/api/enc/workspaces/{id}/tiles/{z}/{x}/{y}.pbf` | Tile của revision nguồn đã ghim |
| POST | `/api/enc/workspaces/{id}/commits` | Lưu thay đổi bằng `requestId`, `expectedVersion`, `changes` |

Các API con cần header `X-ENC-Workspace-Token`; POST thêm `X-Editor-Import: 1`.
`after: null` xóa override để trở về nguồn. Đối tượng nguồn bị xóa có `deleted: true`;
điểm mới bị xóa được gỡ khỏi tập override. Không sửa trực tiếp `enc.feature`.

## Cài đặt và kiểm tra

Migration mới: `infra/init/10-enc-editing.sql`; `enc-migrate` đã bao gồm migration.
API mới cũng đảm bảo các bảng editing khi khởi động nếu schema ENC đã có sẵn.
Với hệ thống đang chạy, cần build và khởi động lại API/frontend để có route và UI mới.

```powershell
docker compose -f infra/compose.yaml run --rm --no-deps enc-migrate
```

Các bảng `enc.workspace`, `enc.workspace_feature`, `enc.workspace_commit` giữ
workspace, nội dung hiện hành và lịch sử lưu. Chưa có tự động thu hồi workspace;
nguồn được giữ đến khi có chính sách xóa workspace rõ ràng.

Kiểm thử logic frontend: `node --test scripts/enc-editing.test.mjs scripts/drafts.test.mjs`
từ `editor-web`. Kiểm thử Go: `go test ./internal/enc ./cmd/editor-api` từ `editor-api`.
`TestEditingPersistence` cần `ENC_EDITING_TEST_DB` trỏ vào database dùng một lần
tên chính xác `enc_editing_test`; test khởi tạo schema trong database đó.
`scripts/enc-editing.browser.mjs` dùng Chrome/MapLibre/IndexedDB thật với API fixture
riêng; thiết lập `EDITOR_URL` trỏ Vite và `PLAYWRIGHT_MODULE` nếu Playwright ngoài repo.
