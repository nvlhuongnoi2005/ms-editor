import { useState } from 'react';
import { Box, Button, Divider, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import { Check, ChevronDown, Layers3, Map, Waves } from 'lucide-react';

type Props = { mode?: 'osm' | 'enc'; disabled?: boolean };

export function WorkspaceNavigation({ mode, disabled = false }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <Box className="workspace-navigation">
    <Box className="workspace-brand" aria-label="Geodata WebGIS">G<Box component="span" className="workspace-brand-name">GEODATA</Box></Box>
    {mode && <>
      <Button id="workspace-mode-button" className="workspace-mode-button" disabled={disabled}
        aria-label="Chọn không gian làm việc" aria-haspopup="menu" aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? 'workspace-mode-menu' : undefined} onClick={event => setAnchor(event.currentTarget)}
        startIcon={mode === 'osm' ? <Map size={17} /> : <Waves size={17} />} endIcon={<ChevronDown size={14} />}>
        {mode === 'osm' ? 'OSM' : 'ENC'}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        slotProps={{ list: { id: 'workspace-mode-menu', 'aria-labelledby': 'workspace-mode-button' }, paper: { sx: { minWidth: 264 } } }}>
        <MenuItem component="a" href="?mode=osm" selected={mode === 'osm'} aria-current={mode === 'osm' ? 'page' : undefined} onClick={event => { if (mode === 'osm') event.preventDefault(); setAnchor(null); }}>
          <ListItemIcon><Map size={18} /></ListItemIcon><ListItemText primary="OSM · Biên tập bản đồ" secondary="Đối tượng, thuộc tính và topology" />{mode === 'osm' && <Check size={16} />}
        </MenuItem>
        <MenuItem component="a" href="?mode=enc" selected={mode === 'enc'} aria-current={mode === 'enc' ? 'page' : undefined} onClick={event => { if (mode === 'enc') event.preventDefault(); setAnchor(null); }}>
          <ListItemIcon><Waves size={18} /></ListItemIcon><ListItemText primary="ENC · Xem hải đồ" secondary="Hải đồ S-57 và độ sâu" />{mode === 'enc' && <Check size={16} />}
        </MenuItem>
        <Divider />
        <MenuItem component="a" href={location.pathname}><ListItemIcon><Layers3 size={18} /></ListItemIcon>Trang chọn chế độ</MenuItem>
      </Menu>
    </>}
  </Box>;
}
