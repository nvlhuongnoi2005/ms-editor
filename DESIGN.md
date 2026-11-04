---
name: GEODATA WEBGIS
description: Trạm điều hành dữ liệu địa lý chính xác, gọn và phản hồi rõ.
colors:
  viettel-red: "#a51f38"
  viettel-red-deep: "#7d172a"
  editor-red: "#9b192e"
  red-tint: "#f3d8de"
  canvas: "#edf0f3"
  surface: "#ffffff"
  ink: "#1e293b"
  muted: "#64748b"
  border: "#e2e8f0"
  status-danger: "#b4233c"
  status-success: "#15803d"
typography:
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.2px"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.8px"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  control: "7px"
  panel: "12px"
  map: "14px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.editor-red}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px 16px"
  button-primary-hover:
    backgroundColor: "{colors.viettel-red-deep}"
  field-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "8px 12px"
  inspector-header:
    backgroundColor: "{colors.editor-red}"
    textColor: "{colors.surface}"
    rounded: "{rounded.panel}"
---

# Design System: GEODATA WEBGIS

## Overview

**Creative North Star: "Trạm điều hành dữ liệu địa lý"**

GEODATA WEBGIS là môi trường làm việc chuyên dụng cho quản trị dữ liệu bản đồ. Giao diện phải tạo cảm giác chính xác, gọn và có kiểm soát: bản đồ là vùng làm việc chính, còn công cụ, trạng thái và thuộc tính xuất hiện như các lớp vận hành có thứ bậc rõ.

Hệ thống ưu tiên bề mặt phẳng, đường viền tiết chế và phản hồi trạng thái rõ ràng hơn trang trí. Đỏ theo nhận diện Viettel là tín hiệu vận hành cho lựa chọn, xác nhận và thay đổi quan trọng; không biến toàn bộ màn hình thành một khối màu đỏ. Shadow chỉ dùng khi một lớp cần nổi thật sự trên bản đồ hoặc cần xác lập thứ bậc tương tác.

**Key Characteristics:**

- Bản đồ giữ vai trò trung tâm; UI bao quanh không được lấn át dữ liệu không gian.
- Nhanh, chính xác và dễ quét trạng thái trong các màn hình dày thông tin.
- Phản hồi tương tác ngắn, thấy rõ bằng màu, viền và focus ring.
- Đỏ là tín hiệu kỷ luật, dùng có chủ đích.

## Colors

Bảng màu là nền trung tính xanh-xám, bề mặt trắng và một trục đỏ Viettel dành cho hành động và trạng thái ưu tiên.

### Primary

- **Đỏ Viettel vận hành:** dùng cho hành động chính, tab đang chọn, focus ring và đối tượng đang được điều khiển.
- **Đỏ Viettel sâu:** dùng cho vùng tiêu đề cần độ tương phản cao và trạng thái hover/pressed của hành động chính.
- **Đỏ tín hiệu:** dùng cho tiêu đề inspector, viền focus và điểm nhấn điều hướng; không dùng làm nền cho mọi panel.

**The Red-as-Signal Rule.** Đỏ chỉ biểu thị lựa chọn, thay đổi, xác nhận hoặc mức ưu tiên; mọi nội dung thường nhật phải dựa trên neutral để bản đồ luôn chiếm ưu thế.

### Neutral

- **Canvas xanh-xám:** lớp nền ứng dụng và khoảng đệm quanh map.
- **Surface trắng:** panel, menu, field và vùng đọc nội dung.
- **Mực slate:** văn bản chính và nhãn cần đọc nhanh.
- **Slate dịu:** mô tả, metadata và nội dung phụ.
- **Viền lạnh:** ranh giới nhẹ giữa các vùng làm việc.

### Status

- **Đỏ lỗi:** lỗi validation và thao tác phá huỷ.
- **Xanh thành công:** trạng thái dữ liệu hợp lệ hoặc sẵn sàng.

## Typography

**Display Font:** Inter, ui-sans-serif, system-ui, sans-serif.

**Body Font:** Inter, ui-sans-serif, system-ui, sans-serif.

**Label/Mono Font:** ui-monospace, SFMono-Regular, Menlo, Consolas, monospace cho ID, tọa độ, phiên bản và dữ liệu kỹ thuật.

**Character:** Sans-serif trung tính, có trọng lượng chữ cao ở tiêu đề và label để quét nhanh. Chữ đậm tạo cấu trúc; không dùng cỡ chữ lớn mang tính quảng cáo trong không gian biên tập.

### Hierarchy

- **Title** (800, 18px, 1.25): tên đối tượng đang chọn và tiêu đề vùng thông tin quan trọng.
- **Body** (400, 14px, 1.5): giá trị thuộc tính, mô tả và nội dung làm việc.
- **Label** (800, 11px, 0.8px letter spacing, uppercase khi là nhãn nhóm): phân loại section, trạng thái và cột thông tin.
- **Metadata** (400, 11px, 1.4, monospace): ID, revision, tọa độ và thông tin kỹ thuật không gian.

**The Scan-First Rule.** Nhãn và giá trị phải có độ tương phản cấp bậc đủ để người dùng xác định loại thông tin trong một lần quét, không cần dựa vào màu đỏ.

## Layout

Ứng dụng dùng khung ba dải: header 56px, vùng map linh hoạt và status bar 32px. Trong vùng chính, map là canvas lớn; tool rail và inspector neo sát mép canvas thay vì chia đều không gian. Khoảng đệm lặp lại theo nhịp 4/8/12/16/24px.

