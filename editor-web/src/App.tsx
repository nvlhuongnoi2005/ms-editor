import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Autocomplete,
  AppBar,
  Badge,
  Box,
  Button,
  Chip,
  CssBaseline,
  Divider,
  GlobalStyles,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography
} from '@mui/material';
import { closeChangeset, createChangeset, ChangesetApiError, toUploadChanges, uploadChangeset } from './api/changeset';
import { DATASET_NAME, loadGraph } from './api/graph';
import { EditorStoreProvider, entityKey, type FeatureMutation, useEditorStore } from './features/editor/EditorStore';
import { insertNodeIntoFeature, makeNodeFeature, makeWayFeature, type DrawMode, type SnappedVertex } from './features/editor/drawing';
import { AREA_PRESETS } from './features/editor/presets';
import { OSM_TAG_OPTIONS, type OsmTagOption } from './features/editor/tagCatalog';
import { MapCanvas, type MapPointerStatus, type MapViewport } from './features/map/MapCanvas';
import type { Coordinate, GraphFeature, SelectedEntity, Tags } from './types/osm';

const propertiesWidth = 348;
const GRAPH_MIN_ZOOM = 16;
const CHANGESET_COMMENT = 'Chỉnh sửa từ Geodata WebGIS';
type Bbox = [number, number, number, number];

interface GraphCacheEntry {
  bbox: Bbox;
  features: GraphFeature[];
}

function bufferedBbox([west, south, east, north]: Bbox): Bbox {
  const longitudePadding = (east - west) * .18;
  const latitudePadding = (north - south) * .18;
  return [Math.max(-180, west - longitudePadding), Math.max(-85.051129, south - latitudePadding), Math.min(180, east + longitudePadding), Math.min(85.051129, north + latitudePadding)];
}

function containsBbox(outer: Bbox, inner: Bbox) {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

function bboxKey(bbox: Bbox) {
  return bbox.map(value => value.toFixed(4)).join(',');
}

const glyph = (symbol: string, size = 18) => (
  <Box component="span" aria-hidden="true" sx={{ display: 'grid', width: size + 8, height: size + 8, placeItems: 'center', fontSize: size, fontWeight: 700, lineHeight: 1 }}>
    {symbol}
  </Box>
);

function categoryFor(tags: Record<string, string>) {
  return AREA_PRESETS
    .filter(preset => Object.entries(preset.tags).every(([key, value]) => tags[key] === value))
    .sort((a, b) => Object.keys(b.tags).length - Object.keys(a.tags).length)[0]?.label
    ?? (tags.highway ? 'Giao thông' : tags.building ? 'Công trình' : tags.amenity ? 'Tiện ích' : 'Chưa phân loại');
}

function coordinatesOfWay(way: GraphFeature): Coordinate[] | null {
  if (way.geometry.type === 'LineString') return way.geometry.coordinates.map(([longitude, latitude]) => [longitude, latitude]);
  if (way.geometry.type === 'Polygon') {
    const ring = way.geometry.coordinates[0];
    return ring ? ring.map(([longitude, latitude]) => [longitude, latitude]) : null;
  }
  return null;
}

function moveNodeInWay(way: GraphFeature, nodeId: string, coordinate: Coordinate): GraphFeature {
  if (way.properties.entityType !== 'way' || !way.properties.nodeIds?.includes(nodeId)) return way;
  const nodeIds = way.properties.nodeIds;
  const geometryCoordinates = coordinatesOfWay(way);
  if (!geometryCoordinates) return way;
  const coordinates = geometryCoordinates.map((item, index) => nodeIds[index] === nodeId ? coordinate : item);
  const nodes = way.properties.nodes?.map(node => node.id === nodeId ? { ...node, coordinates: coordinate } : node);
  return {
    ...way,
    properties: { ...way.properties, nodes },
    geometry: way.geometry.type === 'Polygon'
      ? { type: 'Polygon', coordinates: [coordinates] }
      : { type: 'LineString', coordinates }
  };
}

function ToolButton({ active = false, disabled = false, label, symbol, onClick }: { active?: boolean; disabled?: boolean; label: string; symbol: string; onClick?: () => void }) {
  return (
    <Tooltip title={disabled ? `${label} — đang phát triển` : label} placement="right">
      <span>
        <IconButton
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1.5,
            color: active ? 'primary.contrastText' : 'text.secondary',
            bgcolor: active ? 'primary.main' : 'transparent',
            '&:hover': { bgcolor: active ? 'primary.dark' : 'rgba(164, 28, 49, 0.08)' }
          }}
        >
          {glyph(symbol)}
        </IconButton>
      </span>
    </Tooltip>
  );
}

