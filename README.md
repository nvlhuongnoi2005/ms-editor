# Map Service Editor

## ENC viewer

Mở `/?mode=enc` để upload ZIP S-57 và xem ENC local theo dataset/cell, với ba
palette ngày, chạng vạng và đêm. Hướng dẫn migration ENC và khởi chạy worker:
[`ENC/README.md`](ENC/README.md). Importer OSM nằm tại `OSM/importer`; gateway
Go và shell React được dùng chung cho hai domain.

Map Service Editor là ứng dụng WebGIS để xem và chỉnh sửa dữ liệu OSM. Frontend React nằm trong `editor-web`, API Go nằm trong `editor-api`; PostgreSQL/PostGIS chạy bằng Docker Compose trong `infra`.

## Chạy editor trên máy local

### Yêu cầu

- Windows với PowerShell (các lệnh bên dưới dùng PowerShell), Docker Desktop đang chạy.
- Node.js/npm và Go đã cài. Phiên bản Go được khai báo trong `editor-api/go.mod`.
- Cổng `5432` và `4173` chưa bị ứng dụng khác sử dụng.

### 1. Cấu hình và khởi động PostgreSQL

Từ thư mục gốc repo:

```powershell
if (-not (Test-Path infra/.env)) { Copy-Item infra/.env.example infra/.env }
```

Nếu vừa tạo file, mở `infra/.env` và đổi các giá trị mật khẩu mẫu thành mật khẩu dùng riêng cho máy local. Giữ lại file `.env` đã cấu hình nếu file này tồn tại. Sau đó chạy PostGIS:

```powershell
docker compose --file infra/compose.yaml up -d postgres
```

Compose sẽ tạo hai database `canonical` và `render` cùng các schema ban đầu trong lần đầu tạo volume. API native đọc mật khẩu từ `infra/.env`, rồi kết nối vào hai database ở `127.0.0.1:5432`.

### 2. Cài dependencies và chạy ứng dụng

```powershell
Push-Location editor-web
npm ci
Pop-Location
npm start
```

Lệnh `npm start` ở thư mục gốc build frontend bằng TypeScript/Vite rồi chạy API Go. Mở <http://127.0.0.1:4173>. API cần truy cập được cả Canonical DB lẫn Render DB, nên PostgreSQL phải chạy trước.

Để dừng, nhấn `Ctrl+C` ở terminal chạy `npm start`; PostgreSQL có thể tiếp tục chạy trong Docker.

### Chạy frontend ở chế độ phát triển

Nếu cần hot reload cho frontend, mở hai terminal tại thư mục gốc repo. Terminal thứ nhất chạy API:

```powershell
Push-Location editor-api
go run ./cmd/editor-api
```

Terminal thứ hai chạy Vite:

```powershell
Push-Location editor-web
npm run dev
```

Mở <http://localhost:5173>. Vite proxy các request `/api` tới API tại `127.0.0.1:4173`. API vẫn cần hai database PostGIS như ở trên. Dừng mỗi tiến trình bằng `Ctrl+C`.

## Nạp dữ liệu để chỉnh sửa

Database mới chưa có dataset để mở trong editor. Để nạp dữ liệu mẫu Việt Nam vào Canonical DB và Render DB, xem hướng dẫn trong [`infra/README.md`](infra/README.md). Repo có PBF tại `data/vietnam-260901.osm.pbf`; quá trình import toàn quốc có thể mất thời gian và cần dung lượng đĩa đáng kể.

Khi import xong, khởi động editor như các bước trên. Danh sách dataset khả dụng đến từ Canonical DB. Render DB là read model phục vụ lớp dữ liệu đã publish.

## Worker và các dịch vụ tùy chọn

- **Import PBF từ giao diện:** cần chạy `import-worker` bên cạnh API. Hướng dẫn upload, token, giới hạn file và khởi chạy worker nằm trong [`docs/pbf-import.md`](docs/pbf-import.md). API native lưu file ở `data/imports`, cùng thư mục được worker Docker mount.
- **Publish thay đổi sau Save:** chạy `render-sync-worker` để xử lý hàng đợi từ Canonical sang Render. Có lệnh khởi động và cách kiểm tra revision trong [`infra/README.md`](infra/README.md).
- **Tile server nền vệ tinh local:** tùy chọn, cấu hình và lệnh chạy cũng nằm trong [`infra/README.md`](infra/README.md). Frontend dev hoặc API không tự khởi động dịch vụ này.

API native chiếm cổng `4173`; chế độ Vite chiếm cổng `5173`. Không chạy API native đồng thời với `editor-api` Docker trên cùng cổng. Nếu đổi cổng Postgres, đặt `POSTGRES_PORT` trong `infra/.env`; các biến DB riêng có thể được override bằng biến môi trường `CANONICAL_DB_*` và `RENDER_DB_*`.

## Chỉ mục không gian

Migration của database mới được Compose áp dụng khi tạo volume lần đầu. Với volume cũ, xem các migration trong `infra/init`. API sử dụng GiST index trên `editor.entity_current.bbox`; có thể yêu cầu API tạo index còn thiếu bằng cách đặt `EDITOR_ENSURE_INDEXES=1` nếu user DB được phép tạo index.

## Tài liệu khác

- [`infra/README.md`](infra/README.md): PostGIS, import dữ liệu, render worker và tile server.
- [`docs/pbf-import.md`](docs/pbf-import.md): upload PBF, import worker và cấu hình bảo vệ.
- [`docs/requirements.md`](docs/requirements.md): phạm vi và yêu cầu sản phẩm.
