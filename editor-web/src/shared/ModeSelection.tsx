import { Box, ButtonBase, CssBaseline, Paper, Stack, Typography } from '@mui/material';
import { ArrowRight, Crosshair } from 'lucide-react';

const modes = [
  { id: 'osm', title: 'OSM', description: 'Biên tập bản đồ', detail: 'Xem, chỉnh sửa đối tượng và quản lý dữ liệu OpenStreetMap.', format: '.osm.pbf' },
  { id: 'enc', title: 'ENC', description: 'Xem hải đồ', detail: 'Import S-57, chọn cell và xem hải đồ theo chế độ màu.', format: 'ZIP S-57' }
] as const;

export function ModeSelection() {
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', color: 'text.primary' }}>
      <CssBaseline />
      <Box component="header" sx={{ height: 56, px: { xs: 2, sm: 3 }, display: 'flex', alignItems: 'center', gap: 1.25, bgcolor: '#7a1426', color: '#fff' }}>
        <Crosshair size={21} aria-hidden="true" />
        <Typography sx={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.5 }}>GEODATA WEBGIS</Typography>
      </Box>
      <Box component="main" sx={{ maxWidth: 800, mx: 'auto', px: { xs: 2, sm: 3 }, pt: { xs: 5, sm: 9 }, pb: 5 }}>
        <Typography component="h1" sx={{ fontSize: { xs: 24, sm: 30 }, fontWeight: 800, letterSpacing: '-0.5px', lineHeight: 1.25 }}>Chọn chế độ làm việc</Typography>
        <Typography sx={{ mt: 1.25, mb: 3.5, fontSize: 14, color: 'text.secondary' }}>Mở dữ liệu bản đồ OSM hoặc hải đồ ENC.</Typography>
        <Paper component="nav" aria-label="Chế độ bản đồ" variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2 }}>
          {modes.map((mode, index) => (
            <ButtonBase key={mode.id} component="a" href={`?mode=${mode.id}`} aria-label={`Mở chế độ ${mode.title}`} sx={{
              display: 'flex', width: '100%', textAlign: 'left', justifyContent: 'space-between', gap: 2,
              px: { xs: 2.5, sm: 3 }, py: 3, color: 'inherit', textDecoration: 'none',
              borderTop: index ? '1px solid' : 'none', borderColor: 'divider',
              '&:hover': { bgcolor: '#faf4f5' },
              '&:focus-visible': { outline: '3px solid #a51f38', outlineOffset: '-3px' }
            }}>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
                  <Typography component="h2" sx={{ fontSize: 20, fontWeight: 800, color: 'primary.dark' }}>{mode.title}</Typography>
                  <Typography sx={{ fontSize: 14, fontWeight: 650 }}>{mode.description}</Typography>
                </Stack>
                <Typography sx={{ mt: 0.75, fontSize: 13, color: 'text.secondary', lineHeight: 1.6 }}>{mode.detail}</Typography>
                <Typography sx={{ mt: 1, fontSize: 12, color: 'text.secondary' }}>Định dạng: {mode.format}</Typography>
              </Box>
              <ArrowRight size={21} color="#a51f38" aria-hidden="true" style={{ flexShrink: 0 }} />
            </ButtonBase>
          ))}
        </Paper>
      </Box>
    </Box>
  );
}
