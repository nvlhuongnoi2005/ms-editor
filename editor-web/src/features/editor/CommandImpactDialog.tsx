import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import type { GeometryCommandPlan } from './geometryCommandPlan';
export interface PendingMutation { label: string; plan: GeometryCommandPlan; keys: string[] }
export function CommandImpactDialog({ command, onApply, onClose }: { command: PendingMutation; onApply: () => void; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const impact = command.plan.impact;
  return <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="command-impact-title">
    <DialogTitle id="command-impact-title">Kiểm tra trước khi {impact.deleted ? 'xóa' : 'di chuyển'}</DialogTitle>
    <DialogContent dividers><Stack spacing={1.5}>
      <Typography>{impact.selected} lựa chọn · {impact.deleted ? `Xóa ${impact.deleted} entity` : `${impact.changedNodes} node thay đổi`} · 1 bước Undo.</Typography>
      {impact.deleted > 0 && <Alert severity="warning">Nếu lựa chọn gồm nhóm, các thành viên được mở rộng cũng sẽ bị xóa. Bỏ nhóm là thao tác khác và giữ lại các đối tượng.</Alert>}
      <Typography variant="body2">Ngoài lựa chọn: {impact.externalWays.length} đường/vùng, {impact.externalRelations.length} relation liên quan trong dữ liệu đã tải.</Typography>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{[...impact.externalWays, ...impact.externalRelations].join(', ')}</Typography>
      <Typography variant="body2">Chỉ cập nhật bản nháp sau khi xác nhận. Có thể Hoàn tác; chưa ghi vào server.</Typography>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose}>Hủy</Button><Button variant="contained" color={impact.deleted ? 'error' : 'primary'} onClick={() => { try { onApply(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể áp dụng.'); } }}>Xác nhận {impact.deleted ? 'xóa' : 'di chuyển'}</Button></DialogActions>
  </Dialog>;
}
