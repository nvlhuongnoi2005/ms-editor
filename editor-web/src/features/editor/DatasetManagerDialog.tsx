import { DataManagerTabs, type DataManagerSection } from '../../shared/DataManagerTabs';
import { startVisiblePolling } from '../../api/polling';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import { loadDatasets, loadImports, retryImport, uploadPBF, type DatasetInfo, type ImportJob, type ImportState, type ImportStatus } from '../../api/datasets';

interface Props { activeId: string; canSwitch: boolean; onOpenDataset: (dataset: DatasetInfo) => void; onClose: () => void }
const stageNames: Record<ImportState, string> = { queued: 'Chờ worker', canonical: 'Đang nhập node/way/relation', render: 'Đang tạo dữ liệu render', indexing: 'Đang hoàn thiện index', ready: 'Sẵn sàng', failed: 'Thất bại' };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Không thể xử lý dữ liệu.';

export function DatasetManagerDialog({ activeId, canSwitch, onOpenDataset, onClose }: Props) {
  const [section, setSection] = useState<DataManagerSection>('datasets');
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const pollingRef = useRef<ReturnType<typeof startVisiblePolling> | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const results = await Promise.allSettled([loadDatasets(signal), loadImports(signal)]);
    if (!mounted.current || signal?.aborted) return 60_000;
    if (results[0].status === 'fulfilled') { setDatasets(results[0].value); setError(null); }
    else setError(errorText(results[0].reason));
    if (results[1].status === 'fulfilled') { setStatus(results[1].value); setImportError(null); }
    else { setStatus(null); setImportError(errorText(results[1].reason)); }
    if (results.some(result => result.status === 'rejected')) throw new Error('Không tải được trạng thái import.');
    return results[1].status === 'fulfilled' && results[1].value.jobs.some(job => job.state !== 'ready' && job.state !== 'failed') ? 2500 : 60_000;
  }, []);
  useEffect(() => {
    const polling = startVisiblePolling(signal => refresh(signal));
    pollingRef.current = polling;
    return () => { polling.dispose(); pollingRef.current = null; };
  }, [refresh]);
  const upload = async () => {
    if (!file || busy) return;
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(name)) { setError('Tên dataset: 1–80 chữ cái không dấu, chữ số hoặc dấu gạch ngang.'); return; }
    if (!/\.pbf$/i.test(file.name) || /\.osh\./i.test(file.name)) { setError('Chọn file snapshot .osm.pbf.'); return; }
    if (!file.size || (status && file.size > status.maxUploadBytes)) { setError('File trống hoặc vượt giới hạn upload.'); return; }
    setBusy(true); setProgress(0); setError(null); setNotice(null);
    controller.current = new AbortController();
    try {
      await uploadPBF(file, name, setProgress, controller.current.signal);
      if (!mounted.current) return;
      setNotice('Đã tiếp nhận file. Import chạy nền; bạn có thể đóng bảng này rồi mở lại để theo dõi.');
      setFile(null); setName(''); pollingRef.current?.refresh();
    } catch (reason) { if (mounted.current) setError(errorText(reason)); }
    finally { if (mounted.current) { setBusy(false); setProgress(null); } controller.current = null; }
  };
  const retry = async (job: ImportJob) => {
    setBusy(true); setError(null);
    try { await retryImport(job.id); pollingRef.current?.refresh(); }
    catch (reason) { if (mounted.current) setError(errorText(reason)); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <Dialog open fullWidth maxWidth="md" onClose={busy ? undefined : onClose} aria-labelledby="datasets-title">
    <DialogTitle id="datasets-title">Dữ liệu / Import PBF</DialogTitle>
    <DataManagerTabs value={section} onChange={setSection} prefix="osm-data" datasets={datasets.length} jobs={status?.jobs.length ?? 0} />
    <DialogContent dividers>
      <Stack spacing={2}>
        <Alert severity="info">Mỗi file tạo một dataset mới và vùng render riêng. Dữ liệu đang dùng không bị ghi đè. Chỉ mở được sau khi cả graph và render đã sẵn sàng.</Alert>
        {!canSwitch && <Alert severity="warning">Hãy lưu hoặc xử lý bản nháp và hoàn tất thao tác hiện tại trước khi chuyển dataset. Bạn vẫn có thể upload và theo dõi import.</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        <Box role="tabpanel" id="osm-data-panel-datasets" aria-labelledby="osm-data-tab-datasets" hidden={section !== 'datasets'}><Stack spacing={2}>
        <Typography variant="subtitle2">Dataset sẵn sàng</Typography>
        {!datasets.length && <Typography variant="body2">Chưa có dataset sẵn sàng.</Typography>}
        {datasets.map(dataset => <Stack key={dataset.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{dataset.name}</Typography><Typography variant="caption">Revision {dataset.canonicalRevision} · Render {dataset.renderRevision}</Typography></Box>
          {dataset.id === activeId ? <Chip size="small" label="Đang mở" /> : <Button size="small" disabled={!canSwitch || busy} onClick={() => onOpenDataset(dataset)}>Mở trong editor</Button>}
        </Stack>)}
        </Stack></Box>
        <Box role="tabpanel" id="osm-data-panel-upload" aria-labelledby="osm-data-tab-upload" hidden={section !== 'upload'}><Stack spacing={2}>

        <Typography variant="subtitle2">Upload snapshot .osm.pbf</Typography>
        {importError && <Alert severity="warning">{importError}</Alert>}
        {status && !status.workerOnline && <Alert severity="warning">Chưa thấy worker hoạt động. Khởi động dịch vụ import-worker; file đã nhận sẽ chờ trong hàng đợi.</Alert>}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Button component="label" variant="outlined" disabled={busy}>Chọn file PBF<input hidden type="file" accept=".pbf,.osm.pbf" onChange={event => {
            const selected = event.target.files?.[0] ?? null; setFile(selected); setNotice(null);
            if (selected) setName(selected.name.replace(/\.osm\.pbf$|\.pbf$/i, '').replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 80));
            event.target.value = '';
          }} /></Button>
          <Typography variant="body2">{file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MiB` : 'Chưa chọn file'}</Typography>
        </Stack>
        <TextField label="Tên dataset mới" size="small" value={name} disabled={busy} onChange={event => setName(event.target.value)} helperText={status ? `Giới hạn file: ${(status.maxUploadBytes / 1073741824).toFixed(1)} GiB. Không dùng tên dataset đã có.` : 'Tên không dấu, dùng chữ cái, chữ số và dấu gạch ngang.'} />
        {progress !== null && <Box><LinearProgress variant="determinate" value={progress} /><Typography variant="caption">Upload {progress}% — bước import chạy sau khi server tiếp nhận xong file.</Typography></Box>}
        <Button variant="contained" disabled={!file || !name || busy || !status} onClick={() => { void upload(); }}>{busy ? 'Đang xử lý…' : 'Upload và tạo dataset'}</Button>
        </Stack></Box>
        <Box role="tabpanel" id="osm-data-panel-jobs" aria-labelledby="osm-data-tab-jobs" hidden={section !== 'jobs'}><Stack spacing={2}>

        <Typography variant="subtitle2">Tác vụ import gần đây</Typography>
        {status?.jobs.map(job => <Box key={job.id} sx={{ border: '1px solid #d4d3c8', p: 1.5, borderRadius: 1 }}>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2">{job.dataset}</Typography><Chip size="small" color={job.state === 'failed' ? 'error' : job.state === 'ready' ? 'success' : 'default'} label={stageNames[job.state]} /></Stack>
          <Typography variant="caption">{job.filename} · {new Date(job.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · Lần chạy {job.attempts}</Typography>
          <Typography variant="body2">{job.nodes.toLocaleString('vi-VN')} node · {job.ways.toLocaleString('vi-VN')} way · {job.relations.toLocaleString('vi-VN')} relation</Typography>
          {!['queued', 'ready', 'failed'].includes(job.state) && <LinearProgress sx={{ mt: 1 }} />}
          {job.error && <Alert severity="error" sx={{ mt: 1, overflowWrap: 'anywhere' }}>{job.error}</Alert>}
          {job.state === 'failed' && <Button size="small" disabled={busy} onClick={() => { void retry(job); }}>Thử import lại</Button>}
        </Box>)}
        </Stack></Box>
      </Stack>
    </DialogContent>
    <DialogActions>{progress !== null && <Button onClick={() => controller.current?.abort()}>Huỷ upload</Button>}<Button disabled={busy} onClick={onClose}>Đóng</Button></DialogActions>
  </Dialog>;
}
