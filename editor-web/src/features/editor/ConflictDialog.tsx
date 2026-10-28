import { useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import type { EditorChange } from './EditorStore';
import { loadEntitySnapshots, type SnapshotBatch } from '../../api/conflicts';
import { planConflictResolution, snapshotKeys, type ConflictChoice, type ResolutionPlan } from './conflictResolution';

export interface ConflictSession { changes: EditorChange[]; batch: SnapshotBatch }
interface Props { session: ConflictSession; onClose: () => void; onApply: (plan: ResolutionPlan) => void }

function display(value: unknown): string {
  if (value === undefined || value === null) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function ConflictDialog({ session, onClose, onApply }: Props) {
  const [batch, setBatch] = useState(session.batch);
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const plan = useMemo(() => planConflictResolution(session.changes, batch, choices), [session.changes, batch, choices]);
  const conflicts = plan.fields.filter(field => field.conflict);
  const versions = new Map(batch.snapshots.map(item => [item.key, item.version]));
  const originalVersions = new Map(session.changes.map(change => [change.key, change.before?.properties.version]));
  const reload = async () => {
    setLoading(true); setError(null);
    try { setBatch(await loadEntitySnapshots(snapshotKeys(session.changes))); setChoices({}); setConfirmDiscard(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không tải được bản server.'); }
    finally { setLoading(false); }
  };
  const discardDraft = () => {
    // Dropping only one member of a split/merge could leave dangling refs. This
    // explicit operation discards the complete pending draft, including creates.
    onApply({ ...plan, blockers: [], fields: [], entities: plan.entities.map(item => ({ ...item, local: item.base })) });
  };
  return (
    <Dialog open maxWidth="lg" fullWidth onClose={loading ? undefined : onClose} aria-labelledby="conflict-title">
      <DialogTitle id="conflict-title">Dữ liệu đã được sửa trên server</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Alert severity="warning">Chưa có thay đổi nào của lần upload này được lưu. Bản nháp của bạn vẫn được giữ.</Alert>
          <Typography variant="body2">So sánh bản gốc, local và server. Các trường sửa độc lập được ghép sẵn; {conflicts.length} trường cần lựa chọn. Áp dụng sẽ cập nhật preview để bạn kiểm tra rồi bấm Lưu lại.</Typography>
          <Alert severity="info">Giải quyết xung đột sẽ bắt đầu lại lịch sử Undo trên bản server mới, giữ toàn bộ thay đổi còn chờ trong một transaction.</Alert>
          {error && <Alert severity="error">{error}</Alert>}
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="So sánh local và server">
              <TableHead><TableRow>{['Đối tượng / trường', 'Bản gốc', 'Local', 'Server', 'Kết quả'].map(label => <TableCell key={label} sx={{ fontWeight: 800 }}>{label}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {plan.fields.map(field => <TableRow key={field.id} sx={{ bgcolor: field.conflict ? '#fff7ed' : undefined }}>
                  <TableCell sx={{ minWidth: 150 }}><Typography variant="caption">{field.entityKey}</Typography><Typography variant="body2" sx={{ fontWeight: 700 }}>{field.label}</Typography><Typography variant="caption" sx={{ color: '#64748b' }}>Gốc v{originalVersions.get(field.entityKey)} → server v{versions.get(field.entityKey)}</Typography></TableCell>
                  {[field.base, field.local, field.server].map((value, index) => <TableCell key={index} sx={{ maxWidth: 260 }}><Box component="pre" sx={{ m: 0, fontSize: 11, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 140, overflow: 'auto' }}>{display(value)}</Box></TableCell>)}
                  <TableCell sx={{ minWidth: 160 }}>
                    {field.conflict ? <TextField select size="small" fullWidth label="Dùng giá trị" value={choices[field.id] ?? ''} disabled={loading} onChange={event => setChoices(previous => ({ ...previous, [field.id]: event.target.value as ConflictChoice }))}>
                      <MenuItem value="" disabled>Chọn…</MenuItem>
                      {field.localAllowed && <MenuItem value="local">Local</MenuItem>}
                      <MenuItem value="server">Server</MenuItem>
                    </TextField> : <Chip size="small" label={field.choice === 'local' ? 'Local · tự ghép' : 'Server · tự ghép'} />}
                  </TableCell>
                </TableRow>)}
                {!plan.fields.length && <TableRow><TableCell colSpan={5}>Không có trường khác biệt; chỉ cần cập nhật baseline/version.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Box>
          {plan.blockers.length > 0 && <Alert severity="warning">{plan.blockers[0]}{plan.blockers.length > 1 ? ` (còn ${plan.blockers.length - 1} mục)` : ''}</Alert>}
          {confirmDiscard && <Alert severity="error" action={<Button color="error" disabled={loading} onClick={discardDraft}>Xác nhận bỏ bản nháp</Button>}>Bỏ toàn bộ {session.changes.length} chỉnh sửa chưa lưu, gồm cả đối tượng mới và nhóm topology. Dùng dữ liệu server.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        <Button disabled={loading} onClick={onClose}>Để sau · giữ nháp</Button>
        <Button disabled={loading} onClick={() => { void reload(); }}>{loading ? 'Đang tải…' : 'Tải lại bản server'}</Button>
        <Button color="error" disabled={loading} onClick={() => setConfirmDiscard(true)}>Bỏ toàn bộ bản nháp</Button>
        <Button variant="contained" disabled={loading || plan.blockers.length > 0} onClick={() => onApply(plan)}>Áp lại vào preview</Button>
      </DialogActions>
    </Dialog>
  );
}