function PropertiesEditor({ selected, category, onUpdate }: { selected: SelectedEntity; category: string; onUpdate: (tags: Tags, label: string) => void }) {
  const [draftTags, setDraftTags] = useState<Tags>(selected.tags);
  const [newTagKey, setNewTagKey] = useState('');
  const selectedIdentity = `${selected.type}/${selected.id}`;

  useEffect(() => {
    setDraftTags(selected.tags);
    setNewTagKey('');
  }, [selectedIdentity, selected.tags]);

  const commit = useCallback((label = 'Cập nhật thuộc tính') => {
    if (JSON.stringify(draftTags) !== JSON.stringify(selected.tags)) onUpdate(draftTags, label);
  }, [draftTags, onUpdate, selected.tags]);

  const updateValue = (key: string, value: string) => setDraftTags(tags => ({ ...tags, [key]: value }));
  const removeTag = (key: string) => {
    setDraftTags(tags => {
      const next = { ...tags };
      delete next[key];
      onUpdate(next, `Xóa thẻ ${key}`);
      return next;
    });
  };
  const availableTagOptions = OSM_TAG_OPTIONS.filter(option => draftTags[option.key] === undefined);
  const addTagOption = (option: OsmTagOption | string | null) => {
    if (!option) return;
    const key = typeof option === 'string' ? option.trim() : option.key;
    const value = typeof option === 'string' ? '' : option.defaultValue ?? '';
    if (!key || draftTags[key] !== undefined) return;
    const next = { ...draftTags, [key]: value };
    setDraftTags(next);
    setNewTagKey('');
    onUpdate(next, `Add OSM tag ${key}`);
  };
  const presets = AREA_PRESETS.filter(preset => preset.geometry === 'area' && selected.geometry.type === 'Polygon');

  return (
    <Box sx={{ p: 2 }}>
      <Typography sx={{ color: '#7d172a', fontSize: 10.5, fontWeight: 800, letterSpacing: .8 }}>THỂ LOẠI ĐỐI TƯỢNG</Typography>
      {presets.length ? <TextField select fullWidth size="small" value="" label={category} sx={{ mt: 1 }} onChange={event => {
        const preset = presets.find(item => item.id === event.target.value);
        if (!preset) return;
        const next = { ...draftTags, ...preset.tags };
        setDraftTags(next);
        onUpdate(next, `Đặt thể loại ${preset.label}`);
      }}>
        <MenuItem value="" disabled>Giữ thể loại hiện tại</MenuItem>
        {presets.map(preset => <MenuItem key={preset.id} value={preset.id}>{preset.label}</MenuItem>)}
      </TextField> : <Chip label={category} sx={{ mt: 1, bgcolor: '#f7e4e7', color: '#941a30', fontWeight: 700 }} />}

      <Divider sx={{ my: 2 }} />
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography sx={{ color: '#7d172a', fontSize: 10.5, fontWeight: 800, letterSpacing: .8 }}>THUỘC TÍNH OSM</Typography>
        <Chip label={`${Object.keys(draftTags).length} tags`} size="small" variant="outlined" />
      </Stack>

      <TextField
        fullWidth size="small" label="Tên" placeholder="Tên đối tượng"
        value={draftTags.name ?? ''}
        onChange={event => updateValue('name', event.target.value)}
        onBlur={() => commit('Cập nhật tên đối tượng')}
      />
      <Stack sx={{ mt: 1, gap: .75 }}>
        {Object.entries(draftTags).filter(([key]) => key !== 'name').map(([key, value]) => (
          <Stack key={key} direction="row" sx={{ alignItems: 'center', gap: .5 }}>
            <TextField size="small" value={key} slotProps={{ htmlInput: { readOnly: true, 'aria-label': `Khóa thẻ ${key}` } }} sx={{ width: 126, '& input': { fontFamily: 'monospace', fontSize: 12 } }} />
            <TextField size="small" value={value} onChange={event => updateValue(key, event.target.value)} onBlur={() => commit(`Cập nhật ${key}`)} slotProps={{ htmlInput: { 'aria-label': `Giá trị ${key}` } }} sx={{ flex: 1, minWidth: 0 }} />
            <Tooltip title={`Xóa ${key}`}><IconButton size="small" color="error" onClick={() => removeTag(key)}>{glyph('×', 15)}</IconButton></Tooltip>
          </Stack>
        ))}
      </Stack>
      <Autocomplete
        freeSolo
        options={availableTagOptions}
        inputValue={newTagKey}
        value={null}
        onInputChange={(_event, value) => setNewTagKey(value)}
        onChange={(_event, option) => addTagOption(option)}
        getOptionLabel={option => typeof option === 'string' ? option : `${option.label} (${option.key})`}
        isOptionEqualToValue={(option, value) => typeof option !== 'string' && typeof value !== 'string' && option.key === value.key}
        renderOption={(props, option) => (
          <li {...props} key={option.key}>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{option.label}</Typography>
              <Typography sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: 11 }}>{option.key} · {option.description}</Typography>
            </Box>
          </li>
        )}
        renderInput={params => <TextField {...params} size="small" label="Thêm thuộc tính" placeholder="Tìm thẻ OSM hoặc nhập khóa mới" />}
        sx={{ mt: 1.25 }}
      />
      <Typography sx={{ mt: .75, color: 'text.secondary', fontSize: 10.5 }}>Thay đổi được cập nhật vào graph local và chờ Lưu changeset.</Typography>
    </Box>
  );
}

