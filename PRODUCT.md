# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Người quản trị dữ liệu bản đồ biên tập, hiệu chỉnh và kiểm soát dữ liệu địa lý trong quá trình vận hành.

## Product Purpose

Map Service Editor có hai không gian: biên tập dữ liệu OSM PBF và xem/biên tập cơ bản hải đồ ENC S-57. OSM cho phép xem thay đổi trực tiếp và lưu theo changeset; ENC ghép các cell đã import để tra cứu và lưu phần chỉnh sửa trong workspace riêng theo cell. Thành công được đo bằng độ chính xác của dữ liệu và tọa độ, tốc độ hiển thị, cùng phản hồi ổn định khi thao tác.

## Positioning

Ứng dụng duy trì một dữ liệu canonical riêng để biên tập node, way, relation và tag; preview trong trình duyệt hoạt động độc lập với pipeline render, còn dữ liệu xuất bản được đồng bộ bất đồng bộ sau khi lưu.

## Operating Context

Người dùng làm việc trên bản đồ tương tác để chọn, tạo, sửa và kiểm tra topology của đối tượng địa lý. Dataset được nhập từ OSM PBF; việc lưu tạo changeset, phiên bản và hàng đợi đồng bộ render/tile.

## Capabilities and Constraints

- Biên tập node, way, relation, geometry, topology và tag trong trình duyệt.
- Preview cục bộ, undo/redo, validation, changeset, revision, rollback và theo dõi trạng thái render sau khi lưu.
- Canonical PostGIS là nguồn dữ liệu biên tập; Render DB chỉ là read model do pipeline xuất bản quản lý.
- Phải giữ nguyên logic nghiệp vụ hiện tại trong các thay đổi giao diện.
- Tốc độ hiển thị và phản hồi phải ổn định, không làm giảm độ chính xác dữ liệu hoặc tọa độ.
- ENC có workspace biên tập cơ bản theo cell, sửa thuộc tính/điểm và lưu riêng.
  Chưa công bố workspace hoặc xuất ngược S-57; xem `docs/enc-editing.md`.
- Hai domain có model, worker và API riêng; dùng chung hệ giao diện và hạ tầng.

## Brand Commitments

- Tên sản phẩm đang dùng: GEODATA WEBGIS / Map Service Editor.
- Tone đỏ là màu chủ đạo bắt buộc duy trì.

## Evidence on Hand

- Tài liệu kiến trúc và yêu cầu: `docs/requirements.md`.
- Hướng dẫn vận hành hạ tầng: `README.md` và `infra/README.md`.
- Mã nguồn giao diện: `editor-web`; API: `editor-api`; pipeline hạ tầng: `infra`.
- Không có chứng thực khách hàng, chỉ số hiệu năng, hay tài sản thương hiệu khác được xác nhận; không được tự tạo các nội dung này.

## Product Principles

1. Độ chính xác tọa độ và tính toàn vẹn dữ liệu luôn được ưu tiên hơn tiện lợi thao tác.
2. Phản hồi khi biên tập phải nhanh, rõ trạng thái và ổn định.
3. Preview cục bộ không được làm mơ hồ trạng thái dữ liệu đã xuất bản.
4. Mọi thay đổi giao diện phải bảo toàn logic nghiệp vụ đang có.
