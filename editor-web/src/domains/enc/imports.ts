export const maxEncUploadBytes = 100 * 1024 * 1024;
export type EncImport = {
  id: string; name: string; state: string; jobState: string; featureCount: number;
  error: string | null; sourceFilename?: string; createdAt?: string;
  bounds: [number, number, number, number] | null; outcomes?: Record<string, number>;
};
export type ArchiveSummary = { cells: number; updates: number };

export function validateImportName(name: string, existing: readonly EncImport[]): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/.test(name)) return 'Dùng 1–80 chữ cái ASCII, số hoặc dấu gạch ngang; bắt đầu bằng chữ hoặc số.';
  if (existing.some(item => item.name === name)) return 'Tên lần nhập đã tồn tại. Hãy chọn tên khác.';
  return '';
}

// Inspect only the ZIP directory; decompression and ISO 8211 validation remain on the server.
export async function inspectEncArchive(file: File): Promise<ArchiveSummary> {
  if (!/\.zip$/i.test(file.name)) throw new Error('Chọn ZIP chứa hải đồ S-57 (.000 và các update đi kèm).');
  if (!file.size) throw new Error('File ZIP trống.');
  if (file.size > maxEncUploadBytes) throw new Error('File vượt giới hạn 100 MiB.');
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
  const tailView = new DataView(tail.buffer);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === 0x06054b50 && i + 22 + tailView.getUint16(i + 20, true) === tail.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Không đọc được cấu trúc ZIP. File có thể bị hỏng hoặc tải chưa xong.');
  const count = tailView.getUint16(end + 10, true);
  const size = tailView.getUint32(end + 12, true), start = tailView.getUint32(end + 16, true);
  if (tailView.getUint16(end + 4, true) || tailView.getUint16(end + 6, true) || tailView.getUint16(end + 8, true) !== count) throw new Error('Không hỗ trợ ZIP chia thành nhiều phần.');
  if (count === 65535 || start === 0xffffffff || size === 0xffffffff) throw new Error('Hãy dùng ZIP thông thường, không dùng ZIP64.');
  if (!count || size > 20 * 1024 * 1024 || start + size > file.size - tail.length + end) throw new Error('Thư mục ZIP không hợp lệ.');
  const directory = new Uint8Array(await file.slice(start, start + size).arrayBuffer());
  const view = new DataView(directory.buffer), paths = new Set<string>();
  const cells = new Map<string, { directory: string; versions: Set<number> }>();
  let offset = 0, unpacked = 0, updates = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > directory.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Thư mục ZIP bị hỏng.');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const length = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const next = offset + 46 + length + extra + comment;
    if (next > directory.length) throw new Error('Thư mục ZIP bị cắt ngắn.');
    if (flags & 1) throw new Error('ZIP có mật khẩu không được hỗ trợ.');
    if (![0, 8].includes(method)) throw new Error('Hãy nén ZIP bằng Deflate hoặc Store.');
    unpacked += view.getUint32(offset + 24, true);
    if (unpacked > 2 * 1024 ** 3) throw new Error('Dữ liệu giải nén vượt giới hạn 2 GiB.');
    const raw = new TextDecoder().decode(directory.subarray(offset + 46, offset + 46 + length)).replaceAll('\\', '/');
    if (raw.startsWith('/') || raw.includes(':') || raw.includes('\0') || raw.split('/').includes('..')) throw new Error('ZIP chứa đường dẫn không an toàn.');
    const path = raw.split('/').filter(part => part && part !== '.').join('/').toLowerCase();
    if (paths.has(path)) throw new Error('ZIP chứa đường dẫn trùng nhau.');
    paths.add(path);
    if (((view.getUint32(offset + 38, true) >>> 16) & 0xf000) === 0xa000) throw new Error('ZIP chứa liên kết tượng trưng không được hỗ trợ.');
    const match = path.match(/(?:^|\/)([^/]+)\.(\d{3})$/);
    if (match && match[1] !== 'catalog') {
      const folder = path.slice(0, path.lastIndexOf('/') + 1), version = Number(match[2]);
      const cell = cells.get(match[1]) ?? { directory: folder, versions: new Set<number>() };
      if (cell.directory !== folder || cell.versions.has(version)) throw new Error(`Cell ${match[1].toUpperCase()} bị trùng hoặc update nằm khác thư mục.`);
      cell.versions.add(version); cells.set(match[1], cell);
      if (version > 0) updates++;
    }
    offset = next;
  }
  if (offset !== directory.length) throw new Error('Thư mục ZIP có dữ liệu không hợp lệ.');
  if (!cells.size) throw new Error('ZIP không có cell gốc .000.');
  for (const [name, cell] of cells) {
    if (!cell.versions.has(0)) throw new Error(`Cell ${name.toUpperCase()} có update nhưng thiếu file gốc .000.`);
    if (cell.versions.size !== Math.max(...cell.versions) + 1) throw new Error(`Cell ${name.toUpperCase()} thiếu update trong chuỗi liên tiếp.`);
  }
  return { cells: cells.size, updates };
}

export function uploadEnc(file: File, name: string, onProgress: (value: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = () => signal.removeEventListener('abort', abort);
    request.open('POST', `/api/uploads?${new URLSearchParams({ dataset: name })}`);
    request.setRequestHeader('X-Editor-Import', '1');
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => {
      finish();
      let body: { id?: string; error?: string } = {};
      try { body = JSON.parse(request.responseText); } catch { /* Report HTTP status below. */ }
      if (request.status === 202 && body.id) resolve(body.id);
      else reject(new Error(body.error || `Không upload được ENC (${request.status}).`));
    };
    request.onerror = () => { finish(); reject(new Error('Mất kết nối khi upload. Hãy tải lại danh sách trước khi thử lại.')); };
    request.onabort = () => { finish(); reject(new DOMException('Đã hủy upload. Hãy kiểm tra danh sách nếu server đã nhận xong file.', 'AbortError')); };
    if (signal.aborted) { reject(new DOMException('Đã hủy upload.', 'AbortError')); return; }
    signal.addEventListener('abort', abort, { once: true });
    const body = new FormData(); body.append('file', file); request.send(body);
  });
}
