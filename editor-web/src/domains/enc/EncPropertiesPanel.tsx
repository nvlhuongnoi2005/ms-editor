import { Box, Button, IconButton, Paper, Typography } from '@mui/material';
import { X } from 'lucide-react';

type Props = {
  properties: Record<string, unknown>;
  onClose: () => void;
  onFitBounds: (bounds: [number, number, number, number]) => void;
};

const displayValue = (value: unknown): string => {
  if (value == null || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

export function EncPropertiesPanel({ properties, onClose, onFitBounds }: Props) {
  const region = properties.kind === 'region' || properties.kind === 'label';
  const title = displayValue(properties.object_class ?? properties.name ?? 'Đối tượng ENC');
  const entries = region
    ? [
      ['Tên vùng', properties.description],
      ['Edition', properties.edition],
      ['Update', properties.updateNumber],
      ['Tỷ lệ biên tập', properties.compilationScale == null ? null : `1:${Number(properties.compilationScale).toLocaleString('vi-VN')}`],
      ['File nguồn', properties.sourceFilename],
      ['Nhà sản xuất', properties.producer],
      ['Revision', properties.revisionId],
    ]
    : Object.entries(properties).filter(([key]) => !['feature_id', 'object_class', 'topmark_floating'].includes(key) && !key.startsWith('sym_') && !key.startsWith('list_'));
  let bounds: [number, number, number, number] | undefined;
  if (region) {
    try {
      const value: unknown = typeof properties.bounds === 'string' ? JSON.parse(properties.bounds) : properties.bounds;
      if (Array.isArray(value) && value.length === 4 && value.every(item => typeof item === 'number' && Number.isFinite(item))) {
        bounds = value as [number, number, number, number];
      }
    } catch { /* External sources may omit valid coverage bounds. */ }
  }

  return <Paper component="section" role="region" aria-labelledby="enc-properties-title" className="enc-properties" elevation={0}>
    <Box className="enc-properties-header">
      <Box>
        <Typography component="h2" id="enc-properties-title">{region ? 'Thông tin hải đồ' : 'Thuộc tính đối tượng'}</Typography>
        <Typography component="h3" className="enc-properties-name">{title}</Typography>
        {!region && properties.cell_name != null && <Typography className="enc-properties-cell">Cell · {displayValue(properties.cell_name)}</Typography>}
      </Box>
      <IconButton aria-label="Đóng bảng thuộc tính" onClick={onClose}><X size={20} /></IconButton>
    </Box>
    <Box className="enc-properties-body">
      <Box component="dl" className="enc-properties-list">
        {entries.map(([key, value]) => <Box component="div" key={String(key)} className="enc-properties-row">
          <Box component="dt">{String(key)}</Box>
          <Box component="dd">{displayValue(value)}</Box>
        </Box>)}
      </Box>
      {region && <Typography className="enc-properties-note">Tên vùng lấy từ catalog ENC đã import. Đường biên thể hiện vùng phủ của cell trong dữ liệu nguồn.</Typography>}
      {bounds && <Button variant="outlined" fullWidth onClick={() => onFitBounds(bounds!)}>Xem phạm vi hải đồ</Button>}
    </Box>
  </Paper>;
}
