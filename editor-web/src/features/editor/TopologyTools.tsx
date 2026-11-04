import { memo, useState } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { GraphFeature } from '../../types/osm';
import { isOpenWay, mergeCandidates, wayVertices, type TopologyAction } from './topologyOperations';

interface Props {
  way: GraphFeature;
  features: GraphFeature[];
  vertexId: string | null;
  disabled: boolean;
  onVertex: (nodeId: string) => void;
  onAction: (action: TopologyAction, otherWayId?: string) => void;
  onContinue: () => void;
}

/** Context tools use explicit way/vertex choices so shared nodes stay unambiguous. */
export const TopologyTools = memo(function TopologyTools({ way, features, vertexId, disabled, onVertex, onAction, onContinue }: Props) {
  const [mergeId, setMergeId] = useState('');
  let vertices;
  try { vertices = wayVertices(way); } catch (error) {
    return <Alert severity="warning">{error instanceof Error ? error.message : 'Không đủ dữ liệu topology.'}</Alert>;
  }
  const open = isOpenWay(way);
  const closed = vertices[0].id === vertices.at(-1)!.id;
  const choices = [...new Map((closed ? vertices.slice(0, -1) : vertices).map(node => [node.id, node])).values()];
  const active = choices.some(node => node.id === vertexId) ? vertexId! : '';
  const index = vertices.findIndex(node => node.id === active);
  const endpoint = open && (index === 0 || index === vertices.length - 1);
  const candidates = mergeCandidates(way, features);
  const mergeTarget = candidates.some(candidate => candidate.properties.entityId === mergeId) ? mergeId : '';
  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, bgcolor: '#f8fafc' }}>
      <Box sx={{ p: 1.25, border: '1px solid #dbeafe', borderRadius: 1.5, bgcolor: '#eff6ff' }}>
        <Typography sx={{ color: '#1d4ed8', fontSize: 12, fontWeight: 800, mb: 0.35 }}>Chỉnh sửa cấu trúc đường/vùng</Typography>
        <Typography sx={{ color: '#475569', fontSize: 11, lineHeight: 1.45 }}>Chọn đỉnh trên bản đồ hoặc trong danh sách. Ctrl+Z để hoàn tác cả thao tác.</Typography>
      </Box>

      <Box>
        <Typography sx={{ color: '#475569', fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', mb: 0.75 }}>Đỉnh đang thao tác</Typography>
        <TextField fullWidth select label="Đỉnh của way" size="small" value={active} onChange={event => onVertex(event.target.value)} disabled={disabled}>
          <MenuItem value="">Chọn một đỉnh</MenuItem>
          {choices.map(node => <MenuItem key={node.id} value={node.id}>Node {node.id}{open && (node.id === vertices[0].id || node.id === vertices.at(-1)!.id) ? ' · endpoint' : ''}</MenuItem>)}
        </TextField>
      </Box>

      <Box>
        <Typography sx={{ color: '#475569', fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', mb: 0.75 }}>Hình dạng</Typography>
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.75 }}>
          <Button size="small" variant="outlined" disabled={disabled} onClick={() => onAction('reverse')}>Đảo chiều</Button>
          {open
            ? <Button size="small" variant="outlined" disabled={disabled} onClick={() => onAction('close')}>Đóng thành vùng</Button>
            : <Button size="small" variant="outlined" disabled={disabled} onClick={() => onAction('open')}>Mở thành đường</Button>}
        </Stack>
      </Box>

      <Box>
        <Typography sx={{ color: '#475569', fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', mb: 0.75 }}>Đỉnh</Typography>
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.75 }}>
          <Button size="small" variant="outlined" disabled={disabled || !active || !open || endpoint} onClick={() => onAction('split')}>Tách way</Button>
          <Button size="small" color="error" variant="outlined" disabled={disabled || !active} onClick={() => onAction('remove-vertex')}>Xóa đỉnh khỏi way</Button>
          <Button size="small" variant="outlined" disabled={disabled || !active} onClick={() => onAction('disconnect')}>Tách node khỏi way</Button>
          <Button size="small" variant="outlined" disabled={disabled || !endpoint} onClick={onContinue}>Tiếp tục từ endpoint</Button>
        </Stack>
        <Typography sx={{ mt: 0.9, color: '#64748b', fontSize: 10.5, lineHeight: 1.45 }}>Tách node tạo node mới cùng vị trí cho way này. Xóa đỉnh chỉ bỏ liên kết trong way, giữ node cho các đối tượng khác.</Typography>
      </Box>

      <Box sx={{ pt: 1.5, borderTop: '1px solid #e2e8f0' }}>
        <Typography sx={{ color: '#475569', fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', mb: 0.75 }}>Nối way</Typography>
        <Stack spacing={1}>
          <TextField fullWidth select label="Way nối tại endpoint" size="small" value={mergeTarget} disabled={disabled || !candidates.length} onChange={event => setMergeId(event.target.value)}>
          <MenuItem value="">Chọn way để nối</MenuItem>
          {candidates.map(candidate => <MenuItem key={candidate.properties.entityId} value={candidate.properties.entityId}>{candidate.properties.tags.name || 'Way'} #{candidate.properties.entityId}</MenuItem>)}
          </TextField>
          <Button size="small" variant="outlined" disabled={disabled || !mergeTarget} onClick={() => onAction('merge', mergeTarget)}>Nối vào way đang chọn</Button>
        </Stack>
      </Box>
    </Box>
  );
});
