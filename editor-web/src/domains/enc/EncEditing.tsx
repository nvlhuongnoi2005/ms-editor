import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { Download, MapPinPlus, Redo2, Save, Trash2, Undo2, X } from 'lucide-react';
import { Marker, type GeoJSONSource, type Map as EncMap, type MapMouseEvent } from 'maplibre-gl';
import { readDraft, writeDraft } from '../../features/editor/drafts';
import { acknowledgeCommit, changeFeature, commitChanges, createEncWorkspace, draftKey, EncEditingError, initialEditing, loadEncFeature, loadEncWorkspace, saveEncWorkspace, travelHistory, validateEditingDraft,
  type EncCredentials, type EncEditFeature, type EncEditState, type EncWorkspace } from './editing';

type Props = {
  map: EncMap | null; selected: Record<string, unknown> | null;
  cell?: { name: string; revisionId?: string }; sidebarOpen: boolean; enabled: boolean;
  onActive: (workspace: EncCredentials | null) => void;
  onClearSelection: () => void;
};
const activeKey = 'enc:active-editing';
const emptyCollection = { type: 'FeatureCollection' as const, features: [] };

export function EncEditing({ map, selected, cell, sidebarOpen, enabled, onActive, onClearSelection }: Props) {
  const [state, setState] = useState<EncEditState | null>(null);
  const current = useRef(state); current.current = state;
  const [config, setConfig] = useState<EncWorkspace | null>(null);
  const [focused, setFocused] = useState<EncEditFeature | null>(null);
  const originals = useRef<Record<string, EncEditFeature>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [newClass, setNewClass] = useState('LNDMRK');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [coordinates, setCoordinates] = useState(['', '']);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const backup = useRef<unknown>(null);
  const [restoreRevision, setRestoreRevision] = useState('');
  const draftRevision = useRef<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const renderPreview = useRef<() => void>(() => {});
  const locked = busy || storageBlocked || Boolean(state?.pending);
  const effective = focused && state ? state.documents[focused.key] ?? originals.current[focused.key] ?? null : focused;
  const dirty = state ? commitChanges(state).length : 0;

  const persist = useCallback((next: EncEditState) => {
    const record = { ...structuredClone(next), revision: crypto.randomUUID() };
    const operation = queue.current.then(async () => {
      await writeDraft(draftKey(record.workspace.baseRevision), draftRevision.current, record);
      draftRevision.current = record.revision;
    });
    queue.current = operation.catch(reason => { setStorageBlocked(true); throw reason; });
    return queue.current;
  }, []);
  const update = useCallback((next: EncEditState) => {
    current.current = next; setState(next); setNotice('');
    void persist(next).catch(reason => { setStorageBlocked(true); setError(reason instanceof Error ? reason.message : 'Không ghi được bản nháp. Hãy xuất bản sao.'); });
  }, [persist]);

  const open = useCallback(async (revision: string, resumeOnly = false) => {
    if (busy || current.current) return;
    setBusy(true); setError('');
    try {
      const stored = await readDraft(draftKey(revision));
      backup.current = stored; setHasBackup(Boolean(stored));
      let draft: EncEditState;
      if (stored) { draft = validateEditingDraft(stored, revision); draftRevision.current = draft.revision; }
      else {
        if (resumeOnly) throw new Error('Không tìm thấy bản nháp. Chọn cell để mở không gian biên tập.');
        draftRevision.current = null;
        const workspace = { id: crypto.randomUUID(), token: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''), baseRevision: revision };
        draft = initialEditing(workspace, { id: workspace.id, baseRevision: revision, version: 0, cellName: cell?.name ?? '', features: [], attributes: [], pointClasses: [], sourceChanged: false });
        // Keep the same credentials if the create response is lost.
        await persist(draft);
      }
      localStorage.setItem(activeKey, revision);
      current.current = draft; setState(draft); onActive(draft.workspace);
      await createEncWorkspace(draft.workspace);
      const server = await loadEncWorkspace(draft.workspace);
      setConfig(server);
      if (server.bounds) map?.fitBounds([[server.bounds[0], server.bounds[1]], [server.bounds[2], server.bounds[3]]], { padding: 80, maxZoom: 15, duration: 0 });
      if (draft.pending) {
        setNotice('Lần lưu trước chưa được xác nhận. Bấm Lưu để kiểm tra và tiếp tục đúng lần lưu đó.');
      } else if (server.version !== draft.version) {
        if (commitChanges(draft).length) {
          setStorageBlocked(true); setError('Không gian biên tập đã thay đổi ở tab khác. Xuất bản sao trước khi tải lại.');
        } else {
          draft = initialEditing(draft.workspace, server); current.current = draft; setState(draft); await persist(draft);
        }
      }
      setRestoreRevision(''); setHasBackup(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }, [busy, cell?.name, map, onActive, persist]);

  useEffect(() => {
    try { setRestoreRevision(localStorage.getItem(activeKey) ?? ''); } catch { setError('Trình duyệt đang chặn lưu trữ. Cho phép lưu trữ trước khi biên tập.'); }
  }, []);
  useEffect(() => { onActive(state?.workspace ?? null); }, [state?.workspace.id, onActive]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (current.current && (commitChanges(current.current).length || current.current.pending)) { event.preventDefault(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  useEffect(() => {
    if (!state || !selected?.edit_key || selected.revision_id !== state.workspace.baseRevision || creating || busy) return;
    const id = ++generation.current;
    const key = String(selected.edit_key);
    setError(''); setDeleteOpen(false);
    void loadEncFeature(state.workspace, key).then(feature => {
      if (id !== generation.current) return;
      originals.current[key] = feature; setFocused(feature);
    }).catch(reason => { if (id === generation.current) setError(reason.message); });
    return () => { generation.current++; };
  }, [selected, state?.workspace.id, creating, busy]);

  useEffect(() => {
    if (effective?.geometry.type === 'Point') setCoordinates((effective.geometry.coordinates as number[]).slice(0, 2).map(String));
  }, [effective]);

  const mutate = useCallback((after: EncEditFeature | undefined, key?: string) => {
    const value = current.current;
    if (!value || locked) return;
    const featureKey = key ?? after?.key;
    if (!featureKey) return;
    try {
      // Returning to the source removes the override rather than creating a net change.
      const original = originals.current[featureKey];
      const next = after && original && JSON.stringify(after) === JSON.stringify(original) ? undefined : after;
      update(changeFeature(value, featureKey, next)); setDeleteOpen(false);
    } catch (reason) { setError((reason as Error).message); }
  }, [locked, update]);

  useEffect(() => {
    if (!map || !state) return;
    const render = () => {
      if (!map.isStyleLoaded()) { map.off('idle', render); map.once('idle', render); return; }
      if (!map.getSource('enc-edits')) {
        map.addSource('enc-edits', { type: 'geojson', data: emptyCollection });
        map.addLayer({ id: 'enc-edits-areas', type: 'fill', source: 'enc-edits', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#8b2235', 'fill-opacity': 0.14 } });
        map.addLayer({ id: 'enc-edits-lines', type: 'line', source: 'enc-edits', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#8b2235', 'line-width': 3 } });
        map.addLayer({ id: 'enc-edits-points', type: 'circle', source: 'enc-edits', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 8, 'circle-color': '#8b2235', 'circle-stroke-color': '#fcfbf7', 'circle-stroke-width': 2 } });
      }
      const value = current.current;
      if (!value) return;
      // Every visual copy (line, symbol, sector, sounding) hides the changed source feature.
      const hidden = Object.values(value.documents).map(f => f.key);
      for (const layer of map.getStyle().layers) {
        if (!('source' in layer) || layer.source !== 'enc') continue;
        const filter = layer.filter;
        if (!baseFilters.has(layer.id)) baseFilters.set(layer.id, filter);
        const original = baseFilters.get(layer.id);
        const next = ['all', ...(original ? [original] : []), ['!', ['in', ['get', 'edit_key'], ['literal', hidden]]]];
        if (JSON.stringify(filter) !== JSON.stringify(next)) map.setFilter(layer.id, next as never);
      }
      (map.getSource('enc-edits') as GeoJSONSource).setData({ type: 'FeatureCollection', features: Object.values(value.documents).filter(f => !f.deleted).map(f => ({ type: 'Feature', geometry: f.geometry, properties: { edit_key: f.key } })) } as never);
    };
    const baseFilters = new Map<string, unknown>();
    renderPreview.current = render;
    render();
    const reloadStyle = () => { baseFilters.clear(); render(); };
    map.on('style.load', reloadStyle);
    return () => {
      renderPreview.current = () => {};
      map.off('style.load', reloadStyle); map.off('idle', render);
      for (const [id, filter] of baseFilters) if (map.getLayer(id)) map.setFilter(id, filter as never);
      for (const id of ['enc-edits-points', 'enc-edits-lines', 'enc-edits-areas']) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource('enc-edits')) map.removeSource('enc-edits');
    };
  }, [map, state?.workspace.id]);
  useEffect(() => { renderPreview.current(); }, [state?.documents]);

  useEffect(() => {
    if (!map || !state) return;
    const click = (event: MapMouseEvent) => {
      if (creating && !locked) {
        const sourceId = `new:${crypto.randomUUID()}`;
        const feature: EncEditFeature = { key: `${newClass}/${sourceId}`, sourceId, objectClass: newClass, attributes: {}, geometry: { type: 'Point', coordinates: [event.lngLat.lng, event.lngLat.lat] }, deleted: false, canMove: true, canDelete: true };
        mutate(feature); setFocused(feature); onClearSelection(); setCreating(false); return;
      }
      if (!map.isStyleLoaded() || !map.getLayer('enc-edits-points')) return;
      const feature = map.queryRenderedFeatures(event.point, { layers: ['enc-edits-points', 'enc-edits-lines', 'enc-edits-areas'] })[0];
      const doc = feature && current.current?.documents[String(feature.properties.edit_key)];
      if (doc) { generation.current++; setFocused(doc); setDeleteOpen(false); }
    };
    map.on('click', click);
    if (creating) map.getCanvas().style.cursor = 'crosshair';
    return () => {
      map.off('click', click);
      if (creating) map.getCanvas().style.cursor = '';
    };
  }, [map, state?.workspace.id, creating, newClass, locked, mutate, onClearSelection]);

  useEffect(() => {
    if (!map || !effective?.canMove || effective.deleted || effective.geometry.type !== 'Point' || locked || creating) return;
    const marker = new Marker({ draggable: true, color: '#8b2235' }).setLngLat((effective.geometry.coordinates as [number, number])).addTo(map);
    marker.on('dragend', () => { const p = marker.getLngLat(); mutate({ ...effective, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }); });
    return () => { marker.remove(); };
  }, [map, effective, locked, creating, mutate]);

  const save = async () => {
    let value = current.current;
    if (!value || busy || storageBlocked) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!config) { await createEncWorkspace(value.workspace); setConfig(await loadEncWorkspace(value.workspace)); }
      if (!value.pending) {
        const changes = commitChanges(value);
        if (!changes.length) { setNotice('Các thay đổi đã được lưu.'); return; }
        if (changes.length > 500) throw new Error('Mỗi lần lưu tối đa 500 đối tượng. Hoàn tác bớt thay đổi rồi lưu theo từng đợt.');
        value = { ...value, pending: { requestId: crypto.randomUUID(), expectedVersion: value.version, changes } };
        current.current = value; setState(value);
      }
      await persist(value);
      const result = await saveEncWorkspace(value.workspace, value.pending!);
      if (result.requestId !== value.pending!.requestId) throw new Error('Phản hồi lưu không khớp yêu cầu. Bấm Lưu để kiểm tra lại.');
      value = acknowledgeCommit(value, result.version); current.current = value; setState(value);
      await persist(value); setNotice('Đã lưu thay đổi vào không gian biên tập.');
    } catch (reason) {
      if (reason instanceof EncEditingError && reason.status >= 400 && reason.status < 500 && current.current) {
        // A definite rejection did not commit; an interrupted response keeps the exact request.
        const next = { ...current.current, pending: undefined }; current.current = next; setState(next);
        try { await persist(next); } catch { setStorageBlocked(true); }
        if (reason.code === 'version_conflict' || reason.code === 'request_conflict') setStorageBlocked(true);
      }
      setError(reason instanceof Error ? reason.message : 'Chưa xác nhận được lần lưu. Bấm Lưu để kiểm tra lại.');
    } finally { setBusy(false); }
  };
  const exportCopy = () => {
    const value = current.current;
    const copy = value ? { ...value, revision: draftRevision.current ?? value.revision } : backup.current;
    if (!copy) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `enc-draft-${value?.workspace.id ?? 'backup'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!enabled && !state) return null;
  return <>
    <Paper component="section" aria-label="Biên tập ENC" elevation={0} className={`enc-edit-toolbar${!state ? ' enc-edit-start' : ''}`} sx={{ left: sidebarOpen && innerWidth > 700 ? 336 : 16 }}>
      {!state ? <Stack spacing={1}>
        <Button variant="contained" disabled={busy || !cell?.revisionId || !enabled} onClick={() => cell?.revisionId && void open(cell.revisionId)}>{busy ? 'Đang mở…' : 'Biên tập cell'}</Button>
        {!cell && <Typography variant="caption">Chọn một cell trong Phạm vi hiển thị để biên tập.</Typography>}
        {restoreRevision && <Button disabled={busy} onClick={() => void open(restoreRevision, true)}>Tiếp tục bản biên tập</Button>}
        {hasBackup && <Button startIcon={<Download size={16} />} onClick={exportCopy}>Xuất bản sao bản nháp</Button>}
      </Stack> : <Stack spacing={1}>
        <Typography component="h2" sx={{ fontSize: 14, fontWeight: 600 }}>Biên tập {config?.cellName || cell?.name || 'ENC'}</Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <IconButton aria-label="Hoàn tác ENC" disabled={locked || !state.undo.length} onClick={() => update(travelHistory(state, 'undo'))}><Undo2 size={18} /></IconButton>
          <IconButton aria-label="Làm lại ENC" disabled={locked || !state.redo.length} onClick={() => update(travelHistory(state, 'redo'))}><Redo2 size={18} /></IconButton>
          <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} disabled={busy || storageBlocked || (!dirty && !state.pending && Boolean(config))} onClick={() => void save()}>{busy ? 'Đang lưu…' : state.pending ? 'Kiểm tra lần lưu' : 'Lưu'}</Button>
          <IconButton aria-label="Xuất bản sao bản nháp ENC" onClick={exportCopy}><Download size={18} /></IconButton>
        </Stack>
        <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
          <TextField select size="small" label="Loại điểm" value={newClass} disabled={locked || !config} onChange={event => setNewClass(event.target.value)} sx={{ minWidth: 120 }}>{(config?.pointClasses ?? ['LNDMRK']).map(name => <MenuItem key={name} value={name}>{name}</MenuItem>)}</TextField>
          <Button startIcon={<MapPinPlus size={17} />} disabled={locked || !config} aria-pressed={creating} onClick={() => setCreating(value => !value)}>{creating ? 'Hủy đặt điểm' : 'Thêm điểm'}</Button>
        </Stack>
        <Typography role="status" aria-live="polite" sx={{ fontSize: 12 }}>{creating ? 'Bấm lên bản đồ để đặt điểm.' : `${dirty} thay đổi chưa lưu · ${Object.keys(state.documents).length} đối tượng trong bản biên tập`}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Lưu riêng bản biên tập; hải đồ công bố giữ nguyên.</Typography>
        {Object.keys(state.documents).length > 0 && <TextField select label="Đối tượng trong bản biên tập" size="small" value={effective && state.documents[effective.key] ? effective.key : ''} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} onChange={event => {
          const feature = state.documents[event.target.value]; if (!feature) return;
          generation.current++; setFocused(feature); setDeleteOpen(false);
          if (feature.geometry.type === 'Point') map?.easeTo({ center: feature.geometry.coordinates as [number, number], duration: 0 });
        }}><MenuItem value="">Chọn đối tượng</MenuItem>{Object.values(state.documents).map(feature => <MenuItem key={feature.key} value={feature.key}>{feature.objectClass} · {String(feature.attributes.OBJNAM || feature.sourceId)}{feature.deleted ? ' · Đã xóa' : ''}</MenuItem>)}</TextField>}
        {config?.sourceChanged && <Alert severity="warning">Nguồn đã có phiên bản khác. Bản biên tập vẫn giữ phiên bản ban đầu để đối soát.</Alert>}
        {dirty > 0 && !locked && (discardOpen ? <Alert severity="warning" action={<Button color="inherit" onClick={() => { update({ ...state, documents: structuredClone(state.saved), undo: [], redo: [] }); setFocused(null); setDiscardOpen(false); }}>Bỏ thay đổi</Button>}>Trở về lần lưu gần nhất? <Button color="inherit" onClick={() => setDiscardOpen(false)}>Hủy</Button></Alert> : <Button onClick={() => setDiscardOpen(true)}>Bỏ thay đổi chưa lưu</Button>)}
        {!busy && !dirty && !state.pending && !storageBlocked && <Button onClick={() => { void queue.current.then(() => { generation.current++; setRestoreRevision(state.workspace.baseRevision); setState(null); current.current = null; setConfig(null); setFocused(null); setCreating(false); onActive(null); }).catch(reason => setError(reason.message)); }}>Về chế độ xem</Button>}
      </Stack>}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mt: 1 }}>{notice}</Alert>}
    </Paper>
    {state && effective && !creating && <Paper component="section" aria-label="Chỉnh sửa đối tượng ENC" className="enc-properties enc-edit-properties" elevation={0}>
      <Box className="enc-properties-header"><Box><Typography component="h2">Biên tập đối tượng</Typography><Typography component="h3" className="enc-properties-name">{effective.objectClass}</Typography></Box><IconButton aria-label="Đóng biên tập đối tượng" onClick={() => { generation.current++; setFocused(null); }}><X size={20} /></IconButton></Box>
      <Stack spacing={2} className="enc-properties-body" sx={{ pt: '20px !important' }}>
        {effective.deleted ? <><Alert severity="info">Đối tượng đã được đánh dấu xóa trong bản biên tập.</Alert><Button disabled={locked} onClick={() => mutate({ ...effective, deleted: false })}>Khôi phục đối tượng</Button></> : <>
          {effective.objectClass === 'SOUNDG' && <Alert severity="info">Độ sâu: {String(effective.attributes.DEPTH ?? (effective.geometry.coordinates as number[])[2] ?? '—')} m. SOUNDG được bảo vệ để giữ nhóm điểm nguồn.</Alert>}
          {(config?.attributes ?? []).map(attribute => <TextField key={attribute.key} label={`${attribute.label} (${attribute.key})`} size="small" disabled={locked || effective.objectClass === 'SOUNDG'} value={effective.attributes[attribute.key] ?? ''}
            type={attribute.kind === 'number' ? 'number' : 'text'} multiline={attribute.key.includes('INFORM')}
            onChange={event => {
              const attributes = { ...effective.attributes };
              if (event.target.value === '') delete attributes[attribute.key]; else attributes[attribute.key] = attribute.kind === 'number' ? Number(event.target.value) : event.target.value;
              mutate({ ...effective, attributes });
            }} />)}
          {effective.canMove ? <>
            <TextField size="small" label="Kinh độ" value={coordinates[0]} disabled={locked} onChange={event => setCoordinates([event.target.value, coordinates[1]])} />
            <TextField size="small" label="Vĩ độ" value={coordinates[1]} disabled={locked} onChange={event => setCoordinates([coordinates[0], event.target.value])} />
            <Button disabled={locked} onClick={() => {
              const point = coordinates.map(Number);
              if (coordinates.some(c => !c.trim()) || point.some(n => !Number.isFinite(n)) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) { setError('Kinh độ phải từ -180 đến 180; vĩ độ từ -90 đến 90.'); return; }
              mutate({ ...effective, geometry: { type: 'Point', coordinates: point } });
            }}>Áp dụng tọa độ</Button>
            <Typography variant="caption">Có thể kéo dấu ghim trên bản đồ để đổi vị trí.</Typography>
          </> : <Typography variant="caption">Hình học nguồn được bảo vệ trong bản biên tập cơ bản.</Typography>}
          {effective.canDelete && (deleteOpen ? <Alert severity="warning" action={<Button color="inherit" disabled={locked} onClick={() => { if (effective.sourceId.startsWith('new:')) { mutate(undefined, effective.key); setFocused(null); } else mutate({ ...effective, deleted: true }); }}>Xóa</Button>}>Xóa điểm khỏi bản biên tập? <Button color="inherit" onClick={() => setDeleteOpen(false)}>Hủy</Button></Alert> : <Button color="error" startIcon={<Trash2 size={16} />} disabled={locked} onClick={() => setDeleteOpen(true)}>Xóa điểm</Button>)}
          <Box component="details"><Box component="summary" sx={{ cursor: 'pointer', py: 1, fontSize: 13 }}>Thuộc tính nguồn khác</Box><Box component="dl" className="enc-properties-list">{Object.entries(effective.attributes).filter(([key]) => !(config?.attributes ?? []).some(attribute => attribute.key === key)).map(([key, value]) => <Box className="enc-properties-row" key={key}><Box component="dt">{key}</Box><Box component="dd">{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</Box></Box>)}</Box></Box>
        </>}
      </Stack>
    </Paper>}
  </>;
}
