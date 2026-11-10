import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, CssBaseline, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, MenuItem, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { Layers3, Map, RotateCcw, Sun, Sunset, Moon, Trash2, Upload, X } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './enc-workspace.css';
import { localEncStyle, type EncTheme } from './style';
import { EncImportDialog } from './EncImportDialog';
import { EncPropertiesPanel } from './EncPropertiesPanel';
import type { EncImport } from './imports';

type Bounds = [number, number, number, number];
type Dataset = EncImport;
type Cell = { name: string; edition: number | null; updateNumber: number; bounds: Bounds | null; description?: string; revisionId?: string; producer?: string; focus?: [number, number] | null };
const demoCamera = { center: [-124.65282810021182, 43.370472065363344] as [number, number], zoom: 12.195893377590188 };
// Match the metric scale control (120 px): a 150 m span rounds to a 100 m bar.
const initialScaleSpanMeters = 150;
const themes = [{ value: 'day', label: 'Ngày', icon: Sun }, { value: 'dusk', label: 'Chạng vạng', icon: Sunset }, { value: 'night', label: 'Đêm', icon: Moon }] as const;
maplibregl.setWorkerUrl(mapLibreWorkerUrl);

async function readJSON<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không tải được dữ liệu ENC.');
  return data as T;
}

