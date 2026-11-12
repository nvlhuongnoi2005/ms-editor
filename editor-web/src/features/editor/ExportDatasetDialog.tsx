import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Stack, Typography } from '@mui/material';
import { cancelExport, createExport, ExportRequestError, loadExport, setExportPaused, type ExportJob } from '../../api/exports';
import { startVisiblePolling } from '../../api/polling';
import { getPBFDownload } from './pbfDownload';
import type { DownloadState } from './downloadTypes';

interface Props { dataset: string; hasDraft: boolean; saving: boolean; onClose: () => void }
const emptyDownload: DownloadState = { mode: 'idle', file: null, offset: 0, error: null };
const emptySubscribe = () => () => {};
const emptySnapshot = () => emptyDownload;
const connectionWarning = 'Chưa cập nhật được tiến độ xuất. Hãy kiểm tra kết nối và thử lại.';
const sessionKey = (dataset: string) => `osm-export-current:${dataset}`;
const seenExports = new Set<string>();
const exportsToPauseOnLeave = new Set<string>();
window.addEventListener('pagehide', () => {
  for (const id of exportsToPauseOnLeave) void setExportPaused(id, true, undefined, true).catch(() => {});
});
function remember(dataset: string, id: string | null) {
  try { if (id) sessionStorage.setItem(sessionKey(dataset), id); else sessionStorage.removeItem(sessionKey(dataset)); } catch { /* Works without persistence if storage is unavailable. */ }
}
function recall(dataset: string) { try { return sessionStorage.getItem(sessionKey(dataset)); } catch { return null; } }
function sizeLabel(bytes: number) { return `${(bytes / 1024 ** 3).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} GiB`; }
function Progress({ value, label }: { value?: number; label: string }) {
  return <LinearProgress aria-label={label} variant={value === undefined ? 'indeterminate' : 'determinate'} value={value}
    sx={{ height: 8, borderRadius: 1, '& .MuiLinearProgress-bar': { borderRadius: 1, transition: 'transform .3s ease-out' },
      '@media (prefers-reduced-motion: reduce)': { '& .MuiLinearProgress-bar': { animation: 'none', transition: 'none' } } }} />;
}
function ExportProgress({ job }: { job: ExportJob }) {
  const known = typeof job.totalCount === 'number';
  const percent = known ? Math.min(100, job.totalCount === 0 ? 100 : job.entityCount / job.totalCount! * 100) : 0;
  const writing = job.phase === 'writing' && known;
  const text = job.cancelRequested ? 'Đang xóa tác vụ xuất…'
    : job.pauseRequested ? job.phase === 'paused' ? 'Đã tạm dừng xuất' : 'Đang tạm dừng xuất…'
    : job.phase === 'paused' ? 'Đang tiếp tục xuất…'
    : job.state === 'queued' ? 'Đang chờ xuất…'
    : job.phase === 'hashing' || job.phase === 'finalizing' ? 'Đã xuất đủ đối tượng · Đang hoàn tất file…'
    : writing ? `${percent.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% · Đã xuất ${job.entityCount.toLocaleString('vi-VN')} / ${job.totalCount!.toLocaleString('vi-VN')} đối tượng`
    : 'Đang đếm tổng số đối tượng…';
  return <Stack spacing={1}>
    <Typography variant="body2" role="status">{text}</Typography>
    <Progress label="Tiến độ xuất dữ liệu" value={job.pauseRequested ? percent : writing && !job.cancelRequested ? percent : undefined} />
  </Stack>;
}

