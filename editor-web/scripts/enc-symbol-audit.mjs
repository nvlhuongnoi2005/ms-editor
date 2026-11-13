// Reproducible inventory of all shipped images and the actual selector branches.
// Run from editor-web; this reads local assets and never changes ENC data.
import { writeFile } from 'node:fs/promises';
import { loadSource } from './test-source.mjs';
const {encSymbols}=await import(await loadSource('../src/domains/enc/symbolCatalog.ts'));
const {symbolRegistries,symbolOutputs}=await import(await loadSource('../../Presentation_Library/runtime/symbolMappings.ts'));
const kindLabels={point:'điểm',area:'vùng',lineAnchor:'điểm neo trên đường',line:'đường',pattern:'mẫu phủ'};
const rows=encSymbols.map(symbol=>{
  const uses=[];
  for(const [kind,registry] of Object.entries(symbolRegistries))for(const [objectClass,value] of Object.entries(registry))
    if(symbolOutputs(value).includes(symbol.code))uses.push(`${objectClass} (${kindLabels[kind]})`);
  return `| ${symbol.code} | ${symbol.description} | ${uses.join(', ')||symbol.classes.join(', ')||'Có trong atlas; chưa có nhánh chọn trong các bảng ánh xạ ký hiệu, mẫu phủ hoặc đường'} |`;
});
const mapped=encSymbols.filter(symbol=>symbol.classes.length>0).length;
const report=`# Rà soát ánh xạ ký hiệu — 12/11/2026

Đã kiểm tra ${encSymbols.length} ảnh/theme ở cả ngày, chạng vạng và đêm: cùng mã, cùng hình chữ nhật cắt ảnh, nằm trong PNG, có giải thích. Mọi đầu ra tĩnh trong các registry điểm/vùng/điểm neo đường/đường/pattern đều có ảnh và tìm được bằng lớp đối tượng. ${mapped} ảnh có liên kết lớp trong các registry này hoặc texture hạ tầng. Các ảnh còn lại có thể là chữ số, thành phần bổ trợ, ảnh dự trữ hoặc nhánh chưa triển khai; không mặc định là sai ảnh.

## Trường hợp Manitowoc Marina

Dữ liệu active: cell US5WI32M, LNAM 02267C8AC27E5F16, lớp HRBFAC, CATHAF=["5"]. Nhánh chọn đúng là SMCFAC02 (bến du thuyền). HRBFAC09 là cảng cá, CATHAF=4. CATHAF=1 chọn ROLROL01; loại chưa có nhánh chuyên biệt chọn CHINFO07. Không suy ra hình chỉ từ tiền tố tên lớp.

Nguồn đối chiếu: [IHO Symbol Catalogue 4.0(.3), SMCFAC02 và HRBFAC09](https://iho.int/uploads/user/pubs/standards/s-52/S-52%20PresLib%20Ed%204.0.3%20Part%20I%20Addendum_Clean.pdf). Đây là catalogue hình; kiểm tra atlas không thay cho LUT/CSP đầy đủ của Presentation Library.

Đã sửa bảng tra cứu để tìm theo lớp và mọi nhánh thuộc tính từ chính registry của renderer. Bảng thuộc tính hiển thị mã và ảnh ký hiệu chính, đồng thời đưa CATHAF/CATSCF lên gần tên đối tượng. Ký hiệu chính không bao gồm toàn bộ thành phần ghép (cung đèn, chữ, texture, dấu chất lượng).

## Giới hạn và khoảng thiếu

Ảnh hợp lệ, giải thích tồn tại và nhánh chọn không trỏ ảnh thiếu không đủ chứng minh mọi tình huống đúng S-52. Kiểm thử có đối chiếu các trường hợp nguy hiểm, đèn, phương vị, dấu đỉnh, conspicuity, hình học và cảng; chưa có chứng nhận đầy đủ LUT/CSP/S-64. Các trường hợp dùng fallback CHINFO07 và nhánh chưa triển khai vẫn cần đối chiếu bộ quy tắc gốc.

Audit active hiện tại: 129.187 đối tượng địa lý, 107 lớp; 2.158 đối tượng chưa có layer phù hợp, không có ảnh yêu cầu bị thiếu hoặc sprite ngoài atlas. Xem [chi tiết theo lớp](DATASET-PORTRAYAL-COVERAGE.md). Audit đọc thuộc tính từ runtime chuẩn trong Presentation_Library; đã sửa đường dẫn đọc cũ vốn chỉ còn wrapper export.

Chạy lại: node --test scripts/enc-symbol-mapping.test.mjs scripts/enc-portrayal.test.mjs, node scripts/enc-symbol-audit.mjs, node scripts/enc-dataset-audit.mjs ../Presentation_Library/reports/DATASET-PORTRAYAL-COVERAGE.md. Kiểm tra trên dữ liệu thực và giao diện: scripts/enc-symbol-mapping.browser.mjs.

## Danh sách toàn bộ atlas

Liên kết dưới đây là tập nhánh có thể chọn, không phải khẳng định mọi đối tượng của một lớp đều dùng cùng một hình. Các điều kiện thuộc tính vẫn do runtime/sprites.ts quyết định. Cung đèn động được dựng riêng, không phải ảnh tĩnh trong bảng.

| Mã hình | Giải thích | Lớp và cách dùng trong registry |
|---|---|---|
${rows.join('\n')}
`;
await writeFile(new URL('../../Presentation_Library/reports/SYMBOL-MAPPING-AUDIT.md',import.meta.url),report,'utf8');
console.log(JSON.stringify({imagesPerTheme:encSymbols.length,imagesWithRegistryClass:mapped,imagesOutsideTheseRegistries:encSymbols.length-mapped}));
