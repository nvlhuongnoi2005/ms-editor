import { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, CircularProgress, IconButton, Paper, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { ExternalLink, Layers3, Map, RotateCcw, Sun, Sunset, Moon } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

type Theme = 'day' | 'dusk' | 'night';

const demoCamera = { center: [-124.65282810021182, 43.370472065363344] as [number, number], zoom: 12.195893377590188 };

maplibregl.setWorkerUrl(mapLibreWorkerUrl);

const themes: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: 'day', label: 'Ngày', icon: Sun },
  { value: 'dusk', label: 'Chạng vạng', icon: Sunset },
  { value: 'night', label: 'Đêm', icon: Moon }
];

function navigateToOSM() {
  window.location.assign(window.location.pathname);
}

export function EncPreview() {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [theme, setTheme] = useState<Theme>('day');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      center: demoCamera.center,
      zoom: demoCamera.zoom,
      style: { version: 8, sources: {}, layers: [{ id: 'base', type: 'background', paint: { 'background-color': '#93AEBB' } }] }
    });
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    instance.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const controller = new AbortController();
    setState('loading');
    fetch(`/enc/demo/style/${theme}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('preview style request failed');
        return response.json() as Promise<StyleSpecification>;
      })
      .then(style => {
        if (controller.signal.aborted) return;
        instance.setStyle(style);
        instance.once('style.load', () => setState('ready'));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [theme, reload]);

  const selectedTheme = themes.find(item => item.value === theme)!;
  const SelectedIcon = selectedTheme.icon;

  return (
    <Box sx={{ height: '100dvh', display: 'grid', gridTemplateRows: '56px minmax(0, 1fr)', bgcolor: '#edf0f3' }}>
      <Box component="header" sx={{ px: { xs: 1.25, sm: 2 }, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: '#7d172a', color: '#fff', boxShadow: '0 2px 10px rgba(70, 12, 26, 0.25)' }}>
        <Stack direction="row" sx={{ minWidth: 0, alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,.36)', borderRadius: 1.25 }}><Layers3 size={18} /></Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap' }}>ENC Preview</Typography>
            <Typography sx={{ display: { xs: 'none', sm: 'block' }, fontSize: 11, color: 'rgba(255,255,255,.76)' }}>S-57 presentation sandbox</Typography>
          </Box>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Button onClick={navigateToOSM} color="inherit" startIcon={<Map size={16} />} sx={{ display: { xs: 'none', sm: 'inline-flex' }, border: '1px solid rgba(255,255,255,.35)', color: '#fff', '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255,255,255,.1)' } }}>OSM Editor</Button>
      </Box>

      <Box sx={{ position: 'relative', minHeight: 0 }}>
        <Box ref={container} sx={{ position: 'absolute', inset: 0 }} />
        <Paper component="aside" elevation={0} sx={{ position: 'absolute', top: 16, left: 16, width: 'min(356px, calc(100% - 32px))', p: 1.5, border: '1px solid #d8e0e8', borderRadius: 2, boxShadow: '0 12px 30px rgba(70, 12, 26, .20)' }}>
          <Stack spacing={1.25}>
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>Xem ENC trước khi import</Typography>
              <Typography sx={{ mt: .4, fontSize: 12, lineHeight: 1.45, color: '#526173' }}>Bản xem thử dùng vector tile công khai của OpenENC, với sprite ngày, chạng vạng và đêm được phục vụ từ folder <code>ENC/sprites</code> của dự án.</Typography>
            </Box>
            <ToggleButtonGroup exclusive value={theme} size="small" onChange={(_, value: Theme | null) => value && setTheme(value)} aria-label="Chế độ màu ENC" sx={{ width: '100%', '& .MuiToggleButton-root': { flex: 1, gap: .65, fontSize: 11.5, textTransform: 'none' } }}>
              {themes.map(item => { const Icon = item.icon; return <ToggleButton key={item.value} value={item.value}><Icon size={15} />{item.label}</ToggleButton>; })}
            </ToggleButtonGroup>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Chip icon={state === 'loading' ? <CircularProgress size={13} /> : <SelectedIcon size={14} />} label={state === 'loading' ? 'Đang tải style' : state === 'ready' ? `Palette ${selectedTheme.label.toLowerCase()}` : 'Không tải được preview'} color={state === 'error' ? 'error' : 'default'} size="small" sx={{ maxWidth: 210, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }} />
              <Tooltip title="Về vị trí mẫu"><IconButton size="small" onClick={() => map.current?.flyTo({ ...demoCamera, essential: false })} aria-label="Về vị trí ENC mẫu"><RotateCcw size={16} /></IconButton></Tooltip>
            </Stack>
            {state === 'error' && <Button size="small" variant="outlined" onClick={() => setReload(value => value + 1)} startIcon={<ExternalLink size={14} />}>Thử tải lại</Button>}
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