export function ExportDatasetDialog({ dataset, hasDraft, saving, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(() => recall(dataset));
  const [job, setJob] = useState<ExportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [togglingExport, setTogglingExport] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [download] = useState(() => getPBFDownload(dataset));
  const transfer = useSyncExternalStore(download?.subscribe ?? emptySubscribe, download?.getSnapshot ?? emptySnapshot);
  const creation = useRef<AbortController | null>(null);
  const cancellation = useRef<AbortController | null>(null);
  const exportControl = useRef<AbortController | null>(null);
  useEffect(() => () => { creation.current?.abort(); cancellation.current?.abort(); exportControl.current?.abort(); }, []);
  const select = (id: string | null) => { remember(dataset, id); setSelected(id); if (!id) setJob(null); };

  useEffect(() => {
    if (!selected) return;
    const polling = startVisiblePolling(async signal => {
      try {
        let result = await loadExport(selected, signal);
        if (!seenExports.has(selected)) {
          seenExports.add(selected);
          if ((result.state === 'running' || result.state === 'queued') && !result.cancelRequested && !result.pauseRequested) {
            await setExportPaused(selected, true, signal);
            result = await loadExport(selected, signal);
          }
        }
        if (!signal.aborted) {
          if ((result.state === 'queued' || result.state === 'running') && !result.pauseRequested && !result.cancelRequested) exportsToPauseOnLeave.add(selected);
          else exportsToPauseOnLeave.delete(selected);
          setError(current => current === connectionWarning ? null : current);
          if (result.state === 'failed' || result.state === 'cancelled') {
            if (result.state === 'failed') setError('Xuất file chưa thành công. Bạn có thể thử tạo lại file.');
            remember(dataset, null); setSelected(null); setJob(null);
          } else setJob(result);
        }
        return result.state === 'queued' || result.state === 'running' ? result.phase === 'paused' ? 15_000 : 3000 : 300_000;
      } catch (reason) {
        if (!signal.aborted) {
          if (reason instanceof ExportRequestError && reason.status === 404) {
            exportsToPauseOnLeave.delete(selected);
            remember(dataset, null); setSelected(null); setJob(null);
            setError('Không tìm thấy tác vụ xuất. Bạn có thể thử tạo lại file.');
          } else setError(connectionWarning);
        }
        throw reason;
      }
    });
    return () => polling.dispose();
  }, [dataset, selected, refresh]);

  const start = async () => {
    if (creating) return;
    const controller = new AbortController(); creation.current = controller;
    setCreating(true); setError(null);
    try {
      const result = await createExport(dataset, controller.signal);
      if (!controller.signal.aborted) { seenExports.add(result.id); exportsToPauseOnLeave.add(result.id); setJob(null); select(result.id); setRefresh(value => value + 1); }
    } catch { if (!controller.signal.aborted) setError('Chưa tạo được file xuất. Vui lòng thử lại.'); }
    finally { if (!controller.signal.aborted) setCreating(false); }
  };
  const stopExport = async () => {
    if (!job || stopping) return;
    const controller = new AbortController(); cancellation.current = controller;
    setStopping(true); setError(null);
    try {
      const result = await cancelExport(job.id, controller.signal);
      if (!controller.signal.aborted) {
        exportsToPauseOnLeave.delete(job.id);
        if (result.state === 'cancelled') select(null);
        else setJob(current => current && ({ ...current, cancelRequested: true }));
        setRefresh(value => value + 1);
      }
    } catch { if (!controller.signal.aborted) setError('Chưa xóa được tác vụ xuất. Vui lòng thử lại.'); }
    finally { if (!controller.signal.aborted) setStopping(false); }
  };
  const toggleExportPause = async () => {
    if (!job || togglingExport || stopping || job.cancelRequested) return;
    const controller = new AbortController(); exportControl.current = controller;
    setTogglingExport(true); setError(null);
    try {
      const result = await setExportPaused(job.id, !job.pauseRequested, controller.signal);
      if (!controller.signal.aborted) {
        if (result.pauseRequested) exportsToPauseOnLeave.delete(job.id); else exportsToPauseOnLeave.add(job.id);
        setJob(current => current && ({ ...current, pauseRequested: result.pauseRequested }));
        setRefresh(value => value + 1);
      }
    } catch { if (!controller.signal.aborted) { setError('Chưa thay đổi được trạng thái xuất. Vui lòng thử lại.'); setRefresh(value => value + 1); } }
    finally { if (!controller.signal.aborted) setTogglingExport(false); }
  };
  const perform = (task: () => Promise<unknown>) => {
    setError(null);
    void task().catch(() => { if (!download?.getSnapshot().error) setError('Thao tác tải chưa thành công. Dữ liệu đã ghi được giữ lại; hãy thử lại.'); });
  };
  const startDownload = () => {
    if (!job || !download || !job.sha256) return;
    perform(() => download.start({ id: job.id, dataset, filename: `${dataset.replace(/[^\p{L}\p{N}_.-]/gu, '_')}-r${job.revision}.osm.pbf`, total: job.bytes, sha256: job.sha256! }));
  };
  const hasTransfer = transfer.file !== null && transfer.mode !== 'saved';
  const exporting = job?.state === 'queued' || job?.state === 'running';
  const checking = transfer.mode === 'verifying';
  const progressBytes = checking ? transfer.checked ?? 0 : transfer.offset;
  const percent = transfer.file ? Math.min(100, transfer.file.total === 0 ? 100 : progressBytes / transfer.file.total * 100) : 0;
  const transferLabel = transfer.mode === 'downloading' ? 'Đang tải file…' : transfer.mode === 'saving' ? 'Đang lưu tệp về máy…'
    : checking ? 'Đang kiểm tra tính toàn vẹn…' : transfer.mode === 'stopping' ? 'Đang xóa dữ liệu tải dở…' : transfer.mode === 'ready' ? 'File đã được xác nhận toàn vẹn. Chọn nơi lưu tệp.' : 'Đã tạm dừng tải';

  return <Dialog open fullWidth maxWidth="sm" onClose={onClose} aria-labelledby="export-dataset-title">
    <DialogTitle id="export-dataset-title">Tải toàn bộ dữ liệu (.osm.pbf)</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Dataset: <strong>{dataset}</strong>. File chứa toàn bộ dữ liệu và các chỉnh sửa đã lưu khi bắt đầu xuất.</Typography>
        <Typography variant="body2">Tạm dừng giữ phần đã xử lý; bấm Tiếp tục để chạy tiếp. Xóa sẽ hủy tác vụ và xóa phần dữ liệu dở. Sau khi tải lại trang, tác vụ chờ bạn bấm Tiếp tục.</Typography>
        {hasDraft && <Alert severity="warning">Bạn có chỉnh sửa chưa lưu. Hãy lưu trước nếu muốn đưa chúng vào file PBF.</Alert>}
        {error && <Alert severity="warning" onClose={() => setError(null)}>{error}</Alert>}
        {transfer.error && !error && <Alert severity="warning">{transfer.error}</Alert>}
        {transfer.error && !hasTransfer && download && <Button color="error" sx={{ alignSelf: 'flex-start' }} onClick={() => perform(() => download.stop())}>Xóa</Button>}
        {transfer.error && !transfer.verificationFailed && job?.state === 'ready' && download && <Stack spacing={0.5}>
          <Button component="a" href={`/api/exports/${job.id}/file`} sx={{ alignSelf: 'flex-start' }}>Tải bằng trình duyệt</Button>
          <Typography variant="caption">Cách tải này quản lý tạm dừng trong Downloads. Chọn “Xóa” để hủy tác vụ và dọn phần tải dở tại đây.</Typography>
        </Stack>}
        {transfer.mode === 'initializing' && <Typography variant="body2" role="status">Đang kiểm tra dữ liệu tải dở…</Typography>}
        {selected && !job && <Typography role="status" variant="body2">Đang chuẩn bị file…</Typography>}
        {exporting && job && <>
          <ExportProgress job={job} />
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" sx={{ minWidth: 104 }} disabled={togglingExport || stopping || job.cancelRequested} onClick={() => { void toggleExportPause(); }}>{job.pauseRequested ? 'Tiếp tục' : 'Tạm dừng'}</Button>
            <Button variant="outlined" color="error" disabled={stopping || togglingExport || job.cancelRequested} onClick={() => { void stopExport(); }}>{stopping || job.cancelRequested ? 'Đang xóa…' : 'Xóa'}</Button>
          </Stack>
        </>}
        {hasTransfer && <Stack spacing={1.25}>
          <Typography variant="body2" role="status" sx={{ fontWeight: 600 }}>{transferLabel}</Typography>
          <Progress label={checking ? 'Tiến độ kiểm tra file' : 'Tiến độ tải file'} value={transfer.mode === 'saving' ? undefined : percent} />
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{percent.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% · {sizeLabel(progressBytes)} / {sizeLabel(transfer.file!.total)}</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {(transfer.mode === 'downloading' || transfer.mode === 'saving' || checking || transfer.mode === 'paused') && <Button variant="outlined" sx={{ minWidth: 104 }} disabled={transfer.verificationFailed} onClick={() => perform(() => transfer.mode === 'paused' ? download!.resume() : download!.pause())}>{transfer.mode === 'paused' ? 'Tiếp tục' : 'Tạm dừng'}</Button>}
            {transfer.mode === 'ready' && <Button variant="contained" onClick={() => perform(() => download!.save())}>Lưu tệp về máy</Button>}
            <Button color="error" variant="outlined" disabled={transfer.mode === 'stopping'} onClick={() => perform(async () => { await download!.stop(); select(null); })}>{transfer.mode === 'stopping' ? 'Đang xóa…' : 'Xóa'}</Button>
          </Stack>
          <Typography variant="caption">Cần đủ chỗ cho dữ liệu tạm và bản lưu cuối cùng. Sau khi tải xong, chọn “Lưu tệp về máy”; cache được xóa khi lưu thành công.</Typography>
        </Stack>}
        {transfer.mode === 'saved' && <Typography variant="body2" role="status">Đã lưu tệp về máy.</Typography>}
        {job?.state === 'ready' && !hasTransfer && <Stack spacing={1}>
          <Typography variant="body2" role="status">File đã sẵn sàng · {sizeLabel(job.bytes)}</Typography>
          {download ? <Button variant="contained" onClick={startDownload} sx={{ alignSelf: 'flex-start' }}>Tải .osm.pbf</Button> : <>
            <Typography variant="body2">Để tạm dừng và tiếp tục ngay tại đây, hãy dùng Chrome hoặc Edge trên máy tính. Trình duyệt này có thể quản lý tải trong mục Downloads.</Typography>
            <Button component="a" href={`/api/exports/${job.id}/file`} variant="outlined" sx={{ alignSelf: 'flex-start' }}>Tải bằng trình duyệt</Button>
          </>}
        </Stack>}
        {!selected && !hasTransfer && transfer.mode !== 'saved' && <Typography variant="body2">Chọn “Tạo file PBF” để bắt đầu.</Typography>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap' }}>
      <Button onClick={onClose}>Đóng</Button>
      <Button variant="contained" disabled={transfer.mode === 'initializing' || creating || Boolean(selected && !job) || exporting || hasTransfer || saving} onClick={() => { void start(); }}>{creating ? 'Đang tạo file…' : 'Tạo file PBF'}</Button>
    </DialogActions>
  </Dialog>;
}
