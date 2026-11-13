# Tối ưu tương tác biên tập ENC — 12/11/2026

## Thay đổi

- Preview chạy theo `requestAnimationFrame`, gộp nhiều yêu cầu trong một frame.
  Không chờ `idle` hoặc `isStyleLoaded()` khi style đã có cấu trúc nhưng tile nền
  đang tải. Khi style thay thật, preview được dựng lại và khôi phục dữ liệu.
- Điểm/đường/vùng preview có ID ổn định. Dùng GeoJSON `updateData` chỉ gửi các
  feature thay đổi hoặc xóa tới worker, không gửi lại toàn bộ collection mỗi lần.
- Bộ lọc ẩn bản gốc chỉ đổi khi tập khóa override nguồn đổi. Điểm mới không nằm
  trong nguồn nền nên không cần thay bộ lọc nền. Undo thuộc tính/tọa độ của cùng
  một override không parse lại hàng trăm bộ lọc. Về chế độ xem phục hồi bộ lọc gốc.
- Writer nháp giữ tối đa một ghi đang chạy và snapshot hoàn chỉnh mới nhất, gộp
  cập nhật liên tiếp trong 16 ms. Không clone toàn bộ state ngay trong event handler.
  Snapshot cuối vẫn chứa đầy đủ Undo/Redo; không bỏ các thao tác trong lịch sử.
- Mỗi ghi vẫn dùng compare-and-swap trong IndexedDB. Ghi lỗi/xung đột khóa biên tập;
  không âm thầm bỏ lỗi hoặc ghi đè bản nháp của tab khác. Lưu server, xác nhận commit
  và thoát biên tập phải chờ `flush()` thành công. Có bảo vệ rời trang khi còn ghi dở.
- Khi chỉ đổi giữa nguồn workspace đã ghim và nguồn xem, giữ style rồi dùng
  `VectorTileSource.setTiles` để đổi URL. Header/token và phạm vi revision vẫn đổi
  đúng; không dùng lẫn tile nguồn công bố với nguồn workspace. Tile vẫn cần tải lại
  theo scope; thay theme/import/scope hiển thị vẫn dựng lại style khi cần.
- Ghi nhớ kích thước từng transaction của lịch sử thay vì serialize toàn bộ Undo
  mỗi lần sửa. Giữ giới hạn cũ 150 thao tác / khoảng 4 MiB JSON. Memoize bộ chọn
  ký hiệu, biểu mẫu thuộc tính và số thay đổi để giảm render ngoài nhu cầu.

## Kiểm tra và số đo

Chrome thật, API fixture, viewport 1440×900 và 390×900:

| Thao tác | Desktop | Mobile |
| --- | ---: | ---: |
| Undo + Redo, gồm UI và worker, trong lúc cố tình giữ tile nền chưa trả về | 243 ms | 228 ms |
| Bấm Về chế độ xem → bảng biên tập chuyển về trạng thái mở workspace | 462 ms | 249 ms |

Đã xác nhận không gọi lại `setFilter` cho Undo/Redo cùng tập khóa và không gọi
`setStyle` khi vào/ra workspace cùng cấu hình hiển thị. Save/reload/retry đúng
commit, tọa độ chính xác, khôi phục Undo/Redo, xóa điểm và CAS hai tab đều qua.
Các con số gồm cả overhead điều khiển trình duyệt, không phải cam kết latency
trên dữ liệu thật hoặc thời gian tải xong mọi tile.

Benchmark CPU tổng hợp `node scripts/enc-edit-performance.bench.mjs`: 100 đối tượng,
mỗi geometry 512 đỉnh, burst 100 lần sửa rồi 100 lần Undo trong cùng vòng lặp:

| Nhánh | 100 sửa | 100 Undo |
| --- | ---: | ---: |
| Mô phỏng serialize history + clone mỗi thao tác như trước | 11.544 ms | 11.897 ms |
| Cache history size + snapshot cuối burst | 236 ms | 138 ms |

Benchmark này minh họa CPU/bộ nhớ của burst, không đo IndexedDB, network hay render
tile và không đại diện cho 100 click tách nhau của người dùng. Ở thao tác cách xa
nhau, writer vẫn ghi mỗi snapshot; dữ liệu lớn vẫn tốn chi phí ghi và serialize.

Các ca unit kiểm tra gộp 1000 snapshot, flush khi đang ghi, lỗi CAS, cập nhật một
feature giữa 1001 override, gộp frame, phục hồi bộ lọc và giới hạn lịch sử geometry
lớn. Browser regression nằm trong `scripts/enc-editing.browser.mjs`.
