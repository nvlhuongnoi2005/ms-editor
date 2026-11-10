import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import { Trash2, Upload } from 'lucide-react';
import { inspectEncArchive, uploadEnc, validateImportName, type ArchiveSummary, type EncImport } from './imports';

type Props = { datasets: EncImport[]; error: string; onClose: () => void; onRefresh: () => void; onImported: (id: string) => void; onView: (id: string) => void; onDelete: (item: EncImport) => void };
const stages: Record<string, string> = { queued: 'Chờ worker', extracting: 'Đang giải nén', reading: 'Đang đọc S-57', ready: 'Đã xử lý', failed: 'Thất bại' };

export function EncImportDialog({ datasets, error: catalogError, onClose, onRefresh, onImported, onView, onDelete }: Props) {
  const [file, setFile] = useState<File | null>(null), [name, setName] = useState('');
  const [summary, setSummary] = useState<ArchiveSummary | null>(null);
  const [checking, setChecking] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const generation = useRef(0), controller = useRef<AbortController | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; controller.current?.abort(); }; }, []);
  const nameError = name ? validateImportName(name, datasets) : '';
  const selectFile = async (next: File | null) => {
    const current = ++generation.current;
    setFile(next); setSummary(null); setError(''); setNotice('');
    if (!next) { setChecking(false); return; }
    setName(next.name.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+/, '').slice(0, 80));
    setChecking(true);
    try {
      const result = await inspectEncArchive(next);
      if (mounted.current && current === generation.current) setSummary(result);
    } catch (reason) { if (mounted.current && current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (mounted.current && current === generation.current) setChecking(false); }
  };
  const upload = async () => {
    if (!file || !summary || busy || checking) return;
    const invalid = validateImportName(name, datasets);
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(''); setNotice(''); setProgress(0);
    controller.current = new AbortController();
    try {
      const id = await uploadEnc(file, name, setProgress, controller.current.signal);
      if (!mounted.current) return;
      setFile(null); setName(''); setSummary(null);
      setNotice('Đã tiếp nhận ZIP. Worker xử lý nền; bạn có thể đóng bảng và tiếp tục xem hải đồ.');
      onImported(id); onRefresh();
    } catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : String(reason)); onRefresh(); } }
    finally { if (mounted.current) { setBusy(false); setProgress(null); } controller.current = null; }
  };
  return <Dialog open fullWidth maxWidth="md" onClose={busy ? undefined : onClose} aria-labelledby="enc-import-title" slotProps={{ paper: { sx: { fontFamily: 'EncPlex, sans-serif', bgcolor: '#fcfbf7', borderRadius: 1, '& .MuiTypography-root, & .MuiButton-root, & .MuiInputBase-root, & .MuiInputLabel-root': { fontFamily: 'inherit' } } } }}>
    <DialogTitle id="enc-import-title">Dữ liệu / Import ENC</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        <Alert severity="info">Mỗi ZIP tạo một lần nhập. Cell hợp lệ được ghép vào kho ENC chung; bản trùng được dùng lại, bản xung đột không tự công bố.</Alert>
        {catalogError && <Alert severity="error" action={<Button color="inherit" onClick={onRefresh}>Tải lại</Button>}>{catalogError}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Typography component="h3" variant="subtitle2">Hải đồ đã xử lý</Typography>
        {!datasets.some(item => item.state === 'ready') && <Typography variant="body2">Chưa có lần nhập sẵn sàng.</Typography>}
        {datasets.filter(item => item.state === 'ready').map(item => <Stack key={item.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item.name}</Typography><Typography variant="caption">{item.featureCount.toLocaleString('vi-VN')} feature · {(item.outcomes?.imported ?? 0) + (item.outcomes?.duplicate ?? 0) + (item.outcomes?.older ?? 0) + (item.outcomes?.conflict ?? 0)} cell</Typography></Box>
          <Button size="small" disabled={busy} onClick={() => onView(item.id)}>Xem trên bản đồ</Button>
        </Stack>)}
        <Divider />
        <Typography component="h3" variant="subtitle2">Upload hải đồ S-57</Typography>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Button component="label" variant="outlined" disabled={busy} startIcon={<Upload size={16} />}>Chọn ZIP ENC<input hidden type="file" accept=".zip,application/zip" onChange={event => { const next = event.target.files?.[0] ?? null; event.target.value = ''; void selectFile(next); }} /></Button>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MiB` : 'Chưa chọn file'}</Typography>
        </Stack>
        <TextField label="Tên lần nhập mới" fullWidth value={name} disabled={busy} onChange={event => setName(event.target.value)} error={Boolean(nameError)} helperText={nameError || 'Tối đa 100 MiB. Tên duy nhất, 1–80 chữ ASCII, số hoặc gạch ngang.'} slotProps={{ htmlInput: { maxLength: 80 } }} />
        {checking && <Box role="status"><LinearProgress /><Typography variant="caption">Đang kiểm tra cấu trúc ZIP và chuỗi update…</Typography></Box>}
        {summary && <Alert severity="success">Đã kiểm tra cấu trúc: {summary.cells} cell gốc, {summary.updates} update. Server sẽ kiểm tra nội dung S-57 trước khi công bố.</Alert>}
        {progress !== null && <Box role="status"><LinearProgress variant="determinate" value={progress} /><Typography variant="caption">Upload {progress}% · Worker xử lý sau khi server tiếp nhận xong file.</Typography></Box>}
        <Button variant="contained" disabled={!file || !summary || !name || Boolean(nameError) || checking || busy || Boolean(catalogError)} onClick={() => void upload()}>{busy ? 'Đang tải lên…' : 'Upload và nhập hải đồ'}</Button>
        <Divider />
        <Typography component="h3" variant="subtitle2">Tác vụ import gần đây</Typography>
        {!datasets.length && <Typography variant="body2">Chưa có tác vụ import.</Typography>}
        {datasets.map(item => <Box key={item.id} sx={{ borderBottom: '1px solid #d4d3c8', pb: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item.name}</Typography><Chip size="small" color={item.state === 'failed' ? 'error' : item.state === 'ready' ? 'success' : 'default'} label={stages[item.jobState] || item.jobState} /></Stack>
          <Typography variant="caption">{item.sourceFilename || 'ZIP ENC'}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` : ''}</Typography>
          {item.state === 'importing' && <LinearProgress sx={{ my: 1 }} />}
          {item.state === 'ready' && <Typography variant="body2">{item.outcomes?.imported ?? 0} đã nhập · {item.outcomes?.duplicate ?? 0} trùng · {item.outcomes?.older ?? 0} cũ · {item.outcomes?.conflict ?? 0} xung đột</Typography>}
          {item.error && <Alert severity="error" sx={{ mt: 1, overflowWrap: 'anywhere' }}>{item.error}</Alert>}
          <Button size="small" color="error" startIcon={<Trash2 size={14} />} disabled={busy || item.state === 'importing'} onClick={() => onDelete(item)}>Xóa lần nhập</Button>
        </Box>)}
      </Stack>
    </DialogContent>
    <DialogActions>{busy && <Button onClick={() => controller.current?.abort()}>Hủy upload</Button>}<Button disabled={busy} onClick={onRefresh}>Tải lại</Button><Button disabled={busy} onClick={onClose}>Đóng</Button></DialogActions>
  </Dialog>;
}
