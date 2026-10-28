import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Paper, Radio, Stack, Typography } from '@mui/material';
import { loadRecentChangesets, type RecentChangeset } from '../../api/changeset';

interface Props { dataset: string; hasDraft: boolean; busy: boolean; onClose: () => void; onRevert: (id: string) => Promise<void> }

export function ChangesetHistoryDialog({ dataset, hasDraft, busy, onClose, onRevert }: Props) {
  const [items, setItems] = useState<RecentChangeset[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true); setError(null);
    try { const items = await loadRecentChangesets(dataset, controller.signal); if (controller.signal.aborted) return; setItems(items); setSelected(previous => items.some(item => item.id === previous && item.canRevert) ? previous : items.find(item => item.canRevert)?.id ?? ''); }
    catch (reason) { if (!controller.signal.aborted) { setItems([]); setSelected(''); setError(reason instanceof Error ? reason.message : 'Không tải được changeset.'); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [dataset]);
  useEffect(() => { void reload(); return () => requestRef.current?.abort(); }, [reload]);
  const revert = async () => {
    setError(null);
    try { await onRevert(selected); }
    catch (reason) { await reload(); setError(reason instanceof Error ? reason.message : 'Không thể revert.'); }
  };
  const candidate = items.find(item => item.id === selected && item.canRevert);
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={busy ? undefined : onClose} aria-labelledby="history-title">
      <DialogTitle id="history-title">Revert một trong 3 changeset gần nhất</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.25}>
          <Typography variant="body2">Chỉ hoàn tác changeset được chọn. Hệ thống tạo changeset mới và kiểm tra lại version, dependency, topology trước khi ghi.</Typography>
          {hasDraft && <Alert severity="warning">Hãy hoàn tất lưu hoặc xử lý bản nháp hiện tại trước khi revert.</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          {loading && <Typography variant="body2" role="status">Đang kiểm tra lịch sử và khả năng revert…</Typography>}
          {!loading && !items.length && !error && <Typography variant="body2">Chưa có changeset đã commit.</Typography>}
          {items.map(item => <Paper key={item.id} variant="outlined" sx={{ p: 1.25, borderColor: selected === item.id ? '#9b192e' : undefined }}>
            <FormControlLabel sx={{ alignItems: 'flex-start', m: 0 }} control={<Radio checked={selected === item.id} disabled={loading || busy || hasDraft || !item.canRevert} onChange={() => setSelected(item.id)} />} label={<Stack spacing={0.35}>
              <Typography sx={{ fontWeight: 800 }}>#{item.id} · revision {item.revision}</Typography>
              <Typography variant="body2">{item.comment || 'Không có ghi chú'}</Typography>
              <Typography variant="caption">{new Date(item.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · {item.author}</Typography>
              <Typography variant="caption">Tạo {item.creates} · Sửa {item.modifies} · Xóa {item.deletes}</Typography>
              {!item.canRevert && <Typography variant="caption" color="error">{item.reason || 'Không thể revert ở trạng thái hiện tại.'}</Typography>}
            </Stack>} />
          </Paper>)}
          {candidate && !hasDraft && <Alert severity="info">Xác nhận revert changeset #{candidate.id}. Các changeset khác được giữ nguyên.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>Đóng</Button>
        <Button disabled={busy || loading} onClick={() => { void reload(); }}>Tải lại</Button>
        <Button color="error" variant="contained" disabled={busy || loading || hasDraft || !candidate} onClick={() => { void revert(); }}>{busy ? 'Đang revert…' : `Revert #${candidate?.id ?? '—'}`}</Button>
      </DialogActions>
    </Dialog>
  );
}