export function EncPreview() {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [theme, setTheme] = useState<EncTheme>('day');
  const [source, setSource] = useState('local');
  const [importOpen, setImportOpen] = useState(false);
  const [camera, setCamera] = useState({ longitude: demoCamera.center[0], latitude: demoCamera.center[1], zoom: demoCamera.zoom });
  const [panelOpen, setPanelOpen] = useState(() => innerWidth > 700);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetId, setDatasetId] = useState(new URLSearchParams(location.search).get('dataset') || '');
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [lastImportId, setLastImportId] = useState('');
  const initialCameraKey = useRef('');
  const cellScope = useRef(datasetId);
  const [cells, setCells] = useState<Cell[]>([]);
  const [cellName, setCellName] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('empty');
  const [error, setError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [reload, setReload] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteNotice, setDeleteNotice] = useState('');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const dataset = datasets.find(item => item.id === datasetId);
  const importSummary = dataset ?? datasets.find(item => item.id === lastImportId);
  const cell = cells.find(item => item.name === cellName);
  const visibleCell = cell ?? cells.filter(item => item.bounds && camera.longitude >= item.bounds[0] && camera.longitude <= item.bounds[2] && camera.latitude >= item.bounds[1] && camera.latitude <= item.bounds[3]).reduce<Cell | undefined>((best, item) => !best || (item.bounds![2]-item.bounds![0])*(item.bounds![3]-item.bounds![1]) < (best.bounds![2]-best.bounds![0])*(best.bounds![3]-best.bounds![1]) ? item : best, undefined);
  const position = (value: number, positive: string, negative: string) => `${Math.floor(Math.abs(value))}°${((Math.abs(value) % 1) * 60).toFixed(2).padStart(5,'0')}′${value < 0 ? negative : positive}`;

  useEffect(() => {
    if (!selected || importOpen || deleteTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selected, importOpen, deleteTarget]);

  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({ container: container.current, ...demoCamera, style: { version: 8, sources: {}, layers: [{ id: 'base', type: 'background', paint: { 'background-color': '#93AEBB' } }] } });
    const updateCamera = () => { const center = instance.getCenter(); setCamera({ longitude: center.lng, latitude: center.lat, zoom: instance.getZoom() }); };
    instance.on('moveend', updateCamera);
    instance.addControl(new maplibregl.NavigationControl(), 'top-right');
    instance.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');
    const canvas = instance.getCanvas();
    const resetCursor = () => { canvas.style.cursor = ''; };
    const featureAt = (point: maplibregl.Point) => {
      if (!instance.isStyleLoaded()) return undefined;
      const features = instance.queryRenderedFeatures([[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]]);
      return features.find(item => item.source === 'enc' && ['enc', 'enc_symbols'].includes(item.sourceLayer ?? ''))
        ?? features.find(item => item.source === 'regions');
    };
    instance.on('mousemove', event => {
      canvas.style.cursor = !instance.isMoving() && featureAt(event.point) ? 'pointer' : '';
    });
    instance.on('movestart', resetCursor);
    instance.on('style.load', resetCursor);
    canvas.addEventListener('mouseleave', resetCursor);
    instance.on('click', event => {
      if (!instance.isStyleLoaded()) return;
      const feature = featureAt(event.point);
      setSelected(feature?.properties ?? null);
      if (feature && innerWidth <= 700) setPanelOpen(false);
    });
    map.current = instance;
    return () => { canvas.removeEventListener('mouseleave', resetCursor); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    map.current?.setPadding({ left: panelOpen && innerWidth > 700 ? 354 : 30, right: 60, top: panelOpen && innerWidth <= 700 ? 260 : 40, bottom: 40 });
  }, [panelOpen]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await fetch('/api/enc/datasets', { signal: controller.signal }).then(readJSON<{ datasets: Dataset[]; catalogRevision: number }>);
        if (controller.signal.aborted) return;
        setDatasets(data.datasets); setCatalogError('');
        setCatalogRevision(data.catalogRevision);
        setDatasetId(current => current && !data.datasets.some(item => item.id === current) ? '' : current);
        timer = setTimeout(load, data.datasets.some(item => item.state === 'importing') ? 3000 : 10000);
      } catch (reason) { if (!controller.signal.aborted) setCatalogError(reason instanceof Error ? reason.message : String(reason)); }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [reload]);

  useEffect(() => {
    if (datasetId && dataset?.state !== 'ready') { setCells([]); setCellName(''); return; }
    const controller = new AbortController();
    if (cellScope.current !== datasetId) {
      setCells([]); setCellName(''); cellScope.current = datasetId;
    }
    fetch(`/api/enc/cells?${new URLSearchParams({ dataset: datasetId })}`, { signal: controller.signal }).then(readJSON<{ cells: Cell[] }>).then(data => {
      if (controller.signal.aborted) return;
      setCells(data.cells);
      setCellName(current => data.cells.some(item => item.name === current) ? current : '');
    }).catch(reason => { if (!controller.signal.aborted) setCatalogError(reason.message); });
    return () => controller.abort();
  }, [datasetId, dataset?.state, catalogRevision, reload]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const controller = new AbortController();
    setSelected(null); setError('');
    instance.getCanvas().style.cursor = '';
    let failed = false;
    const idle = () => { if (!controller.signal.aborted && !failed) setState('ready'); };
    const failure = (event: maplibregl.ErrorEvent) => { if (!controller.signal.aborted) { failed = true; setState('error'); setError(event.error.message); } };
    instance.on('error', failure);
    if (source === 'local' && ((datasetId && dataset?.state !== 'ready') || !cells.length)) {
      setState('empty');
      instance.setStyle(localEncStyle('', '', theme, catalogRevision, true));
    } else {
      setState('loading');
      const load = async () => {
        try {
          const style = source === 'local' ? localEncStyle(datasetId, cellName, theme, catalogRevision) : await fetch(`/enc/demo/style/${theme}`, { signal: controller.signal }).then(readJSON<StyleSpecification>);
          if (controller.signal.aborted) return;
          if (typeof style.sprite === 'string') style.sprite = new URL(style.sprite, location.origin).href;
          instance.once('idle', idle);
          instance.setStyle(style);
        } catch (reason) { if (!controller.signal.aborted) { setState('error'); setError(reason instanceof Error ? reason.message : String(reason)); } }
      };
      void load();
    }
    return () => { controller.abort(); instance.off('idle', idle); instance.off('error', failure); };
  }, [theme, source, datasetId, dataset?.state, cellName, cells.length, reload, catalogRevision]);

  const fit = () => {
    const allBounds = cells.reduce<Bounds | null>((bounds, item) => !item.bounds ? bounds : !bounds ? [...item.bounds] : [Math.min(bounds[0],item.bounds[0]),Math.min(bounds[1],item.bounds[1]),Math.max(bounds[2],item.bounds[2]),Math.max(bounds[3],item.bounds[3])], null);
    const bounds = cell?.bounds ?? dataset?.bounds ?? allBounds;
    if (source === 'local' && bounds) map.current?.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: { left: panelOpen && innerWidth > 700 ? 354 : 30, right: 60, top: panelOpen && innerWidth <= 700 ? 260 : 40, bottom: 40 }, maxZoom: 15, duration: 0 });
    else map.current?.jumpTo(demoCamera);
  };
  useEffect(() => {
    if (source !== 'local') { initialCameraKey.current = ''; map.current?.jumpTo(demoCamera); return; }
    const cameraKey = `${source}:${datasetId}:${cellName}`;
    if (initialCameraKey.current === cameraKey) return;
    // Start in a compact cell rather than fitting a potentially worldwide ZIP.
    // The source still includes every cell; this only chooses the initial camera.
    const area = (bounds: Bounds) => (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
    const waterCells = cells.filter(item => item.bounds && item.focus);
    const initialCell = cell ?? (waterCells.length ? waterCells : cells.filter(item => item.bounds)).reduce<Cell | undefined>(
      (best, item) => !best || area(item.bounds!) < area(best.bounds!) ? item : best, undefined);
    const bounds = initialCell?.bounds;
    if (!bounds) return;
    initialCameraKey.current = cameraKey;
    const focus = initialCell?.focus ?? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    const latitude = Math.max(-85, Math.min(85, focus[1]));
    const zoom = Math.log2(40075016.6856 * Math.cos(latitude * Math.PI / 180) * 120 / (512 * initialScaleSpanMeters));
    map.current?.jumpTo({
      center: [focus[0], latitude],
      zoom,
      padding: { left: panelOpen && innerWidth > 700 ? 354 : 30, right: 60, top: panelOpen && innerWidth <= 700 ? 260 : 40, bottom: 40 }
    });
  }, [cellName, datasetId, source, cells]);

  const deleteDataset = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true); setDeleteError(''); setDeleteNotice('');
    try {
      const result = await fetch(`/api/enc/datasets/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
        headers: { 'X-Editor-Import': '1' }
      }).then(readJSON<{ warning?: string }>);
      setDatasets(current => current.filter(item => item.id !== deleteTarget.id));
      if (datasetId === deleteTarget.id) {
        setDatasetId(''); setCells([]); setCellName(''); setSelected(null);
        const url = new URL(location.href); url.searchParams.delete('dataset');
        history.replaceState(null, '', url);
      }
      setDeleteNotice(result.warning || 'Đã xóa lần nhập. Các cell dùng chung được giữ lại.');
      setDeleteTarget(null); setReload(value => value + 1);
    } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeleting(false); }
  };

  return (
    <Box className="enc-workspace" sx={{ height: '100dvh', display: 'grid', gridTemplateRows: '60px minmax(0,1fr) 32px', bgcolor: '#f5f2e9' }}>
      <CssBaseline />
      {importOpen && <EncImportDialog datasets={datasets} error={catalogError}
        onClose={() => setImportOpen(false)} onRefresh={() => setReload(value => value + 1)}
        onImported={id => { setLastImportId(id); setSource('local'); setDatasetId(''); }}
        onView={id => { setDatasetId(id); setSource('local'); setImportOpen(false); setPanelOpen(true); }}
        onDelete={item => { setDeleteTarget(item); setDeleteError(''); setDeleteNotice(''); }} />}
      <Dialog open={deleteTarget !== null} onClose={() => { if (!deleting) setDeleteTarget(null); }} aria-labelledby="enc-delete-title" aria-describedby="enc-delete-description" fullWidth maxWidth="xs">
        <DialogTitle id="enc-delete-title">Xóa dataset ENC?</DialogTitle>
        <DialogContent>
          <DialogContentText id="enc-delete-description">Xóa lần nhập “{deleteTarget?.name}” và ZIP upload. Phiên bản cell còn được lần nhập khác sử dụng sẽ được giữ lại. Bản đồ chung sẽ tự chọn lại phiên bản còn hợp lệ.</DialogContentText>
          {deleteError && <Alert severity="error">{deleteError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button disabled={deleting} onClick={() => setDeleteTarget(null)}>Hủy</Button>
          <Button color="error" variant="contained" disabled={deleting} onClick={() => void deleteDataset()} startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <Trash2 size={16} />}>{deleting ? 'Đang xóa…' : 'Xóa vĩnh viễn'}</Button>
        </DialogActions>
      </Dialog>
      <Box component="header" className="enc-masthead" sx={{ px: 2, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: '#7d172a', color: '#fff' }}>
        <Box className="enc-mark" aria-hidden="true">ENC</Box><Typography component="h1" sx={{ fontSize: 17, fontWeight: 800 }}>Hải đồ</Typography>
        <Typography sx={{ display: { xs: 'none', sm: 'block' }, fontSize: 11, color: '#626a63', borderLeft: '1px solid #d4d3c8', pl: 1.5 }}>Chỉ xem</Typography><Box sx={{ flex: 1 }} />
        <Button onClick={() => setImportOpen(true)} startIcon={<Upload size={16} />}><Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Dữ liệu / Import ENC</Box><Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>Import</Box></Button>
        <Button href={location.pathname} color="inherit" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>Chọn chế độ</Button>
        <Button href="?mode=osm" color="inherit" startIcon={<Map size={16} />}>OSM Editor</Button>
      </Box>
      <Box sx={{ minHeight: 0, position: 'relative' }}>
        <Box ref={container} sx={{ position: 'absolute', inset: 0 }} />
        {panelOpen ? <Paper component="aside" className="enc-sidebar" elevation={0} sx={{ position: 'absolute', top: 16, left: 16, width: 'min(350px,calc(100% - 76px))', maxHeight: 'calc(100% - 55px)', overflowY: 'auto', p: 1.5, borderRadius: 2, boxShadow: '0 12px 30px rgba(70,12,26,.20)' }}>
          <Stack spacing={1.5}>
            <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}><Typography component="h2" className="enc-chart-title">{source === 'demo' ? 'OpenENC' : visibleCell?.description || visibleCell?.name || 'Danh mục hải đồ'}</Typography>
                <Typography className="enc-chart-id" sx={{ mt: 1 }}>{source === 'demo' ? 'Dữ liệu trực tuyến' : visibleCell ? `${visibleCell.name} · E${visibleCell.edition ?? '?'} / U${visibleCell.updateNumber}` : `${cells.length} cell đã công bố`}</Typography>
              </Box>
              <IconButton onClick={() => setPanelOpen(false)} aria-label="Thu gọn bảng hải đồ" size="small"><X size={16} /></IconButton>
            </Stack>
            <Box className="enc-tabs">
              <Button aria-current="page">Hải đồ</Button>
              <Button onClick={() => setImportOpen(true)}>Nhập dữ liệu</Button>
            </Box>
            <Box><Stack spacing={1.5}>
            <TextField select label="Nguồn hải đồ" size="small" value={source} onChange={event => setSource(event.target.value)}>
              <MenuItem value="local">ENC đã import</MenuItem><MenuItem value="demo">OpenENC demo (online)</MenuItem>
            </TextField>
            {source === 'local' && <>
              {catalogError && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setReload(value => value + 1)}>Tải lại</Button>}>{catalogError}</Alert>}
              <TextField select label="Lọc theo lần nhập" size="small" slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} value={datasets.some(item => item.id === datasetId) ? datasetId : ''} onChange={event => setDatasetId(event.target.value)}>
                <MenuItem value="">Tất cả hải đồ đã công bố</MenuItem>
                {datasets.map(item => <MenuItem key={item.id} value={item.id}>{item.name} · {item.state === 'ready' ? 'Sẵn sàng' : item.state === 'failed' ? 'Import lỗi' : 'Đang import'}</MenuItem>)}
              </TextField>
              {dataset && <Button color="error" variant="outlined" startIcon={<Trash2 size={16} />} disabled={dataset.state === 'importing' || deleting} onClick={() => { setDeleteTarget(dataset); setDeleteError(''); setDeleteNotice(''); }}>Xóa dataset{dataset.state === 'failed' ? ' import lỗi' : ''}</Button>}
              {deleteNotice && <Alert severity="info" onClose={() => setDeleteNotice('')}>{deleteNotice}</Alert>}
              {dataset?.state === 'importing' && <Alert severity="info" icon={<CircularProgress size={18} />}>Worker đang xử lý ZIP. Dữ liệu sẽ xuất hiện khi import hoàn tất. Có thể xóa dataset sau khi xử lý xong.</Alert>}
              {dataset?.state === 'failed' && <Alert severity="error">{dataset.error || 'Import thất bại.'}</Alert>}
              {!datasetId && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{cells.length} cell đang công bố · tự động ghép từ các lần nhập</Typography>}
              {importSummary?.state === 'ready' && importSummary.outcomes && <Alert severity={importSummary.outcomes.conflict ? 'warning' : 'success'}>{importSummary.name}: {importSummary.outcomes.imported ?? 0} cell đã nhập, {importSummary.outcomes.duplicate ?? 0} cell trùng, {importSummary.outcomes.older ?? 0} bản cũ, {importSummary.outcomes.conflict ?? 0} xung đột. Cell xung đột không tự công bố.</Alert>}
              {lastImportId && datasets.find(item => item.id === lastImportId)?.state === 'importing' && <Alert severity="info" icon={<CircularProgress size={18} />}>Đang nhập ZIP mới. Bản đồ chung vẫn hiển thị hải đồ đã công bố.</Alert>}
              {lastImportId && datasets.find(item => item.id === lastImportId)?.state === 'failed' && <Alert severity="error">{datasets.find(item => item.id === lastImportId)?.error || 'Lần nhập mới thất bại.'}</Alert>}
              {cells.length > 0 && <TextField select label="Phạm vi hiển thị" size="small" slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} value={cellName} onChange={event => setCellName(event.target.value)}><MenuItem value="">Tất cả cell · tự động</MenuItem>{cells.map(item => <MenuItem key={item.revisionId ?? item.name} value={item.name}>{item.description || item.name} · {item.name}</MenuItem>)}</TextField>}
              {dataset?.state === 'ready' && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{cells.length} cell · {dataset.featureCount.toLocaleString('vi-VN')} feature</Typography>}
              {!datasets.length && !catalogError && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Chưa có ENC. Tải lên ZIP gồm cell .000 và các update đi kèm, hoặc chọn OpenENC demo.</Typography>}
            </>}
            {source === 'demo' && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Dữ liệu mẫu trực tuyến từ OpenENC. Chọn “ENC đã import” để xem dữ liệu của bạn.</Typography>}
            <ToggleButtonGroup exclusive value={theme} size="small" onChange={(_, value: EncTheme | null) => value && setTheme(value)} aria-label="Chế độ màu ENC" sx={{ '& .MuiToggleButton-root': { flex: 1, gap: 0.6, fontSize: 11.5, textTransform: 'none' } }}>
              {themes.map(item => { const Icon = item.icon; return <ToggleButton key={item.value} value={item.value}><Icon size={15} />{item.label}</ToggleButton>; })}
            </ToggleButtonGroup>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Độ sâu: mét · Mật độ chi tiết tự điều chỉnh theo mức zoom</Typography>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography role="status" aria-live="polite" sx={{ fontSize: 12, color: state === 'error' ? 'error.main' : 'text.secondary' }}>{state === 'loading' ? 'Đang tải hải đồ…' : state === 'ready' ? 'Hải đồ sẵn sàng' : state === 'empty' ? 'Chọn dữ liệu để xem' : 'Không tải được hải đồ'}</Typography>
              <Tooltip title="Về phạm vi cell"><IconButton onClick={fit} size="small" aria-label="Về phạm vi cell"><RotateCcw size={16} /></IconButton></Tooltip>
            </Stack>
            {error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setReload(value => value + 1)}>Thử lại</Button>}>{error}</Alert>}
            </Stack></Box>

          </Stack>
        </Paper> : <Paper className="enc-collapsed" elevation={0} sx={{ position: 'absolute', top: 16, left: 16, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}><Button sx={{ minHeight: 44 }} startIcon={<Layers3 size={18} />} onClick={() => setPanelOpen(true)} aria-label="Mở bảng hiển thị hải đồ">Hiển thị hải đồ</Button></Paper>}
        {selected && <EncPropertiesPanel properties={selected} onClose={() => setSelected(null)} onFitBounds={bounds => {
          map.current?.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
            padding: { left: panelOpen && innerWidth > 700 ? 354 : 30, right: innerWidth > 700 ? 420 : 30, top: panelOpen && innerWidth <= 700 ? 260 : 40, bottom: innerWidth <= 700 ? Math.round(innerHeight * 0.46) : 40 }, duration: 500,
          });
        }} />}
      </Box>
      <Box component="footer" className="enc-footline">
        <span className="enc-position">{position(camera.latitude,'N','S')} · {position(camera.longitude,'E','W')}</span>
        <span>Zoom {camera.zoom.toFixed(1)}</span>
        <span className="enc-foot-extra">Độ sâu · mét</span>
        <span className="enc-foot-status">{state === 'loading' ? 'Đang tải' : state === 'error' ? 'Lỗi dữ liệu' : source === 'demo' ? 'OpenENC' : `${cells.length} cell local`}</span>
      </Box>
    </Box>
  );
}
