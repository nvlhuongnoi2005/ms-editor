import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, CssBaseline, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, MenuItem, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { Layers3, Map, RotateCcw, Sun, Sunset, Moon, Trash2, Upload, X } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { localEncStyle, type EncTheme } from './style';

type Bounds = [number, number, number, number];
type Dataset = { id: string; name: string; state: string; jobState: string; featureCount: number; error: string | null; bounds: Bounds | null };
type Cell = { name: string; edition: number | null; updateNumber: number; bounds: Bounds | null; focus?: [number, number] | null };
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
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetId, setDatasetId] = useState(new URLSearchParams(location.search).get('dataset') || '');
  const [cells, setCells] = useState<Cell[]>([]);
  const [cellName, setCellName] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('empty');
  const [error, setError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [reload, setReload] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteNotice, setDeleteNotice] = useState('');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const dataset = datasets.find(item => item.id === datasetId);
  const cell = cells.find(item => item.name === cellName);

  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({ container: container.current, ...demoCamera, style: { version: 8, sources: {}, layers: [{ id: 'base', type: 'background', paint: { 'background-color': '#93AEBB' } }] } });
    instance.addControl(new maplibregl.NavigationControl(), 'top-right');
    instance.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');
    const canvas = instance.getCanvas();
    const resetCursor = () => { canvas.style.cursor = ''; };
    const featureAt = (point: maplibregl.Point) => instance.isStyleLoaded()
      ? instance.queryRenderedFeatures(point).find(item => item.source === 'enc' && item.sourceLayer === 'enc')
      : undefined;
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
    });
    map.current = instance;
    return () => { canvas.removeEventListener('mouseleave', resetCursor); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await fetch('/api/enc/datasets', { signal: controller.signal }).then(readJSON<{ datasets: Dataset[] }>);
        if (controller.signal.aborted) return;
        setDatasets(data.datasets); setCatalogError('');
        setDatasetId(current => current || data.datasets.find(item => item.state === 'ready')?.id || '');
        if (data.datasets.some(item => item.state === 'importing')) timer = setTimeout(load, 3000);
      } catch (reason) { if (!controller.signal.aborted) setCatalogError(reason instanceof Error ? reason.message : String(reason)); }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [reload]);

  useEffect(() => {
    if (!datasetId || dataset?.state !== 'ready') { setCells([]); setCellName(''); return; }
    const controller = new AbortController();
    setCells([]); setCellName('');
    fetch(`/api/enc/cells?${new URLSearchParams({ dataset: datasetId })}`, { signal: controller.signal }).then(readJSON<{ cells: Cell[] }>).then(data => {
      if (controller.signal.aborted) return;
      setCells(data.cells);
    }).catch(reason => { if (!controller.signal.aborted) setCatalogError(reason.message); });
    return () => controller.abort();
  }, [datasetId, dataset?.state]);

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
    if (source === 'local' && (!dataset || dataset.state !== 'ready' || !cells.length)) {
      setState('empty');
      instance.setStyle(localEncStyle('', '', theme));
    } else {
      setState('loading');
      const load = async () => {
        try {
          const style = source === 'local' ? localEncStyle(datasetId, cellName, theme) : await fetch(`/enc/demo/style/${theme}`, { signal: controller.signal }).then(readJSON<StyleSpecification>);
          if (controller.signal.aborted) return;
          if (typeof style.sprite === 'string') style.sprite = new URL(style.sprite, location.origin).href;
          instance.once('idle', idle);
          instance.setStyle(style);
        } catch (reason) { if (!controller.signal.aborted) { setState('error'); setError(reason instanceof Error ? reason.message : String(reason)); } }
      };
      void load();
    }
    return () => { controller.abort(); instance.off('idle', idle); instance.off('error', failure); };
  }, [theme, source, datasetId, dataset?.state, cellName, cells.length, reload]);

  const fit = () => {
    const bounds = cell?.bounds ?? dataset?.bounds;
    if (source === 'local' && bounds) map.current?.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: { left: innerWidth > 700 ? 395 : 30, right: 60, top: innerWidth > 700 ? 40 : 260, bottom: 40 }, maxZoom: 15, duration: 0 });
    else map.current?.jumpTo(demoCamera);
  };
  useEffect(() => {
    if (source !== 'local') { map.current?.jumpTo(demoCamera); return; }
    // Start in a compact cell rather than fitting a potentially worldwide ZIP.
    // The source still includes every cell; this only chooses the initial camera.
    const area = (bounds: Bounds) => (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
    const waterCells = cells.filter(item => item.bounds && item.focus);
    const initialCell = cell ?? (waterCells.length ? waterCells : cells.filter(item => item.bounds)).reduce<Cell | undefined>(
      (best, item) => !best || area(item.bounds!) < area(best.bounds!) ? item : best, undefined);
    const bounds = initialCell?.bounds;
    if (!bounds) return;
    const focus = initialCell?.focus ?? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    const latitude = Math.max(-85, Math.min(85, focus[1]));
    const zoom = Math.log2(40075016.6856 * Math.cos(latitude * Math.PI / 180) * 120 / (512 * initialScaleSpanMeters));
    map.current?.jumpTo({
      center: [focus[0], latitude],
      zoom,
      padding: { left: innerWidth > 700 ? 395 : 30, right: 60, top: innerWidth > 700 ? 40 : 260, bottom: 40 }
    });
  }, [cellName, datasetId, source, cells]);

  const upload = async () => {
    if (!file) return;
    setUploading(true); setUploadError('');
    try {
      const body = new FormData(); body.append('file', file);
      const result = await fetch(`/api/uploads?${new URLSearchParams({ dataset: name })}`, { method: 'POST', body, headers: { 'X-Editor-Import': '1' } }).then(readJSON<{ id: string }>);
      setSource('local'); setDatasetId(result.id); setFile(null); setReload(value => value + 1);
    } catch (reason) { setUploadError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setUploading(false); }
  };

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
      setDeleteNotice(result.warning || 'Đã xóa dataset và dữ liệu ENC liên quan.');
      setDeleteTarget(null); setReload(value => value + 1);
    } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeleting(false); }
  };

  return (
    <Box sx={{ height: '100dvh', display: 'grid', gridTemplateRows: '56px minmax(0,1fr)', bgcolor: '#edf0f3' }}>
      <CssBaseline />
      <Dialog open={deleteTarget !== null} onClose={() => { if (!deleting) setDeleteTarget(null); }} aria-labelledby="enc-delete-title" aria-describedby="enc-delete-description" fullWidth maxWidth="xs">
        <DialogTitle id="enc-delete-title">Xóa dataset ENC?</DialogTitle>
        <DialogContent>
          <DialogContentText id="enc-delete-description">Dataset “{deleteTarget?.name}”, các cell, feature và job import sẽ bị xóa vĩnh viễn. File ZIP do ứng dụng lưu khi upload cũng sẽ được xóa.</DialogContentText>
          {deleteError && <Alert severity="error">{deleteError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button disabled={deleting} onClick={() => setDeleteTarget(null)}>Hủy</Button>
          <Button color="error" variant="contained" disabled={deleting} onClick={() => void deleteDataset()} startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <Trash2 size={16} />}>{deleting ? 'Đang xóa…' : 'Xóa vĩnh viễn'}</Button>
        </DialogActions>
      </Dialog>
      <Box component="header" sx={{ px: 2, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: '#7d172a', color: '#fff' }}>
        <Layers3 size={22} aria-hidden="true" /><Typography component="h1" sx={{ fontSize: 17, fontWeight: 800 }}>Hải đồ ENC</Typography>
        <Chip size="small" label="Chỉ xem" sx={{ color: '#fff', bgcolor: '#ffffff20' }} /><Box sx={{ flex: 1 }} />
        <Button href={location.pathname} color="inherit" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>Chọn chế độ</Button>
        <Button href="?mode=osm" color="inherit" startIcon={<Map size={16} />}>OSM Editor</Button>
      </Box>
      <Box sx={{ minHeight: 0, position: 'relative' }}>
        <Box ref={container} sx={{ position: 'absolute', inset: 0 }} />
        <Paper component="aside" elevation={0} sx={{ position: 'absolute', top: 16, left: 16, width: 'min(350px,calc(100% - 76px))', maxHeight: 'calc(100% - 55px)', overflowY: 'auto', p: 1.5, borderRadius: 2, boxShadow: '0 12px 30px rgba(70,12,26,.20)' }}>
          <Stack spacing={1.5}>
            <TextField select label="Nguồn hải đồ" size="small" value={source} onChange={event => setSource(event.target.value)}>
              <MenuItem value="local">ENC đã import</MenuItem><MenuItem value="demo">OpenENC demo (online)</MenuItem>
            </TextField>
            {source === 'local' && <>
              {catalogError && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setReload(value => value + 1)}>Tải lại</Button>}>{catalogError}</Alert>}
              <TextField select label="Dataset" size="small" value={datasets.some(item => item.id === datasetId) ? datasetId : ''} onChange={event => setDatasetId(event.target.value)}>
                <MenuItem value="">Chọn dataset ENC</MenuItem>
                {datasets.map(item => <MenuItem key={item.id} value={item.id}>{item.name} · {item.state === 'ready' ? 'Sẵn sàng' : item.state === 'failed' ? 'Import lỗi' : 'Đang import'}</MenuItem>)}
              </TextField>
              {dataset && <Button color="error" variant="outlined" startIcon={<Trash2 size={16} />} disabled={dataset.state === 'importing' || deleting} onClick={() => { setDeleteTarget(dataset); setDeleteError(''); setDeleteNotice(''); }}>Xóa dataset{dataset.state === 'failed' ? ' import lỗi' : ''}</Button>}
              {deleteNotice && <Alert severity="info" onClose={() => setDeleteNotice('')}>{deleteNotice}</Alert>}
              {dataset?.state === 'importing' && <Alert severity="info" icon={<CircularProgress size={18} />}>Worker đang xử lý ZIP. Dữ liệu sẽ xuất hiện khi import hoàn tất. Có thể xóa dataset sau khi xử lý xong.</Alert>}
              {dataset?.state === 'failed' && <Alert severity="error">{dataset.error || 'Import thất bại.'}</Alert>}
              {cells.length > 0 && <TextField select label="Phạm vi hiển thị" size="small" value={cellName} onChange={event => setCellName(event.target.value)}><MenuItem value="">Tất cả cell · tự động</MenuItem>{cells.map(item => <MenuItem key={item.name} value={item.name}>{item.name} · E{item.edition ?? '?'} / U{item.updateNumber}</MenuItem>)}</TextField>}
              {dataset?.state === 'ready' && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{cells.length} cell · {dataset.featureCount.toLocaleString('vi-VN')} feature</Typography>}
              {!datasets.length && !catalogError && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Chưa có ENC. Tải lên ZIP gồm cell .000 và các update đi kèm, hoặc chọn OpenENC demo.</Typography>}
            </>}
            {source === 'demo' && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Dữ liệu mẫu trực tuyến từ OpenENC. Chọn “ENC đã import” để xem dữ liệu của bạn.</Typography>}
            <ToggleButtonGroup exclusive value={theme} size="small" onChange={(_, value: EncTheme | null) => value && setTheme(value)} aria-label="Chế độ màu ENC" sx={{ '& .MuiToggleButton-root': { flex: 1, gap: 0.6, fontSize: 11.5, textTransform: 'none' } }}>
              {themes.map(item => { const Icon = item.icon; return <ToggleButton key={item.value} value={item.value}><Icon size={15} />{item.label}</ToggleButton>; })}
            </ToggleButtonGroup>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography role="status" aria-live="polite" sx={{ fontSize: 12, color: state === 'error' ? 'error.main' : 'text.secondary' }}>{state === 'loading' ? 'Đang tải hải đồ…' : state === 'ready' ? 'Hải đồ sẵn sàng' : state === 'empty' ? 'Chọn dữ liệu để xem' : 'Không tải được hải đồ'}</Typography>
              <Tooltip title="Về phạm vi cell"><IconButton onClick={fit} size="small" aria-label="Về phạm vi cell"><RotateCcw size={16} /></IconButton></Tooltip>
            </Stack>
            {error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setReload(value => value + 1)}>Thử lại</Button>}>{error}</Alert>}
            <Box component="form" onSubmit={event => { event.preventDefault(); void upload(); }} sx={{ pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
              <Stack spacing={1.25}>
                <Typography component="h2" sx={{ fontSize: 14, fontWeight: 750 }}>Import ENC</Typography>
                <input ref={input} hidden type="file" accept=".zip,application/zip" onChange={event => { const next = event.target.files?.[0] ?? null; setFile(next); if (next) setName(next.name.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 80)); }} />
                <Button variant="outlined" startIcon={<Upload size={16} />} onClick={() => input.current?.click()} disabled={uploading} sx={{ justifyContent: 'flex-start', overflowWrap: 'anywhere' }}>{file ? file.name : 'Chọn ZIP S-57 (tối đa 100 MiB)'}</Button>
                {file && <>
                  <TextField label="Tên dataset" value={name} onChange={event => setName(event.target.value)} required slotProps={{ htmlInput: { pattern: '[A-Za-z0-9][A-Za-z0-9-]{0,79}', maxLength: 80 } }} helperText="Chữ ASCII, số và dấu gạch ngang; tên duy nhất." />
                  <Button type="submit" variant="contained" disabled={uploading || !name}>{uploading ? 'Đang tải lên…' : 'Import và mở hải đồ'}</Button>
                </>}
                {uploadError && <Alert severity="error">{uploadError}</Alert>}
              </Stack>
            </Box>
            {selected && <Box sx={{ pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}><Typography component="h2" sx={{ fontSize: 14, fontWeight: 750 }}>{String(selected.object_class)}</Typography><IconButton size="small" aria-label="Bỏ chọn đối tượng" onClick={() => setSelected(null)}><X size={16} /></IconButton></Stack>
              {Object.entries(selected).filter(([key]) => !['feature_id', 'object_class'].includes(key)).map(([key, value]) => <Box key={key} sx={{ display: 'grid', gridTemplateColumns: '100px minmax(0,1fr)', gap: 1, fontSize: 12, py: 0.3 }}><Box sx={{ color: 'text.secondary' }}>{key}</Box><Box sx={{ overflowWrap: 'anywhere' }}>{String(value)}</Box></Box>)}
            </Box>}
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
