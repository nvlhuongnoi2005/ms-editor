---
name: GEODATA — Lề atlas
description: Không gian làm việc bản đồ nhất quán cho OSM và ENC.
colors:
  primary: "#8b2235"
  primary-dark: "#681626"
  canvas: "#f5f2e9"
  surface: "#fcfbf7"
  ink: "#252c2b"
  muted: "#626a63"
  border: "#d4d3c8"
  success: "#316345"
  danger: "#ac2438"
typography:
  body:
    fontFamily: "GeodataSans, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "GeodataSans, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
  metadata:
    fontFamily: "GeodataSans, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
---

# GEODATA — Thiết kế toàn hệ thống

## Phạm vi và hướng thiết kế

Mode: **Operate**. Áp dụng cho trang chọn chế độ, OSM, ENC và các dialog nghiệp vụ.
Mở rộng hướng lề atlas đã có ở ENC: trang bản đồ có lề tra cứu, nền giấy ngà,
chữ dễ đọc, viền mảnh và dấu nhận diện đỏ. Đỏ được giữ theo yêu cầu thương hiệu.
Đây là chuẩn hóa trải nghiệm trong thế giới thị giác đã có, không tạo nhận diện
riêng cho mỗi domain. Bản đồ vẫn giữ màu dữ liệu và ký hiệu theo domain.

## Người dùng và các luồng chính

- Chọn đúng không gian: OSM để biên tập; ENC để xem hải đồ S-57.
- Mở/import dữ liệu, hiểu trạng thái xử lý và lỗi cần khắc phục.
- Tìm vị trí, xem bản đồ, chọn đối tượng và đọc thuộc tính trong bảng riêng.
- Trong OSM: chỉnh sửa, xem tác động, lưu và phân biệt nháp với dữ liệu đã lưu.
- Dùng trên desktop và màn hình nhỏ, bằng chuột, bàn phím hoặc chạm.

## Các quyết định UX

1. **Một điều hướng chung:** dấu G đỏ, tên GEODATA và menu không gian OSM/ENC.
   Menu có mô tả mục đích và chỉ rõ chế độ hiện tại. Không lặp ba đường dẫn
   chuyển chế độ trên cùng header. Dùng liên kết thật, giữ bảo vệ nháp hiện có.
2. **Bản đồ là vùng chính:** header gọn; không có khung bo tròn, khoảng đệm hoặc
   bóng lớn bao quanh canvas. Lề ENC và inspector OSM có phân cách mảnh.
3. **Phân tách điều khiển và thuộc tính:** chọn feature mở inspector; không nhét
   thuộc tính vào bảng cấu hình hải đồ. Nút đóng và tiêu đề luôn có thể tiếp cận.
4. **Hành động chính rõ:** OSM giữ nút Lưu ở header, chỉ đỏ khi có thể thao tác.
   Import là hành động cấp dữ liệu trong cả hai domain, mở dialog cùng quy tắc.
5. **Màn hình nhỏ:** OSM có hai hàng header để nút Lưu không bị đẩy ra ngoài;
   điều hướng ở hàng đầu, tác vụ ở hàng dưới. Thanh trạng thái có thao tác nháp
   cao 44 px trên điện thoại. Bảng thuộc tính nằm dưới bản đồ.
   Không dùng cuộn ngang header để giấu tác vụ. ENC điều hướng và import trong
   một hàng, lề mặc định đóng; bảng thuộc tính tối đa 46% chiều cao bản đồ.
6. **Thông tin có thứ bậc:** loại đối tượng, tên và ID trước, nội dung sau.
   Không phủ đỏ toàn bộ inspector. Trạng thái và thông số là dòng thông tin,
   không phải các thẻ chỉ số trang trí.
7. **Dialog:** tiêu đề và hành động tách khỏi vùng nội dung cuộn; field có label,
   lỗi có nguyên nhân và thao tác khôi phục. Không đổi upload thành phần trăm
   xử lý giả. Trạng thái ready/failed/busy vẫn theo API hiện tại.

## Hệ thống hiển thị

Font IBM Plex Sans được self-host trong `editor-web/src/shared/assets`, khai báo
bằng tên `GeodataSans`; giấy phép SIL OFL đi kèm. Dùng một typeface trên toàn UI,
kể cả menu và dialog qua portal. Metadata dùng tabular numerals; monospace chỉ
cho đoạn mã hoặc giá trị có nhu cầu căn kỹ thuật cụ thể.

- Trang chọn chế độ: tiêu đề 32–44 px; lựa chọn là hai hàng lớn có đường phân cách.
- Workspace: tiêu đề 18–24 px, nội dung 13–14 px, metadata 11–12 px.
- Control radius 4 px; dialog 6 px; canvas và lề không bo góc.
- Nhịp khoảng cách 4/8/12/16/24 px. Viền thay bóng trên bề mặt làm việc.
- Focus-visible 2 px đỏ với offset; selection, caret, scrollbar cùng palette.
- Target chạm tối thiểu 44 px trên màn hình hẹp; trạng thái có chữ hoặc icon,
  không chỉ có màu. Tôn trọng reduced motion.
- Màu đường/đối tượng OSM và palette day/dusk/night của ENC thuộc domain,
  không bị bộ token của giao diện ghi đè.

## Thành phần dùng chung

- `shared/theme.ts`: palette, typography, field, button, menu, chip và dialog.
- `shared/workspace.css`: font, tokens, nền, focus và bố cục chung.
- `shared/WorkspaceNavigation.tsx`: menu chọn không gian và nhận diện.
- `shared/ModeSelection.tsx`: trang vào ứng dụng, giữ route `?mode=osm/enc`.
- `shared/DataManagerTabs.tsx`: bố cục Đã nhập / Nhập dữ liệu / Tác vụ cho OSM và ENC.
- `domains/enc/enc-workspace.css`: bố cục lề, properties và footer của ENC.

## Trạng thái và ranh giới

Giữ toàn bộ logic geometry, tọa độ, topology, changeset, conflict, bản nháp và
quyền gọi API. Không thay công thức hiển thị hải đồ hoặc lựa chọn cell để phục vụ
thẩm mỹ. Lưu nháp, lưu server và đồng bộ render là các trạng thái riêng.
Không ghi nhớ chế độ bằng cách tự chuyển người dùng ra khỏi trang chọn.
Không đổi route khi mở dialog, không chuyển chế độ ngầm trong thao tác import.

## Đối chiếu triển khai

Xem ba route ở desktop 1600 px và mobile 390 px, cùng menu điều hướng và dialog
import. Xem lại bảng thuộc tính và nội dung dài; không để nút tác vụ nằm ngoài
viewport. Build TypeScript/Vite; không chạy hoặc thêm bộ kiểm thử khi chưa được yêu cầu.

### Đã đối chiếu trong lần triển khai này

- Ba route ở 320, 390, 768 và 1600 px: không thấy tràn ngang; nút Lưu OSM nằm
  trong viewport ở cả màn hình 320 px.
- Menu chuyển không gian, inspector OSM/ENC, tab import và dialog trên mobile.
- Font trong dialog qua portal là GeodataSans; các tab ẩn đúng nội dung còn lại.
- Build TypeScript/Vite thành công. Không chạy luồng ghi dữ liệu hoặc bộ kiểm thử.
- Ảnh đối chiếu lưu trong `data/design/`; đây là ảnh chụp giao diện đang chạy,
  không phải dữ liệu minh họa hoặc fixture để chứng minh nghiệp vụ.