export default function App() {
  return <EditorStoreProvider><EditorShell /></EditorStoreProvider>;
}

function EditorShell() {
  const toolsOpen = true;
  const setToolsOpen = (_open: boolean) => undefined;
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [graphVisible, setGraphVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [pointerStatus, setPointerStatus] = useState<MapPointerStatus>({ longitude: 104.50728, latitude: 21.59988, zoom: 16 });
  const [drawMode, setDrawMode] = useState<DrawMode>('select');
  const [drawVertices, setDrawVertices] = useState<SnappedVertex[]>([]);
  const graphCacheRef = useRef(new Map<string, GraphCacheEntry>());
  const graphRequestRef = useRef<AbortController | null>(null);
  const graphRequestIdRef = useRef(0);
  const viewportRef = useRef<MapViewport | null>(null);
  const nextNodeIdRef = useRef(-1);
  const nextWayIdRef = useRef(-1);
  const { features, selected, selectedKey, loading, error, changes, changeCount, canUndo, canRedo, hydrateGraph, setLoading, setError, selectFeature, updateTags, replaceFeatures, undo, redo, discardChanges } = useEditorStore();

  const refreshGraph = useCallback(({ bbox: viewport, zoom }: MapViewport) => {
    viewportRef.current = { bbox: viewport, zoom };
    const shouldShowGraph = zoom >= GRAPH_MIN_ZOOM;
    setGraphVisible(shouldShowGraph);
    if (!shouldShowGraph) {
      graphRequestRef.current?.abort();
      graphRequestRef.current = null;
      graphRequestIdRef.current += 1;
      setLoading(false);
      setError(null);
      return;
    }
    const cache = graphCacheRef.current;
    const cached = [...cache.values()].find(entry => containsBbox(entry.bbox, viewport));
    if (cached) {
      hydrateGraph(cached.features);
      setError(null);
      return;
    }
    const bbox = bufferedBbox(viewport);
    const key = bboxKey(bbox);
    const exact = cache.get(key);
    if (exact) {
      hydrateGraph(exact.features);
      setError(null);
      return;
    }
    graphRequestRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++graphRequestIdRef.current;
    graphRequestRef.current = controller;
    setLoading(true);
    void loadGraph(bbox, controller.signal)
      .then(result => {
        if (requestId !== graphRequestIdRef.current) return;
        cache.set(key, { bbox, features: result.features });
        if (cache.size > 8) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) cache.delete(oldestKey);
        }
        hydrateGraph(result.features);
        setError(null);
      })
      .catch(reason => {
        if (controller.signal.aborted || requestId !== graphRequestIdRef.current) return;
        setError(reason instanceof Error ? reason.message : 'Không thể tải graph.');
      })
      .finally(() => {
        if (requestId === graphRequestIdRef.current) setLoading(false);
      });
  }, [hydrateGraph, setError, setLoading]);

  const refreshAfterCommit = useCallback(() => {
    graphCacheRef.current.clear();
    const viewport = viewportRef.current;
    if (viewport) refreshGraph(viewport);
  }, [refreshGraph]);

  const retryCloseChangeset = useCallback(async (changesetId: string) => {
    setSaving(true);
    setSaveStatus(`Đang đóng changeset #${changesetId}…`);
    try {
      await closeChangeset(changesetId);
      setPendingCloseId(null);
      setSaveStatus(`Đã lưu và đóng changeset #${changesetId}.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể đóng changeset.';
      setSaveStatus(`Đã ghi DB trong changeset #${changesetId}, nhưng chưa thể đóng: ${message}`);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) return;
    if (pendingCloseId) {
      await retryCloseChangeset(pendingCloseId);
      return;
    }
    if (!changes.length) return;

    let uploadPayload: ReturnType<typeof toUploadChanges>;
    try {
      uploadPayload = toUploadChanges(changes);
    } catch (reason) {
      setSaveStatus(`Không thể chuẩn bị thay đổi để lưu: ${reason instanceof Error ? reason.message : 'Dữ liệu không hợp lệ.'}`);
      return;
    }

    setSaving(true);
    setSaveStatus('Đang tạo changeset…');
    try {
      const created = await createChangeset(DATASET_NAME, CHANGESET_COMMENT);
      setSaveStatus(`Đang ghi ${uploadPayload.length} thay đổi vào changeset #${created.id}…`);
      await uploadChangeset(created.id, uploadPayload);
      discardChanges();
      refreshAfterCommit();
      try {
        await closeChangeset(created.id);
        setSaveStatus(`Đã lưu và đóng changeset #${created.id}.`);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Không thể đóng changeset.';
        setPendingCloseId(created.id);
        setSaveStatus(`Đã ghi DB trong changeset #${created.id}, nhưng chưa thể đóng: ${message}`);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Lỗi không xác định.';
      const prefix = reason instanceof ChangesetApiError
        ? reason.phase === 'create' ? 'Không thể tạo changeset' : 'Không thể upload thay đổi'
        : 'Không thể lưu thay đổi';
      setSaveStatus(`${prefix}: ${message}`);
    } finally {
      setSaving(false);
    }
  }, [changes, discardChanges, pendingCloseId, refreshAfterCommit, retryCloseChangeset, saving]);

  const handleSelectFeature = useCallback((feature: GraphFeature | null) => {
    selectFeature(feature);
    setPropertiesOpen(true);
  }, [selectFeature]);
  const handleUpdateTags = useCallback((tags: Tags, label: string) => {
    if (selectedKey) updateTags(selectedKey, tags, label);
  }, [selectedKey, updateTags]);
  const handleMoveNode = useCallback((nodeId: string, coordinate: Coordinate) => {
    const existingNode = features.find(feature => feature.properties.entityType === 'node' && feature.properties.entityId === nodeId);
    const sourceNode = features
      .filter(feature => feature.properties.entityType === 'way')
      .flatMap(feature => feature.properties.nodes ?? [])
      .find(node => node.id === nodeId);
    if (!existingNode && !sourceNode) return;
    const node: GraphFeature = existingNode
      ? { ...existingNode, properties: { ...existingNode.properties, coordinates: coordinate }, geometry: { type: 'Point', coordinates: coordinate } }
      : {
          type: 'Feature', id: `node-${nodeId}`,
          properties: { entityType: 'node', entityId: nodeId, version: sourceNode?.version ?? 1, tags: sourceNode?.tags ?? {}, coordinates: coordinate, topologyNode: true },
          geometry: { type: 'Point', coordinates: coordinate }
        };
    const mutations: FeatureMutation[] = [{ key: `node/${nodeId}`, feature: node }];
    for (const way of features) {
      if (way.properties.entityType === 'way' && way.properties.nodeIds?.includes(nodeId)) {
        mutations.push({ key: entityKey(way), feature: moveNodeInWay(way, nodeId, coordinate) });
      }
    }
    replaceFeatures(mutations, `Di chuyển node ${nodeId}`);
  }, [features, replaceFeatures]);
  const handlePointerStatus = useCallback((status: MapPointerStatus) => setPointerStatus(status), []);

  const activateDrawMode = useCallback((mode: DrawMode) => {
    setDrawVertices([]);
    setDrawMode(mode);
  }, []);

  const handleCancelDrawing = useCallback(() => {
    setDrawVertices([]);
    setDrawMode('select');
  }, []);

  const handleDrawVertex = useCallback((vertex: SnappedVertex) => {
    const nodeId = vertex.nodeId ?? String(nextNodeIdRef.current--);
    const prepared: SnappedVertex & { nodeId: string } = { ...vertex, nodeId };
    if (drawMode !== 'point') {
      setDrawVertices(vertices => [...vertices, prepared]);
      return;
    }
    if (vertex.nodeId && !vertex.segment) {
      const existingPoint = features.find(feature => feature.properties.entityType === 'node' && feature.properties.entityId === vertex.nodeId);
      if (existingPoint) handleSelectFeature(existingPoint);
      return;
    }
    const mutations: FeatureMutation[] = [{ key: `node/${nodeId}`, feature: makeNodeFeature(nodeId, vertex.coordinate) }];
    if (vertex.segment) {
      const way = features.find(feature => feature.properties.entityType === 'way' && feature.properties.entityId === vertex.segment?.wayId);
      if (way) mutations.push({ key: entityKey(way), feature: insertNodeIntoFeature(way, nodeId, vertex.coordinate, vertex.segment.segmentIndex) });
    }
    const node = mutations[0].feature;
    replaceFeatures(mutations, vertex.segment ? 'Thêm điểm và split way' : 'Thêm điểm mới');
    if (node) handleSelectFeature(node);
    setDrawMode('select');
  }, [drawMode, features, handleSelectFeature, replaceFeatures]);

  const handleFinishDrawing = useCallback(() => {
    if (drawMode !== 'line' && drawMode !== 'area') return;
    const vertices = drawVertices.filter((vertex): vertex is SnappedVertex & { nodeId: string } => Boolean(vertex.nodeId));
    const minimum = drawMode === 'area' ? 3 : 2;
    if (vertices.length < minimum) return;
    const mutations: FeatureMutation[] = [];
    const createdNodes = new Set<string>();
    const wayUpdates = new Map<string, { feature: GraphFeature; inserts: number }>();
    for (const vertex of vertices) {
      if (vertex.nodeId.startsWith('-') && !createdNodes.has(vertex.nodeId)) {
        createdNodes.add(vertex.nodeId);
        mutations.push({ key: `node/${vertex.nodeId}`, feature: makeNodeFeature(vertex.nodeId, vertex.coordinate) });
      }
      if (!vertex.segment) continue;
      const current = wayUpdates.get(vertex.segment.wayId)?.feature ?? features.find(feature => feature.properties.entityType === 'way' && feature.properties.entityId === vertex.segment?.wayId);
      if (!current) continue;
      const inserts = wayUpdates.get(vertex.segment.wayId)?.inserts ?? 0;
      const updated = insertNodeIntoFeature(current, vertex.nodeId, vertex.coordinate, vertex.segment.segmentIndex + inserts);
      wayUpdates.set(vertex.segment.wayId, { feature: updated, inserts: inserts + 1 });
    }
    for (const update of wayUpdates.values()) mutations.push({ key: entityKey(update.feature), feature: update.feature });
    const wayId = String(nextWayIdRef.current--);
    const way = makeWayFeature(wayId, vertices.map(vertex => ({ coordinate: vertex.coordinate, nodeId: vertex.nodeId })), drawMode);
    mutations.push({ key: `way/${wayId}`, feature: way });
    replaceFeatures(mutations, drawMode === 'area' ? 'Vẽ vùng mới' : 'Vẽ đường mới');
    handleSelectFeature(way);
    setDrawVertices([]);
    setDrawMode('select');
  }, [drawMode, drawVertices, features, handleSelectFeature, replaceFeatures]);

  const selectedCategory = useMemo(() => selected ? categoryFor(selected.tags) : '', [selected]);
  const selectedName = selected?.tags.name || `${selected?.type ?? ''} ${selected?.id ?? ''}`.trim();
  const graphLoadStatus = useMemo(() => {
    if (loading) return 'Đang tải graph…';
    if (error) return `Không thể tải graph: ${error}`;
    if (!graphVisible) return `Graph hiển thị từ zoom ${GRAPH_MIN_ZOOM} (hiện Z ${pointerStatus.zoom.toFixed(1)})`;
    if (!features.length) return 'Không có đối tượng trong vùng đang xem';
    return `${features.length.toLocaleString('vi-VN')} đối tượng${changeCount ? ` · ${changeCount} thay đổi` : ''}`;
  }, [changeCount, error, features.length, graphVisible, loading, pointerStatus.zoom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;
      if (drawMode !== 'select' && event.key === 'Escape') {
        event.preventDefault();
        handleCancelDrawing();
        return;
      }
      if ((drawMode === 'line' || drawMode === 'area') && event.key === 'Enter') {
        event.preventDefault();
        handleFinishDrawing();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey && canUndo) {
        event.preventDefault();
        undo();
      }
      if ((key === 'y' || (key === 'z' && event.shiftKey)) && canRedo) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canRedo, canUndo, drawMode, handleCancelDrawing, handleFinishDrawing, redo, undo]);

  return (
    <Box sx={{ height: '100dvh', display: 'grid', gridTemplateRows: '58px minmax(0, 1fr) 34px', overflow: 'hidden', bgcolor: '#edf0f3' }}>
      <CssBaseline />
      <GlobalStyles styles={{
        '*': { boxSizing: 'border-box' },
        '.maplibregl-ctrl-group': { borderRadius: '7px !important', boxShadow: '0 2px 8px rgba(25, 32, 39, .22) !important', overflow: 'hidden' },
        '.maplibregl-ctrl button': { width: '34px !important', height: '34px !important' }
      }} />

      <AppBar position="static" elevation={0} sx={{ bgcolor: '#a51f38', color: 'common.white', borderBottom: '1px solid rgba(0, 0, 0, .18)' }}>
        <Toolbar variant="dense" sx={{ minHeight: '58px !important', px: 1.5, gap: 1.25 }}>
          <Box sx={{ width: 34, height: 34, display: 'grid', placeItems: 'center', bgcolor: 'rgba(255,255,255,.16)', borderRadius: 1.5, fontWeight: 900 }}>G</Box>
          <Box sx={{ minWidth: 174 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 15, letterSpacing: .7, lineHeight: 1.15 }}>GEODATA WEBGIS</Typography>
            <Typography sx={{ fontSize: 10, opacity: .78, letterSpacing: .45 }}>CANONICAL MAP EDITOR</Typography>
          </Box>
          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,.25)', my: 1.25 }} />
          <Stack direction="row" sx={{ alignItems: 'center', gap: .75, minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, opacity: .75 }}>Dữ liệu</Typography>
            <Typography noWrap sx={{ fontWeight: 700, fontSize: 13 }}>vietnam-260901</Typography>
            <Chip label="Canonical" size="small" sx={{ height: 21, bgcolor: 'rgba(255,255,255,.16)', color: 'inherit', fontWeight: 700, '& .MuiChip-label': { px: 1 } }} />
          </Stack>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
            <Typography sx={{ fontSize: 12, opacity: .88 }}>{graphLoadStatus}</Typography>
            <Tooltip title={saveStatus ?? 'Lưu thay đổi vào Canonical DB'}>
              <span>
                <Button
                  size="small"
                  variant="contained"
                  disabled={saving || (!changeCount && !pendingCloseId)}
                  onClick={() => void handleSave()}
                  sx={{ minWidth: 82, bgcolor: '#ffffff', color: '#951b32', fontSize: 11, fontWeight: 800, '&:hover': { bgcolor: '#f8e6e9' }, '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,.25)', color: 'rgba(255,255,255,.6)' } }}
                >
                  {saving ? 'Đang lưu…' : pendingCloseId ? 'Đóng lại' : `Lưu${changeCount ? ` (${changeCount})` : ''}`}
                </Button>
              </span>
            </Tooltip>
            <Badge color="error" badgeContent={error ? '!' : 0} overlap="circular"><Box sx={{ width: 29, height: 29, display: 'grid', placeItems: 'center', borderRadius: '50%', bgcolor: 'rgba(255,255,255,.15)', fontSize: 12, fontWeight: 800 }}>AD</Box></Badge>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <Box sx={{ display: 'none' }}>
          <Box sx={{ p: 1.5, borderBottom: '1px solid #e4e7eb' }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}>
              <Typography sx={{ color: '#7d172a', fontSize: 11, fontWeight: 800, letterSpacing: .8 }}>CÔNG CỤ BẢN ĐỒ</Typography>
              <Tooltip title="Thu gọn thanh công cụ"><IconButton size="small" onClick={() => setToolsOpen(false)}>{glyph('‹')}</IconButton></Tooltip>
            </Stack>
            <Paper variant="outlined" sx={{ borderColor: '#ead3d8', bgcolor: '#fffafa', p: .9 }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: .85 }}>
                <Box sx={{ width: 31, height: 31, display: 'grid', placeItems: 'center', borderRadius: 1, bgcolor: '#f4dfe3', color: '#a51f38' }}>{glyph('⌖', 16)}</Box>
                <Box sx={{ minWidth: 0 }}><Typography noWrap sx={{ fontWeight: 800, fontSize: 12 }}>vietnam-260901</Typography><Typography sx={{ color: 'text.secondary', fontSize: 10.5 }}>Canonical database</Typography></Box>
              </Stack>
            </Paper>
          </Box>

          <Box sx={{ px: 1.5, py: 1.25 }}>
            <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', gap: .75, px: 1, py: .35, borderColor: '#d7dde3', bgcolor: '#fafbfc' }}>
              {glyph('⌕', 16)}
              <InputBase disabled placeholder="Tìm đối tượng hoặc địa điểm" inputProps={{ 'aria-label': 'Tìm đối tượng hoặc địa điểm' }} sx={{ flex: 1, fontSize: 12 }} />
            </Paper>
          </Box>

          <Box sx={{ px: 1.25 }}>
            <Typography sx={{ px: .5, mb: .5, color: '#7d172a', fontSize: 10.5, fontWeight: 800, letterSpacing: .8 }}>CHỈNH SỬA</Typography>
            <List disablePadding sx={{ display: 'grid', gap: .25 }}>
              <ListItemButton selected={drawMode === 'select'} onClick={() => activateDrawMode('select')} sx={{ borderRadius: 1.25, '&.Mui-selected': { bgcolor: '#f9e7ea', color: '#981a31' }, '&.Mui-selected:hover': { bgcolor: '#f4dce1' } }}>
                <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}>{glyph('⌖')}</ListItemIcon><ListItemText primary={<Typography sx={{ fontSize: 13, fontWeight: 700 }}>Chọn & kiểm tra</Typography>} />
              </ListItemButton>
              <ListItemButton selected={drawMode === 'line'} onClick={() => activateDrawMode('line')} sx={{ borderRadius: 1.25, '&.Mui-selected': { bgcolor: '#f9e7ea', color: '#981a31' } }}><ListItemIcon sx={{ minWidth: 34 }}>{glyph('╱')}</ListItemIcon><ListItemText primary={<Typography sx={{ fontSize: 13, fontWeight: 600 }}>Vẽ đường</Typography>} secondary={<Typography sx={{ fontSize: 10 }}>Click node · Enter để kết thúc</Typography>} /></ListItemButton>
              <ListItemButton selected={drawMode === 'area'} onClick={() => activateDrawMode('area')} sx={{ borderRadius: 1.25, '&.Mui-selected': { bgcolor: '#f9e7ea', color: '#981a31' } }}><ListItemIcon sx={{ minWidth: 34 }}>{glyph('▱')}</ListItemIcon><ListItemText primary={<Typography sx={{ fontSize: 13, fontWeight: 600 }}>Vẽ vùng</Typography>} secondary={<Typography sx={{ fontSize: 10 }}>Click điểm đầu để khép vùng</Typography>} /></ListItemButton>
              <ListItemButton selected={drawMode === 'point'} onClick={() => activateDrawMode('point')} sx={{ borderRadius: 1.25, '&.Mui-selected': { bgcolor: '#f9e7ea', color: '#981a31' } }}><ListItemIcon sx={{ minWidth: 34 }}>{glyph('●')}</ListItemIcon><ListItemText primary={<Typography sx={{ fontSize: 13, fontWeight: 600 }}>Thêm điểm</Typography>} secondary={<Typography sx={{ fontSize: 10 }}>Click để đặt điểm</Typography>} /></ListItemButton>
            </List>
          </Box>

          <Divider sx={{ my: 1.5 }} />
          <Box sx={{ px: 1.75 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}><Typography sx={{ color: '#7d172a', fontSize: 10.5, fontWeight: 800, letterSpacing: .8 }}>LỚP DỮ LIỆU</Typography><Typography sx={{ color: '#8c97a3', fontSize: 11 }}>4 lớp</Typography></Stack>
            <Stack sx={{ gap: .9 }}>
              {[
                ['#e59630', 'Giao thông', 'way'], ['#7a8ea2', 'Công trình', 'area'], ['#d05762', 'Điểm quan tâm', 'node'], ['#8b6ea7', 'Ranh giới', 'relation']
              ].map(([color, label, type]) => <Stack key={label} direction="row" sx={{ alignItems: 'center', gap: .9 }}><Box sx={{ width: 9, height: 9, borderRadius: type === 'node' ? '50%' : .5, bgcolor: color }} /><Typography sx={{ flex: 1, fontSize: 12.5 }}>{label}</Typography><Typography sx={{ color: '#8c97a3', fontSize: 11 }}>{type}</Typography></Stack>)}
            </Stack>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Box sx={{ m: 1.25, p: 1.1, borderRadius: 1.5, bgcolor: '#f8f9fa', border: '1px solid #e4e7eb' }}><Typography sx={{ fontSize: 10.5, color: 'text.secondary' }}>Mẹo: click lên đối tượng để mở bảng thuộc tính.</Typography></Box>
        </Box>

        <Box sx={{ position: 'relative', minWidth: 0, flex: 1, overflow: 'hidden', bgcolor: '#d9e0e6' }}>
          {!toolsOpen && <Tooltip title="Mở thanh công cụ"><IconButton onClick={() => setToolsOpen(true)} sx={{ position: 'absolute', zIndex: 3, top: 14, left: 14, bgcolor: 'background.paper', color: '#981a31', boxShadow: '0 2px 8px rgba(20,30,40,.22)', '&:hover': { bgcolor: '#f9e7ea' } }}>{glyph('☰')}</IconButton></Tooltip>}
          <Paper elevation={3} sx={{ position: 'absolute', zIndex: 2, top: 14, left: toolsOpen ? 14 : 66, display: 'flex', p: .45, borderRadius: 1.5 }}>
            <ToolButton active={drawMode === 'select'} label="Chọn & kiểm tra" symbol="⌖" onClick={() => activateDrawMode('select')} />
            <Divider orientation="vertical" flexItem sx={{ mx: .45 }} />
            <ToolButton active={drawMode === 'line'} label="Vẽ đường" symbol="╱" onClick={() => activateDrawMode('line')} />
            <ToolButton active={drawMode === 'area'} label="Vẽ vùng" symbol="▱" onClick={() => activateDrawMode('area')} />
            <ToolButton active={drawMode === 'point'} label="Thêm điểm" symbol="●" onClick={() => activateDrawMode('point')} />
            <Divider orientation="vertical" flexItem sx={{ mx: .45 }} />
            <ToolButton disabled={!canUndo} label="Hoàn tác" symbol="↶" onClick={undo} />
            <ToolButton disabled={!canRedo} label="Làm lại" symbol="↷" onClick={redo} />
          </Paper>
          {saveStatus && <Paper elevation={3} sx={{ position: 'absolute', zIndex: 3, left: 14, bottom: 14, display: 'flex', alignItems: 'center', gap: 1, maxWidth: 440, px: 1.25, py: .9, borderLeft: '4px solid #a51f38' }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{saveStatus}</Typography>
            <IconButton aria-label="Đóng thông báo lưu" size="small" onClick={() => setSaveStatus(null)}>{glyph('×', 15)}</IconButton>
          </Paper>}
          <MapCanvas features={graphVisible ? features : []} drawMode={drawMode} drawVertices={drawVertices} selected={selected} onBoundsChange={refreshGraph} onSelect={handleSelectFeature} onDrawVertex={handleDrawVertex} onFinishDrawing={handleFinishDrawing} onCancelDrawing={handleCancelDrawing} onMoveNode={handleMoveNode} onPointerStatus={handlePointerStatus} />
          <Paper elevation={2} sx={{ position: 'absolute', zIndex: 2, right: 14, bottom: 14, px: 1.25, py: .9, minWidth: 235, borderLeft: '4px solid #a51f38' }}>
            <Typography sx={{ color: '#a51f38', fontSize: 10, fontWeight: 800, letterSpacing: .7 }}>VỊ TRÍ CON TRỎ</Typography>
            <Stack direction="row" sx={{ alignItems: 'end', justifyContent: 'space-between', mt: .45, gap: 1 }}>
              <Box><Typography sx={{ fontSize: 12.5, fontWeight: 800 }}>{Math.abs(pointerStatus.latitude).toFixed(5)}° {pointerStatus.latitude >= 0 ? 'N' : 'S'}</Typography><Typography sx={{ color: 'text.secondary', fontSize: 11.5 }}>{Math.abs(pointerStatus.longitude).toFixed(5)}° {pointerStatus.longitude >= 0 ? 'E' : 'W'}</Typography></Box>
              <Box sx={{ pl: 1, borderLeft: '1px solid #e1e5e8' }}><Typography sx={{ color: 'text.secondary', fontSize: 9.5, fontWeight: 800, letterSpacing: .6 }}>ZOOM</Typography><Typography sx={{ color: '#8c172c', fontSize: 14, fontWeight: 800 }}>Z {pointerStatus.zoom.toFixed(1)}</Typography></Box>
            </Stack>
          </Paper>
        </Box>

        {selected && propertiesOpen && <Paper square sx={{ width: propertiesWidth, overflow: 'auto', borderLeft: '1px solid #d9dfe5', bgcolor: '#fff' }}>
          <Box sx={{ p: 2, bgcolor: '#fffafa', borderBottom: '1px solid #eadce0' }}>
            <Stack direction="row" sx={{ alignItems: 'start', justifyContent: 'space-between', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}><Typography sx={{ color: '#9a1b32', fontSize: 10.5, fontWeight: 800, letterSpacing: .8 }}>{selected.type.toUpperCase()} · OSM #{selected.id}</Typography><Typography noWrap sx={{ mt: .45, fontSize: 17, fontWeight: 800 }}>{selectedName}</Typography><Typography sx={{ mt: .25, color: 'text.secondary', fontSize: 11 }}>Version {selected.version}</Typography></Box>
              <Tooltip title="Đóng thuộc tính"><IconButton size="small" onClick={() => setPropertiesOpen(false)}>{glyph('×')}</IconButton></Tooltip>
            </Stack>
          </Box>
          <Box sx={{ display: 'none' }}>
            <Typography sx={{ color: '#7d172a', fontSize: 10.5, fontWeight: 800, letterSpacing: .8 }}>THỂ LOẠI ĐỐI TƯỢNG</Typography>
            <Chip label={selectedCategory} sx={{ mt: 1, bgcolor: '#f7e4e7', color: '#941a30', fontWeight: 700 }} />
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}><Typography sx={{ color: '#7d172a', fontSize: 10.5, fontWeight: 800, letterSpacing: .8 }}>THUỘC TÍNH OSM</Typography><Chip label={`${Object.keys(selected.tags).length} tags`} size="small" variant="outlined" /></Stack>
            <Stack sx={{ gap: .75 }}>
              {Object.entries(selected.tags).length ? Object.entries(selected.tags).map(([key, value]) => <Paper key={key} variant="outlined" sx={{ p: 1, borderColor: '#e0e4e8', boxShadow: 'none' }}><Typography sx={{ color: '#8a96a3', fontSize: 10.5, fontWeight: 700 }}>{key}</Typography><Typography sx={{ mt: .2, fontSize: 13 }}>{value}</Typography></Paper>) : <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>Đối tượng chưa có thuộc tính.</Typography>}
            </Stack>
            <Button fullWidth disabled variant="outlined" sx={{ mt: 2, borderColor: '#d9b0b8' }}>Chỉnh sửa thuộc tính · sắp có</Button>
          </Box>
          <PropertiesEditor selected={selected} category={selectedCategory} onUpdate={handleUpdateTags} />
        </Paper>}
        {selected && !propertiesOpen && <Tooltip title="Mở thuộc tính"><IconButton onClick={() => setPropertiesOpen(true)} sx={{ position: 'absolute', zIndex: 3, top: 14, right: 14, bgcolor: 'background.paper', color: '#981a31', boxShadow: '0 2px 8px rgba(20,30,40,.22)', '&:hover': { bgcolor: '#f9e7ea' } }}>{glyph('›')}</IconButton></Tooltip>}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, bgcolor: '#29323a', color: '#eff2f5', borderTop: '1px solid #1d242a' }}>
        <Box sx={{ width: 8, height: 8, mr: .85, borderRadius: '50%', bgcolor: error ? '#ed6675' : '#6fc890' }} />
        <Typography sx={{ fontSize: 11 }}>{error ? error : changeCount ? `${changeCount} thay đổi chưa lưu` : 'Canonical graph · sẵn sàng kiểm tra'}</Typography>
        <Box sx={{ flex: 1 }} />
        {changeCount > 0 && <Stack direction="row" sx={{ alignItems: 'center', gap: .5, mr: 1 }}>
          <Button size="small" onClick={undo} disabled={!canUndo} sx={{ minWidth: 0, px: .75, color: '#ffffff', fontSize: 10.5 }}>Hoàn tác</Button>
          <Button size="small" onClick={redo} disabled={!canRedo} sx={{ minWidth: 0, px: .75, color: '#ffffff', fontSize: 10.5 }}>Làm lại</Button>
          <Button size="small" onClick={discardChanges} sx={{ minWidth: 0, px: .75, color: '#ffc5ce', fontSize: 10.5 }}>Bỏ thay đổi</Button>
        </Stack>}
        <Typography sx={{ fontSize: 11, opacity: .78 }}>WebGIS Editor · React + TypeScript</Typography>
      </Box>
    </Box>
  );
}
