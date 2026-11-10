import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { Layers, LockKeyhole } from 'lucide-react';
import type { GraphFeature } from '../../types/osm';
import { EDITOR_LAYERS, type EditorLayer } from './geometryLocks';

export function GeometryLocksDialog({ keys, layers, features, onClose, onUnlock }: {
  keys: readonly string[]; layers: readonly EditorLayer[]; features: readonly GraphFeature[]; onClose: () => void; onUnlock: () => void;
}) {
  const names = new Map(features.map(feature => [`${feature.properties.entityType}/${feature.properties.entityId}`, feature.properties.tags.name]));
  return <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="geometry-locks-title" scroll="paper">
    <DialogTitle id="geometry-locks-title" sx={{ fontSize: 18, fontWeight: 800 }}>Khóa biên tập</DialogTitle>
    <DialogContent dividers>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>Khóa tạm chỉ áp dụng trong phiên này. Dữ liệu vẫn hiển thị nhưng không thể chọn hoặc chỉnh sửa.</Typography>
      <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, gap: 1.5 }}>
        {layers.map(layer => <Stack component="li" key={layer} direction="row" sx={{ gap: 1.25, alignItems: 'center' }}><Layers size={18} aria-hidden="true" /><Box><Typography sx={{ fontSize: 13, fontWeight: 700 }}>Layer {EDITOR_LAYERS[layer]}</Typography><Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Bao gồm đối tượng được tải sau</Typography></Box></Stack>)}
        {keys.map(key => <Stack component="li" key={key} direction="row" sx={{ gap: 1.25, alignItems: 'center' }}><LockKeyhole size={18} aria-hidden="true" /><Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}><Typography sx={{ fontSize: 13, fontWeight: 700 }}>{names.get(key) || 'Đối tượng chưa đặt tên'}</Typography><Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: 'text.secondary' }}>{key}</Typography></Box></Stack>)}
      </Stack>
      {!keys.length && !layers.length && <Typography sx={{ fontSize: 13 }}>Không có đối tượng hoặc layer đang khóa.</Typography>}
    </DialogContent>
    <DialogActions sx={{ px: 2.5, py: 1.5 }}><Button onClick={onClose}>Đóng</Button><Button variant="contained" disabled={!keys.length && !layers.length} onClick={onUnlock}>Mở khóa tất cả</Button></DialogActions>
  </Dialog>;
}