Trên màn hình hẹp, thông tin phụ phải được thu gọn hoặc chuyển thành lớp phủ thay vì làm bản đồ quá nhỏ. Panel thuộc tính cuộn nội bộ; header, công cụ cốt lõi và trạng thái đang thao tác luôn giữ được khả năng nhìn thấy.

**The Map-First Rule.** Không có panel cố định nào được chiếm diện tích đến mức làm thao tác geometry hoặc đối chiếu tọa độ trên map trở nên khó khăn.

## Elevation & Depth

Hệ thống ưu tiên phân tầng bằng nền, viền và vùng màu hơn là shadow. Bề mặt ở trạng thái nghỉ phẳng; shadow chỉ dành cho controls của MapLibre, menu/popover, panel inspector phủ lên map và thông báo tạm thời. Các chuyển trạng thái dùng 160ms cho background, màu, border và shadow; tuân thủ `prefers-reduced-motion`.

### Shadow Vocabulary

- **Map control lift** (`0 8px 24px rgba(70, 12, 26, 0.18)`): nhóm điều khiển nổi trực tiếp trên bản đồ.
- **Overlay lift** (`0 12px 30px rgba(70, 12, 26, 0.20)`): tool rail hoặc panel cần tách bạch với imagery bên dưới.
- **Menu lift** (`0 8px 24px rgba(0, 0, 0, 0.15)`): menu và popover tạm thời.

**The Flat-by-Default Rule.** Không thêm shadow chỉ để trang trí; một shadow phải chứng minh được lớp tương tác mà nó nâng lên.

## Shapes

Controls dùng góc gọn 7px; group field và panel dùng góc 12px; map canvas dùng 14px. Chip trạng thái có thể dùng pill. Viền mảnh là phương thức phân vùng ưu tiên, với `#e2e8f0` cho neutral và tint đỏ cho vùng liên quan thao tác chính.

## Components

### Buttons

- **Character:** hành động ngắn, rõ trạng thái và không cạnh tranh với geometry trên map.
- **Shape:** góc gọn (7px), kích thước nhỏ/dense cho toolbar và panel.
- **Primary:** nền đỏ tín hiệu, chữ trắng; dành cho lưu, định vị, xác nhận hoặc hành động có hậu quả rõ.
- **Outlined/Ghost:** nền trắng hoặc trong suốt, viền neutral; dùng cho công cụ thứ cấp.
- **Hover / Focus:** chuyển màu trong 160ms; focus-visible luôn có viền 2px đỏ tín hiệu với offset 2px.

### Inputs / Fields

- **Style:** nền trắng, viền neutral, góc panel (12px) cho field thuộc tính; label và key kỹ thuật phân cấp rõ với value.
- **Focus:** chuyển viền sang đỏ tín hiệu kèm ring `0 0 0 3px rgba(155, 25, 46, 0.12)`.
- **Error / Disabled:** error dùng đỏ lỗi, không chỉ thay đổi sắc đỏ thương hiệu; disabled giảm khả năng thao tác nhưng giữ nội dung đọc được.

### Chips

- **Style:** nhỏ, dày chữ vừa phải, nền tint theo ngữ cảnh.
- **State:** dùng để biểu thị dataset đang mở, số lượng, loại đối tượng hoặc validation; không dùng chip thay thế cho action button.

### Cards / Containers

- **Corner Style:** panel (12px), map canvas (14px).
- **Background:** trắng trên canvas xanh-xám.
- **Shadow Strategy:** phẳng ở trạng thái nghỉ; chỉ nâng lớp phủ hoặc menu.
- **Border:** viền neutral mảnh, tint đỏ khi biểu thị sự liên quan đến thao tác chính.
- **Internal Padding:** 8–16px, tăng lên 24px cho dialog.

### Navigation

- **Header:** gradient đỏ sâu chỉ dùng cho thanh ứng dụng; chứa nhận diện, trạng thái sync và tác vụ cấp ứng dụng.
- **Tool rail:** icon-first, tooltip nêu tên tool và shortcut; trạng thái active dùng đỏ tín hiệu, không cần tăng kích cỡ hoặc thêm trang trí.
- **Tabs:** chữ neutral khi chưa chọn, đỏ tín hiệu và indicator 3px khi đang chọn.

### Inspector

- **Character:** bảng điều khiển đối tượng đang chọn, không phải trang thông tin chung.
- **Header:** đỏ tín hiệu, chữ trắng, hiển thị loại đối tượng, ID và trạng thái nhanh.
- **Content:** section label uppercase, field gộp nhãn/giá trị, metadata dùng mono; scroll nằm trong panel.

## Do's and Don'ts

### Do:

- **Do** để map là vùng có diện tích và độ nổi bật lớn nhất trên màn hình.
- **Do** dùng đỏ tín hiệu cho focus, selection, confirm và thay đổi cần chú ý.
- **Do** biểu đạt trạng thái bằng label, icon hoặc copy song song với màu.
- **Do** dùng monospace cho ID, revision và tọa độ để quét dữ liệu kỹ thuật.
- **Do** giữ target thao tác và tooltip rõ ràng cho tool rail icon-only.

### Don't:

- **Don't** phủ đỏ lên các surface thông thường hoặc dùng đỏ như màu văn bản mặc định.
- **Don't** thêm card, gradient hoặc shadow trang trí trong vùng cạnh tranh với map.
- **Don't** ẩn trạng thái save, validation, render hoặc selection chỉ bằng thay đổi màu.
- **Don't** làm thay đổi logic nghiệp vụ, tính chính xác dữ liệu hay tọa độ để phục vụ trình bày.
