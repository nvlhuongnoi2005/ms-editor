import { Box, Button, IconButton, Paper, Typography } from '@mui/material';
import { X } from 'lucide-react';
import { featureSymbol, spriteStyle } from './pointSymbols';
import { encSymbols } from './symbolCatalog';
import type { EncTheme } from './style';

type Props = {
  properties: Record<string, unknown>;
  theme?: EncTheme;
  onClose: () => void;
  onFitBounds: (bounds: [number, number, number, number]) => void;
};

const displayValue = (value: unknown): string => {
  if (value == null || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

// Lead with chart information; source identifiers stay available afterwards.
const propertyOrder = ['OBJNAM','CATHAF','CATSCF','DEPTH','VALSOU','DRVAL1','DRVAL2','VALDCO','COLOUR','LITCHR','SIGPER','VALNMR','HEIGHT','WATLEV','CATLAM','CATCAM','cell_name'];

export function EncPropertiesPanel({ properties, theme = 'day', onClose, onFitBounds }: Props) {
  const region = properties.kind === 'region' || properties.kind === 'outline' || properties.kind === 'label';
  const title = displayValue(properties.object_class ?? properties.name ?? 'Đối tượng ENC');
  const symbol = region ? undefined : featureSymbol(properties);
  const info = symbol ? spriteStyle(symbol, theme, 36) : undefined;
  const description = symbol ? encSymbols.find(entry => entry.code === symbol)?.description : undefined;
  // MVT cannot carry arrays. Recover the complete ordered source codes from
  // list_* rather than displaying only sym_*'s first value (or hiding CATHAF).
  const detailProperties = {...properties};
  for (const [key,value] of Object.entries(properties)) {
    if (key.startsWith('list_') && typeof value === 'string' && value.startsWith('|') && value.endsWith('|') && !(key.slice(5) in properties)) {
      detailProperties[key.slice(5)] = value.slice(1,-1).split('|').filter(Boolean);
    }
  }
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
    : Object.entries(detailProperties)
      .filter(([key]) => !['feature_id', 'object_class', 'topmark_floating'].includes(key) && !key.startsWith('sym_') && !key.startsWith('list_') && !key.startsWith('s52_'))
      .sort(([left], [right]) => {
        const rank = (key: string) => propertyOrder.includes(key) ? propertyOrder.indexOf(key) : propertyOrder.length;
        return rank(left) - rank(right);
      });
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
      {symbol && info && <Box sx={{display:'flex',alignItems:'center',gap:2,pb:2}}>
        <Box component="span" role="img" aria-label={`Ký hiệu ${symbol}`} sx={{flexShrink:0,
          width:info.rect.width*info.ratio,height:info.rect.height*info.ratio,
          backgroundImage:`url("${info.url}")`,backgroundRepeat:'no-repeat',
          backgroundPosition:`${-info.rect.x*info.ratio}px ${-info.rect.y*info.ratio}px`,
          backgroundSize:`${info.width*info.ratio}px ${info.height*info.ratio}px`}} />
        <Box><Typography component="p" variant="body2">Ký hiệu chính · {symbol}</Typography><Typography component="p" variant="body2">{description}</Typography></Box>
      </Box>}
      <Box component="dl" className="enc-properties-list">
        {entries.map(([key, value]) => <Box component="div" key={String(key)} className="enc-properties-row">
          <Box component="dt">{String(key)}{['DEPTH','VALSOU','DRVAL1','DRVAL2','VALDCO','HEIGHT'].includes(String(key)) ? ' · m' : ''}</Box>
          <Box component="dd">{displayValue(value)}</Box>
        </Box>)}
      </Box>
      {region && <Typography className="enc-properties-note">Tên vùng lấy từ catalog ENC đã import. Đường biên thể hiện vùng phủ của cell trong dữ liệu nguồn.</Typography>}
      {bounds && <Button variant="outlined" fullWidth onClick={() => onFitBounds(bounds!)}>Xem phạm vi hải đồ</Button>}
    </Box>
  </Paper>;
}
