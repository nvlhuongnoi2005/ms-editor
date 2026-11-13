# Nguồn đối chiếu và quản lý cập nhật

Kiểm tra nguồn IHO ngày 12/11/2026. SHA-256 và nguồn từng PDF nằm trong `manifest.json`.

| Tài liệu | Vai trò | Tình trạng |
| --- | --- | --- |
| S-52 6.1.1 | Nội dung và yêu cầu hiển thị ENC/ECDIS | PDF lưu trong documents |
| Annex A 4.0(.4) | Presentation Library mục tiêu | Có tài liệu cấu trúc; chưa có bộ runtime đầy đủ |
| Addendum Catalogue 4.0(.3) | Đối chiếu hình ký hiệu | PDF lưu trong documents; không phải bộ LUT/CSP |
| S-4 4.10.0 | Quy tắc nội dung và biên tập hải đồ | PDF người dùng cung cấp, lưu trong documents |
| Portrayal Bulletins | Giải thích vấn đề portrayal và encoding | Tham chiếu trang IHO; cần xét từng bulletin theo phiên bản |
| S-64 / Chart 1 | Kiểm thử trình bày | Chưa nhập bộ dữ liệu và chưa có kết quả xác nhận |

Nguồn chính thức:

- [Standards in Force](https://iho.int/standards-in-force): Annex A 4.0(.4), clarification đến tháng 3/2025.
- [Standards and Specifications](https://iho.int/en/standards-and-specifications).
- [Symbol Catalogue Addendum](https://iho.int/uploads/user/pubs/standards/s-52/S-52%20PresLib%20Ed%204.0.3%20Part%20I%20Addendum_Clean.pdf).
- [Cấu trúc bộ 4.0(.4)](https://iho.int/uploads/user/pubs/standards/s-52/AnnexAS52_Arborescence_4.0.4.pdf).
- [S-52 Portrayal Bulletins](https://iho.int/s-52-portrayal-bulletins): khuyến nghị bổ sung, không ghi đè tiêu chuẩn IMO/IHO/IEC hiện hành.
- [Hồ sơ ENCWG6 về clarification 4.0.4](https://iho.int/uploads/user/Services%20and%20Standards/ENCWG/ENCWG6/ENCWG6_2021_EN_6-4_S-52%20Clarification%204.0.4.pdf): tài liệu quá trình xây dựng, không dùng riêng làm bộ quy tắc đã hợp nhất.

## Quy trình bổ sung quy tắc

1. Ghi nguồn, phiên bản, checksum và điều khoản áp dụng; phân biệt catalogue hình với LUT/CSP/DAI.
2. Ánh xạ object class + geometry + thuộc tính + ngữ cảnh → ký hiệu, category, priority, scale, text và màu. Không tự suy ra các nhánh CSP chỉ từ hình catalogue.
3. Cập nhật runtime và backend SQL tương ứng; thêm ca kiểm thử thuộc tính thiếu, tổ hợp thuộc tính, liên kết đối tượng, ba theme và ngưỡng an toàn.
4. Đối chiếu hình thực tế với Chart 1/S-64 và bộ tham chiếu đúng phiên bản; ghi kết quả vào reports.
5. Tăng rendererVersion khi quy tắc thay đổi; tăng assetVersion khi atlas/glyph thay đổi; cập nhật checksum sau khi duyệt nguồn.

Không xem một atlas đủ ảnh hoặc style hợp lệ về cú pháp MapLibre là bằng chứng phù hợp đầy đủ S-52.
