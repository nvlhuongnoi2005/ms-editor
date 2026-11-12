# Cài Map Service Editor trên máy mới

Gói phát hành gồm hệ thống OSM/ENC và database trống. Không có PBF, cell ENC,
MBTiles, bản sao lưu database hay thông tin đăng nhập của máy đóng gói.
Sprite, font và schema là thành phần phần mềm, được cài sẵn.

## 1. Chuẩn bị máy mới

- Windows có Docker Desktop, chạy Linux containers. Mở Docker Desktop và chờ
  trạng thái Engine running. Nếu Docker yêu cầu bật WSL 2/virtualization hoặc
  khởi động lại Windows, hoàn thành bước đó trước.
- Gói hiện được tạo cho kiến trúc ghi trong `release.json` (bản kiểm tra:
  `linux/amd64`). Máy khác kiến trúc cần build gói tương ứng từ mã nguồn.
- Nên dành ít nhất 8 GB RAM và 15 GB đĩa trống để cài/chạy hệ thống. Dữ liệu
  upload cần thêm dung lượng. Dữ liệu OSM toàn quốc có thể chiếm hàng chục GB
  trong PostgreSQL; hãy dự trù riêng dung lượng này.
- Không cần cài Node.js, Go, Python, GDAL hay PostgreSQL trên Windows.

## 2. Cài đặt: một thao tác sau khi có Docker

1. Chép **toàn bộ thư mục release** sang máy mới, ví dụ `C:\MapService`.
   Giữ thư mục này làm nơi cài đặt; không chạy trực tiếp từ file ZIP.
2. Nhấp đúp **`Setup.cmd`**. Lần đầu có thể mất vài phút.

Setup kiểm tra checksum và kiến trúc, nạp Docker images đi kèm, sinh mật khẩu
riêng, chọn cổng trống bắt đầu từ 4173, tạo database/schema và khởi động các
worker. Sau khi kiểm tra API, sprite/font và hàng đợi ENC, trình duyệt tự mở.
Địa chỉ cũng được in ở cuối cửa sổ, thường là `http://127.0.0.1:4173`.

Gói chứa sẵn images nên **cài hệ thống không cần tải dependency từ Internet**.
Ảnh vệ tinh OSM vẫn lấy từ dịch vụ bên ngoài và cần Internet. ENC được upload
và các sprite/font được phục vụ local. Không có MBTiles nền thế giới trong gói;
trước khi upload ENC, vùng bản đồ ENC chưa có hình dạng đất liền nền toàn cầu.

Nếu cổng 4173 bận, setup chọn 4174, 4175… Có thể chọn cổng ngay lần cài đầu:

```powershell
.\Setup.cmd -Port 4180
```

Chạy lại Setup không xóa dataset đã upload, không sinh lại mật khẩu đã lưu và
không áp dụng lại migration đã ghi nhận. Để cập nhật mã nguồn/migration, giữ
nguyên các migration đã phát hành và thêm file migration mới.

## 3. Upload dữ liệu sau khi cài

- Chọn **OSM · Biên tập bản đồ**, mở quản lý dữ liệu và upload `.osm.pbf`.
  Worker nạp dữ liệu vào canonical và render; chờ dataset sẵn sàng rồi mở bản đồ.
- Chọn **ENC · Hải đồ**, mở quản lý dữ liệu và upload ZIP chứa `.000` cùng chuỗi
  update liên tiếp, hoặc upload trực tiếp một `.000` không kèm update.
  Cell hợp lệ được nhập vào danh mục ENC chung sau khi worker hoàn tất.
- Không cần sửa cấu hình DB, chạy importer thủ công hay rebuild Docker image
  khi upload thêm dữ liệu.

Hệ thống mở database trống. File PBF/ENC của máy đóng gói không được tự nạp.

## 4. Sử dụng hằng ngày

| Tệp | Chức năng |
| --- | --- |
| `Start.cmd` | Khởi động hệ thống và mở trình duyệt. |
| `Stop.cmd` | Dừng dịch vụ; giữ nguyên dataset và database. |
| `Doctor.cmd` | Kiểm tra dịch vụ, API, migration, sprite/font và consumer ENC. |
| `Logs.cmd` | Xem 100 dòng log gần nhất của từng dịch vụ. |
| `Setup.cmd` | Cài lần đầu hoặc kiểm tra/cấu hình lại bản đang cài. |

