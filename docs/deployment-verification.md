# Kiểm tra bộ cài hệ thống — 11/11/2026

Đã kiểm tra bằng Windows PowerShell 5.1, Docker Desktop Linux containers,
Docker Engine 29.7.2 và Compose v5.4.0, kiến trúc linux/amd64. Các lần cài thử
dùng Docker project/volume mới, tách khỏi database development hiện có.

| Hạng mục | Kết quả |
| --- | --- |
| Build frontend, Go API và các worker trong Docker | Đạt. Không dùng SDK trên máy đích. |
| Khởi tạo PostGIS từ volume trống | Đạt; tạo canonical, render và enc_canonical. |
| Nạp images từ images.tar.gz khi image ứng dụng chưa có | Đạt; không pull/build trong luồng cài release. |
| Sáu dịch vụ và API | Đạt; API, database và tile server healthy. |
| Sprite PNG/JSON, glyph và TileJSON | Đạt; tài nguyên local trả thành công, TileJSON dùng cùng origin ứng dụng. |
| Consumer OSM và ENC | Đạt; heartbeat OSM, advisory lock ENC và GDAL S-57 driver sẵn sàng. |
| PBF upload từ database trống | Đạt; fixture 4 node, 1 way được nhập vào canonical/render và đọc qua graph API. |
| ENC .000 upload | Đạt; cell người dùng cung cấp nhập được 578 đối tượng. |
| ENC ZIP upload cùng cell | Đạt; bản trùng dùng lại revision. |
| Setup lặp lại | Đạt; không chạy lại migration đã ghi nhận, giữ dataset. |
| Stop/Start | Đạt; giữ mật khẩu và toàn bộ dataset vừa upload. |
| Chống hỏng bản sao và đường dẫn vượt thư mục | Đạt; kiểm tra SHA-256 và từ chối path traversal. |
| Gói hệ thống không có dữ liệu cá nhân | Đạt; không có dataset, uploads, MBTiles, database cache hoặc .env của máy đóng gói. |
| Go tests cho proxy basemap và API | Đạt. |

Tái hiện kiểm tra script bằng `scripts/deployment/verify.ps1 -Docker`.
Kiểm tra upload trên **bộ cài trống riêng biệt** bằng
`python scripts/deployment/smoke.py --url <URL> --enc <file .000>`.
Script smoke tạo PBF nhỏ bằng thư viện trong worker image; file ENC được truyền
từ ngoài và không đi vào gói phát hành. Có thể chọn worker image bằng
`--osm-image ms-editor/osm-worker:<phiên bản>`.

Các kiểm tra trên xác nhận việc build, cài đặt và xử lý dữ liệu của hệ thống.
Chúng không chứng nhận tính chính xác thủy đạc hay tuân thủ đầy đủ S-52/S-58.
Chưa kiểm tra trên một máy vật lý khác hoặc hệ điều hành/kiến trúc khác.
Ảnh vệ tinh OSM vẫn cần Internet; bộ cài không mang theo ảnh vệ tinh/MBTiles.
