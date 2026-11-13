# Schema thuộc tính cho biên tập ENC

Nguồn được ghim cùng phiên bản GDAL của importer: **OSGeo/GDAL v3.11.5**.
Các CSV gốc và giấy phép nằm trong `gdal-3.11.5/`, được tải từ:

- [s57objectclasses.csv](https://github.com/OSGeo/gdal/blob/v3.11.5/ogr/ogrsf_frmts/s57/data/s57objectclasses.csv): lớp, kiểu primitive và tập thuộc tính A/B/C.
- [s57attributes.csv](https://github.com/OSGeo/gdal/blob/v3.11.5/ogr/ogrsf_frmts/s57/data/s57attributes.csv): kiểu dữ liệu thuộc tính.
- [s57expectedinput.csv](https://github.com/OSGeo/gdal/blob/v3.11.5/ogr/ogrsf_frmts/s57/data/s57expectedinput.csv): miền enum/list.
- [Giấy phép GDAL](https://github.com/OSGeo/gdal/blob/v3.11.5/LICENSE.TXT).

Sinh lại bằng `python ENC/tools/build_editing_schema.py`. Đầu ra
`editor-api/internal/enc/editing_schema.generated.json` được Go embed, có checksum
CSV và định nghĩa 163 lớp cơ bản cùng 181 thuộc tính khả dụng. Không cần mạng khi
chạy ứng dụng. Không sửa JSON sinh tự động hoặc mở trường tùy ý từ client.

API workspace gửi định nghĩa dùng chung và danh sách khóa theo lớp, không lặp
toàn bộ enum cho từng lớp. UI giải tham chiếu cùng schema mà backend dùng để
kiểm tra các thuộc tính thay đổi: tập trường, kiểu text/float/integer/enum/list,
giá trị hữu hạn, miền mã và một số ngưỡng số của profile biên tập. Giá trị nguồn
không đổi, định danh và liên kết được giữ nguyên. List giữ thứ tự và không tự
loại giá trị lặp, ví dụ chuỗi màu.

Đây là từ điển thuộc tính cho biểu mẫu, **không phải toàn bộ kiểm tra S-58 hoặc
quy tắc nghiệp vụ của sản phẩm ENC**. Ngày và quan hệ nghiệp vụ giữa các trường
chưa có kiểm tra đầy đủ. Tạo/di chuyển/xóa vẫn giới hạn ở 15 lớp điểm đang được
backend hỗ trợ. SOUNDG và geometry có Z/primitive dùng chung vẫn được bảo vệ.
`DEPTH` là trường dẫn xuất của nhóm sounding trong pipeline hiện tại; không phải
trường có thể thêm vào mọi lớp. OBSTRN/UWTROC/WRECKS dùng `VALSOU` theo schema.
