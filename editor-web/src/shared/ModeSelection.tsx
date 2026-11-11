import { Box, ButtonBase, CssBaseline, Typography } from '@mui/material';
import { ArrowRight } from 'lucide-react';
import { WorkspaceNavigation } from './WorkspaceNavigation';

const modes = [
  { id:'osm', title:'Biên tập bản đồ', detail:'Tạo và chỉnh sửa đối tượng, thuộc tính, quan hệ và topology trên bản đồ OSM.', format:'.osm.pbf · Có thể chỉnh sửa' },
  { id:'enc', title:'Xem hải đồ', detail:'Ghép hải đồ S-57 đã nhập, xem độ sâu, ký hiệu hàng hải và thuộc tính đối tượng.', format:'ZIP S-57 · Chỉ xem' },
] as const;

export function ModeSelection() {
  return <Box className="mode-selection">
    <CssBaseline />
    <Box component="header" className="workspace-header"><WorkspaceNavigation /></Box>
    <Box component="main" className="mode-selection-main">
      <Typography component="h1">Chọn không gian<br />làm việc của bạn.</Typography>
      <p className="mode-introduction">Một nơi quản lý dữ liệu địa lý. Chọn công việc bạn muốn thực hiện để mở bản đồ.</p>
      <Box component="nav" className="mode-choices" aria-label="Chế độ bản đồ">
        {modes.map(mode => <ButtonBase key={mode.id} component="a" href={`?mode=${mode.id}`} className="mode-choice" aria-label={`Mở chế độ ${mode.id.toUpperCase()}`}>
          <span className="mode-choice-code">{mode.id.toUpperCase()}</span>
          <Box><Typography component="h2">{mode.title}</Typography><p>{mode.detail}</p><p className="mode-choice-format">{mode.format}</p></Box>
          <ArrowRight size={22} aria-hidden="true" />
        </ButtonBase>)}
      </Box>
      <p className="mode-selection-note">Bạn có thể chuyển giữa OSM và ENC từ menu không gian làm việc trên thanh đầu trang.</p>
    </Box>
  </Box>;
}
