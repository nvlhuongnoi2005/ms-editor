import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography } from '@mui/material';
import { createExport, loadExports, type ExportJobs } from '../../api/exports';

interface Props { dataset: string; hasDraft: boolean; saving: boolean; onClose: () => void }
const labels = { queued: 'Đang chờ xuất', running: 'Đang xuất toàn bộ dữ liệu', ready: 'Sẵn sàng tải', failed: 'Xuất không thành công' };
function sizeLabel(bytes: number) { return `${(bytes / 1024 ** 3).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} GiB`; }

export function ExportDatasetDialog({ dataset, hasDraft, saving, onClose }: Props) {
  const [data, setData] = useState<ExportJobs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const creation = useRef<AbortController | null>(null);
  useEffect(() => () => creation.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await loadExports(dataset, controller.signal);
        if (!controller.signal.aborted) { setData(result); setError(null); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không tải được trạng thái. Hệ thống sẽ tự thử lại.');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 3000);
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [dataset, refresh]);

  const start = async () => {
    if (creating) return;
    const controller = new AbortController();
    creation.current = controller;
    setCreating(true); setError(null);
    try {
      await createExport(dataset, controller.signal);
      if (!controller.signal.aborted) setRefresh(value => value + 1);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không tạo được tác vụ. Hãy thử lại.');
    } finally { if (!controller.signal.aborted) setCreating(false); }
  };
  const active = data?.jobs.some(job => job.state === 'queued' || job.state === 'running');
  return <Dialog open fullWidth maxWidth="sm" onClose={onClose} aria-labelledby="export-dataset-title">
    <DialogTitle id="export-dataset-title">Tải toàn bộ dữ liệu (.osm.pbf)</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Dataset: <strong>{dataset}</strong>. Bao gồm toàn bộ node, way và relation còn tồn tại, cùng các chỉnh sửa đã lưu khi tác vụ bắt đầu xuất.</Typography>
        <Typography variant="body2">Có thể đóng cửa sổ này trong lúc xuất và mở lại để tải file. Khi tải, trình duyệt ghi dần dữ liệu xuống ổ đĩa; máy cần đủ dung lượng trống cho toàn bộ file.</Typography>
        {hasDraft && <Alert severity="warning">Bạn có chỉnh sửa chưa lưu. Hãy lưu trước nếu muốn đưa chúng vào file PBF.</Alert>}
        {data && !data.workerOnline && <Alert severity="warning">Worker xuất PBF chưa kết nối. Tác vụ đang chờ sẽ được xử lý khi worker hoạt động trở lại.</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        {!data && !error && <Typography role="status" variant="body2">Đang tải danh sách tác vụ…</Typography>}
        {data && !data.jobs.length && <Typography variant="body2">Chưa có file xuất. Chọn “Tạo file PBF” để bắt đầu.</Typography>}
        {data?.jobs.map(job => <Box key={job.id} sx={{ minWidth: 0 }}>
          <Divider sx={{ mb: 1.5 }} />
          <Stack spacing={0.75}>
            <Typography variant="body2" sx={{ fontWeight: 700 }} role={job.state === 'running' || job.state === 'queued' ? 'status' : undefined}>{labels[job.state]}{job.revision !== null ? ` · revision ${job.revision}` : ''}</Typography>
            <Typography variant="caption">{new Date(job.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · {job.entityCount.toLocaleString('vi-VN')} đối tượng{job.state === 'ready' ? ` · ${sizeLabel(job.bytes)}` : ''}</Typography>
            {job.state === 'failed' && <Typography variant="body2" color="error">Không thể hoàn tất xuất. Kiểm tra worker và dung lượng đĩa, sau đó tạo lại file.</Typography>}
            {job.state === 'ready' && <>
              <Button component="a" href={`/api/exports/${job.id}/file`} variant="outlined" sx={{ alignSelf: 'flex-start' }}>Tải .osm.pbf · {sizeLabel(job.bytes)}</Button>
              <Typography variant="caption">Link hỗ trợ tải tiếp bằng trình duyệt hoặc công cụ download có chức năng resume.</Typography>
              <Typography variant="caption" sx={{ overflowWrap: 'anywhere', userSelect: 'text' }}>SHA-256: {job.sha256}</Typography>
            </>}
          </Stack>
        </Box>)}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap' }}>
      <Button onClick={onClose}>Đóng</Button>
      <Button variant="contained" disabled={!data || creating || active || saving} onClick={() => { void start(); }}>{creating ? 'Đang tạo tác vụ…' : active ? 'Đang chuẩn bị file…' : 'Tạo file PBF'}</Button>
    </DialogActions>
  </Dialog>;
}