Container có `restart: unless-stopped`. Nếu đã chủ động Stop, chạy Start để mở
lại. Docker Desktop phải chạy trước khi sử dụng ứng dụng.

Mật khẩu nằm tại `deploy/.env`, được sinh riêng trên từng máy. Giữ file này
để sử dụng tiếp database. PostgreSQL và tile server chỉ truy cập trong mạng
Docker; ứng dụng chỉ công bố trên loopback của máy tại cổng đã chọn.

Dữ liệu nằm ở hai nơi: Docker volume database và thư mục `data/` chứa các tệp
đã upload. Không xóa volume khi muốn giữ dữ liệu. Lệnh
`docker compose down -v` sẽ xóa database. Chép thư mục release sau khi đã sử
dụng không phải là cách sao lưu database.

## 5. Khắc phục lỗi thường gặp

- **Docker không chạy / Windows containers:** mở Docker Desktop, chuyển sang
  Linux containers rồi chạy lại Setup.
- **Checksum mismatch / thiếu file:** chép lại toàn bộ release. Không trộn file
  của hai phiên bản khác nhau.
- **Sai kiến trúc:** lấy bản release đúng kiến trúc Docker của máy đích.
- **Setup bị dừng giữa chừng:** chạy lại Setup. Nếu PostgreSQL báo lỗi, xem
  Logs trước; không xóa volume đang có dữ liệu để thử lại.
- **Trình duyệt không tự mở:** dùng URL in ở cuối cửa sổ, hoặc xem trường
  `url` trong `deploy/.installed.json`.
- **Không có dataset:** đây là trạng thái ban đầu bình thường; upload PBF/ENC.
- **Upload xong nhưng chưa thấy:** chờ trạng thái xử lý hoàn tất. Nếu báo lỗi,
  xem thông báo của lần nhập và chạy Doctor/Logs.
- **Không có ảnh vệ tinh:** kiểm tra Internet. Không ảnh hưởng đến việc lưu
  hoặc đọc dữ liệu ENC/OSM đã có trong database.

## 6. Đóng gói phiên bản mới trên máy phát triển

Mở PowerShell tại thư mục mã nguồn, Docker Desktop phải đang chạy:

```powershell
.\Package.cmd
```

Lệnh build lại ứng dụng và worker từ mã hiện tại; khóa bộ image trong release,
nén `images.tar.gz`, chép schema/script/tài liệu, tạo checksum và `source.zip`.
Thư mục đầu ra mặc định là `releases/ms-editor-<thời gian>`.
Lệnh cũng tạo file ZIP cùng tên để chuyển máy và file SHA-256 kiểm tra bản sao.
File ZIP ngoài giữ nguyên images đã nén để tránh mất thời gian nén lần nữa.
Có thể chỉ định phiên bản:

```powershell
.\Package.cmd -Version 1.0.0
```

Chuyển file ZIP của release rồi giải nén trên máy mới, hoặc chép nguyên thư mục
đầu ra. Gói không chứa dataset, uploads, MBTiles hoặc `.env` của máy phát triển.
`source.zip` chứa mã/tài liệu
để lưu trữ đề tài, không cần giải nén khi sử dụng. Nguồn và giấy phép của tài sản
phần mềm được giữ trong `source.zip` và các Docker image.

Nếu lần đóng gói bị ngắt sau khi tạo xong `images.tar.gz`, chạy lại cùng phiên
bản với tùy chọn `-Resume` để tiếp tục mà không build/nén lại images. Tùy chọn
này chỉ nhận thư mục release chưa hoàn tất.

Người phát triển có thể kiểm tra trực tiếp từ mã nguồn bằng `Setup.cmd`; chế
độ này build images tại chỗ nên lần đầu cần Internet. Release sử dụng images
đã đóng gói, không build trên máy người dùng.

Để chạy song song với môi trường development, bộ cài dùng project `ms-editor`,
tách với project `map-service` trong `infra/compose.yaml`. Khi cần hai bộ cài
độc lập, dùng hai thư mục riêng và đặt tên ngay lần setup đầu:

```powershell
.\Setup.cmd -ProjectName ms-editor-demo -Port 4180
```

Không đổi tên project sau khi đã nạp dữ liệu: mỗi project có volume riêng.
Quy trình hiện hỗ trợ bộ cài Windows; Linux/macOS cần gọi Compose và migration
tương ứng hoặc bổ sung launcher riêng.
