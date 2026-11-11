import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Autocomplete,
  AppBar,
  Box,
  Button,
  Chip,
  Collapse,
  CssBaseline,
  Divider,
  IconButton,
  InputBase,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tab,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tabs,
  Toolbar,
  Tooltip,
  Typography
} from '@mui/material';
import { ArrowDown, ArrowUp, Banknote, Building2, BusFront, ChevronDown, ChevronRight, CirclePlus, Clipboard, Copy, Crosshair, Files, Fuel, GraduationCap, Hospital, Hotel, Info, Landmark, MapPin, MousePointer2, Network, Pentagon, Redo2, Route, Scissors, ShoppingBag, Spline, Trash2, TreePine, Undo2, Utensils, Waves, X, type LucideIcon } from 'lucide-react';
import { closeChangeset, createChangeset, ChangesetApiError, rollbackChangeset, toUploadChanges, uploadChangeset } from './api/changeset';
import { DATASET_NAME, loadGraph } from './api/graph';
import { loadPublishStatus, type PublishStatus } from './api/publish';
import { loadDatasets, type DatasetInfo } from './api/datasets';
import { DatasetManagerDialog } from './features/editor/DatasetManagerDialog';
import { EditorStoreProvider, entityKey, pendingChanges, type CommandResult, type EditorChange, type FeatureMutation, useEditorStore } from './features/editor/EditorStore';
import { insertNodeIntoFeature, makeNodeFeature, type DrawMode, type SnappedVertex } from './features/editor/drawing';
import { planDrawing, type WayExtension } from './features/editor/drawingTransactions';
import { placementOffset } from './features/editor/duplicateFeatures';
import { captureGeometry, cutGeometry, pasteGeometry, type GeometryClipboard } from './features/editor/geometryClipboard';
import { TopologyTools } from './features/editor/TopologyTools';
import { GeometryToolsDialog, geometryToolGroups, type GeometryToolGroup, type GeometryToolRequest } from './features/editor/GeometryToolsDialog';
import type { GeometryOptions } from './features/editor/geometryOperations';
import { planGeometryCommand, reservePlannedIds, inspectMutations, type GeometryCommandPlan } from './features/editor/geometryCommandPlan';
import { CommandImpactDialog, type PendingMutation } from './features/editor/CommandImpactDialog';
import { geometryLayer } from './features/editor/geometryLocks';
import { summarizeGeometryImpact } from './features/editor/geometryToolPresentation';
import { GeometryLocksDialog } from './features/editor/GeometryLocksDialog';
import { groupSelectionFeatures, planDeleteSelection } from './features/editor/selectionCommands';
import { useDraftProtection } from './features/editor/useDraftProtection';
import { nextTemporaryIds } from './features/editor/drafts';
import { Layers, LockKeyhole } from 'lucide-react';
import { closeWay, disconnectVertex, isOpenWay, mergeFeatures, openWay, removeVertex, reverseFeature, splitFeature, wayVertices, type TopologyAction } from './features/editor/topologyOperations';
import { findEditorIssues, type EditorIssue } from './features/editor/issues';
import { ConflictDialog, type ConflictSession } from './features/editor/ConflictDialog';
import { ChangesetHistoryDialog } from './features/editor/ChangesetHistoryDialog';
import { loadEntitySnapshots } from './api/conflicts';
import { snapshotKeys, type ResolutionPlan } from './features/editor/conflictResolution';
import {
  applyPreset,
  geometryForPreset,
  PRESET_GROUPS,
  PRESETS,
  presetForTags,
  presetValidationErrors,
  type Preset
} from './features/editor/presets';
import { OSM_TAG_OPTIONS, type OsmTagOption } from './features/editor/tagCatalog';
import { MapCanvas, type MapPointerStatus, type MapViewport } from './features/map/MapCanvas';
import { ViewportGraphLoader } from './features/map/ViewportGraphLoader';
import { GRAPH_MIN_ZOOM } from './features/map/graphRendering';
import { resolvePointIcon, type PointIconName } from './features/map/styleRules';
import { WorkspaceNavigation } from './shared/WorkspaceNavigation';
import type { Coordinate, EntityType, GraphFeature, RelationMember, SelectedEntity, Tags } from './types/osm';

const propertiesWidth = 360;
const CHANGESET_COMMENT = 'Chỉnh sửa từ Geodata WebGIS';
const EMPTY_GRAPH: GraphFeature[] = [];

// User input is latitude,longitude; MapLibre receives longitude,latitude.
function parseLatLon(value: string): Coordinate | null {
  const parts = value.trim().split(/[\s,;]+/);
  if (parts.length !== 2) return null;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return [longitude, latitude];
}

function presetErrorsForChanges(changes: EditorChange[]): string[] {
  return changes.flatMap(change => {
    if (!change.after) return [];
    const feature = change.after;
    const preset = presetForTags(feature.properties.tags, geometryForPreset(feature.geometry, feature.properties.entityType));
    return presetValidationErrors(feature.properties.tags, preset).map(error => `${change.key}: ${error}`);
  });
}

function featureTypePalette(preset?: Preset) {
  if (preset?.group === 'waterway' || preset?.group === 'water-area') return { background: '#0f556b', border: '#4fc3ca', divider: '#277184', icon: '#9be8ea' };
  if (preset?.group === 'transport') {
    return preset.matchTags.highway === 'primary' || preset.matchTags.highway === 'trunk'
      ? { background: '#766018', border: '#f2c94c', divider: '#90782b', icon: '#ffe89a' }
      : { background: '#704923', border: '#f2994a', divider: '#8d6035', icon: '#ffd0a1' };
  }
  if (preset?.group === 'landuse') return { background: '#245c43', border: '#72c58a', divider: '#397457', icon: '#b9f1c8' };
  if (preset?.group === 'boundary') return { background: '#63385e', border: '#d58ad0', divider: '#7a4d74', icon: '#f2b8ed' };
  return { background: '#684a31', border: '#c8a07a', divider: '#805f44', icon: '#f2d0ab' };
}

const presetPointIcons = {
  generic: MapPin,
  hotel: Hotel,
  school: GraduationCap,
  hospital: Hospital,
  shop: ShoppingBag,
  food: Utensils,
  fuel: Fuel,
  bus: BusFront,
  tree: TreePine,
  atm: Banknote,
  landmark: Landmark
} satisfies Record<PointIconName, LucideIcon>;

function featureTypeIcon(preset?: Preset): LucideIcon {
  if (!preset) return MapPin;

  const pointIcon = resolvePointIcon(preset.matchTags);
  if (pointIcon !== 'generic') return presetPointIcons[pointIcon];

  const tags = preset.matchTags;
  if (tags.waterway || tags.natural === 'water' || tags.water) return Waves;
  if (tags.highway || tags.railway) return Route;
  if (tags.building) return Building2;
  if (tags.landuse === 'forest' || tags.natural === 'wood' || tags.natural === 'tree' || tags.leisure === 'park') return TreePine;
  if (tags.boundary || tags.type === 'boundary') return Landmark;
  return MapPin;
}

function FeatureTypeGlyph({ preset }: { preset?: Preset }) {
  const palette = featureTypePalette(preset);
  const Icon = featureTypeIcon(preset);
  return (
    <Box sx={{ width: 76, alignSelf: 'stretch', display: 'grid', placeItems: 'center', borderRight: '1px solid #e2e6eb', bgcolor: '#f5f2e9' }} aria-hidden="true">
      <Icon size={42} color={palette.background} strokeWidth={1.8} />
    </Box>
  );
}

function coordinatesOfWay(way: GraphFeature): Coordinate[] | null {
  if (way.geometry.type === 'LineString') return way.geometry.coordinates.map(([longitude, latitude]) => [longitude, latitude]);
  if (way.geometry.type === 'Polygon') {
    const ring = way.geometry.coordinates[0];
    return ring ? ring.map(([longitude, latitude]) => [longitude, latitude]) : null;
  }
  return null;
}

function relationAnchor(geometry: SelectedEntity['geometry']): Coordinate {
  if (geometry.type === 'Point') return geometry.coordinates;
  const coordinates = geometry.type === 'Polygon' ? geometry.coordinates[0] ?? [] : geometry.coordinates;
  if (!coordinates.length) return [0, 0];
  const [longitude, latitude] = coordinates.reduce<[number, number]>((total, coordinate) => [total[0] + coordinate[0], total[1] + coordinate[1]], [0, 0]);
  return [longitude / coordinates.length, latitude / coordinates.length];
}

function collectionMemberFeatures(feature: GraphFeature, features: GraphFeature[]): GraphFeature[] {
  return groupSelectionFeatures(feature, features);
}

function duplicateOffset(features: GraphFeature[]): Coordinate {
  const coordinates = features.flatMap(feature => feature.geometry.type === 'Point'
    ? [feature.geometry.coordinates]
    : feature.geometry.type === 'LineString'
      ? feature.geometry.coordinates
      : feature.geometry.coordinates[0] ?? []);
  const latitude = coordinates.length ? coordinates.reduce((total, coordinate) => total + coordinate[1], 0) / coordinates.length : 0;
  const metres = 8;
  return [metres / (111_320 * Math.max(Math.cos(latitude * Math.PI / 180), 0.2)), metres / 110_540];
}

interface RelationMemberValidation {
  summary: string[];
  members: Map<number, string>;
}

function validateRelationMembers(tags: Tags, members: RelationMember[]): RelationMemberValidation {
  const problems = new Map<number, string>();
  const summary: string[] = [];
  const relationType = tags.type;
  if (relationType === 'multipolygon') {
    let outerCount = 0;
    const usedWays = new Set<string>();
    members.forEach((member, index) => {
      const role = member.role.trim();
      if (member.type !== 'way') problems.set(index, 'Multipolygon chỉ nhận member kiểu way.');
      if (role !== '' && role !== 'outer' && role !== 'inner') problems.set(index, 'Role multipolygon chỉ có outer hoặc inner.');
      if (role !== 'inner') outerCount += 1;
      if (usedWays.has(member.ref)) problems.set(index, `Way ${member.ref} đã xuất hiện trong quan hệ.`);
      usedWays.add(member.ref);
    });
    if (!outerCount) summary.push('Multipolygon cần ít nhất một way outer.');
  }
  if (relationType === 'route') {
    const allowedRoles = new Set(['', 'forward', 'backward', 'alternate', 'stop', 'platform', 'stop_entry_only', 'stop_exit_only', 'platform_entry_only', 'platform_exit_only']);
    let routeWayCount = 0;
    members.forEach((member, index) => {
      const role = member.role.trim();
      if (!allowedRoles.has(role)) problems.set(index, 'Role route không hợp lệ.');
      if (['forward', 'backward', 'alternate'].includes(role) && member.type !== 'way') problems.set(index, `Role ${role} phải tham chiếu way.`);
      if (member.type === 'way' && !['stop', 'platform', 'stop_entry_only', 'stop_exit_only', 'platform_entry_only', 'platform_exit_only'].includes(role)) routeWayCount += 1;
    });
    if (!routeWayCount) summary.push('Route cần ít nhất một way làm tuyến đường.');
  }
  return { summary, members: problems };
}

function relationRolePlaceholder(type: string | undefined) {
  if (type === 'multipolygon') return 'outer hoặc inner';
  if (type === 'route') return 'forward, stop, platform…';
  return 'Vai trò (không bắt buộc)';
}

function RelationMembersEditor({
  selected,
  onUpdate
}: {
  selected: SelectedEntity;
  onUpdate: (members: RelationMember[], label: string) => void;
}) {
  const [members, setMembers] = useState<RelationMember[]>(selected.members ?? []);
  const [newType, setNewType] = useState<EntityType>('way');
  const [newRef, setNewRef] = useState('');
  const [newRole, setNewRole] = useState('');
  const relationIdentity = `relation/${selected.id}`;
  const normalize = useCallback((items: RelationMember[]) => items.map((member, sequence) => ({ ...member, sequence })), []);
  const validation = useMemo(() => validateRelationMembers(selected.tags, members), [members, selected.tags]);

  useEffect(() => {
    setMembers(normalize(selected.members ?? []));
    setNewRef('');
    setNewRole('');
  }, [normalize, relationIdentity, selected.members]);

  const commit = useCallback((next: RelationMember[], label: string) => {
    const normalized = normalize(next);
    setMembers(normalized);
    onUpdate(normalized, label);
  }, [normalize, onUpdate]);

  const updateMember = (index: number, patch: Partial<RelationMember>) => {
    const next = members.map((member, memberIndex) => memberIndex === index ? { ...member, ...patch } : member);
    commit(next, 'Cập nhật thành viên quan hệ');
  };

  const addMember = () => {
    const ref = newRef.trim();
    if (!/^\d+$/.test(ref) && !/^-\d+$/.test(ref)) return;
    if (newType === 'relation' && ref === selected.id) return;
    commit([...members, { type: newType, ref, role: newRole.trim(), sequence: members.length }], 'Thêm thành viên vào quan hệ');
    setNewRef('');
    setNewRole('');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ color: '#681626', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase' }}>
          Thành viên quan hệ
        </Typography>
        <Chip label={`${members.length} thành viên`} size="small" sx={{ height: 22, fontSize: 11, fontWeight: 600, bgcolor: '#f1edff', color: '#5b21b6' }} />
      </Stack>

      {validation.summary.map(problem => (
        <Paper key={problem} sx={{ px: 1, py: 0.75, bgcolor: '#fff1f2', border: '1px solid #fecdd3', color: '#b4233c', fontSize: 12 }}>
          {problem}
        </Paper>
      ))}

      {members.map((member, index) => (
        <Paper key={`${member.type}/${member.ref}/${index}`} variant="outlined" sx={{ p: 0.75, borderRadius: 1.5, borderColor: validation.members.has(index) ? '#fda4af' : '#ddd6fe', bgcolor: validation.members.has(index) ? '#fff7f7' : '#fbfaff' }}>
          <Stack direction="row" sx={{ gap: 0.5, alignItems: 'center', mb: 0.6 }}>
            <Typography sx={{ minWidth: 20, color: '#7c3aed', fontSize: 11, fontWeight: 800 }}>{index + 1}</Typography>
            <TextField select size="small" value={member.type} onChange={event => updateMember(index, { type: event.target.value as EntityType })} sx={{ width: 94 }}>
              <MenuItem value="node">Node</MenuItem>
              <MenuItem value="way">Way</MenuItem>
              <MenuItem value="relation">Relation</MenuItem>
            </TextField>
            <TextField size="small" value={member.ref} onChange={event => updateMember(index, { ref: event.target.value })} slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `ID thành viên ${index + 1}` } }} sx={{ flex: 1, minWidth: 0 }} />
            <Tooltip title="Đưa lên">
              <span><IconButton size="small" disabled={index === 0} onClick={() => { const next = [...members]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; commit(next, 'Đổi thứ tự thành viên quan hệ'); }} aria-label={`Đưa thành viên ${index + 1} lên`}><ArrowUp size={16} aria-hidden="true" /></IconButton></span>
            </Tooltip>
            <Tooltip title="Đưa xuống">
              <span><IconButton size="small" disabled={index === members.length - 1} onClick={() => { const next = [...members]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; commit(next, 'Đổi thứ tự thành viên quan hệ'); }} aria-label={`Đưa thành viên ${index + 1} xuống`}><ArrowDown size={16} aria-hidden="true" /></IconButton></span>
            </Tooltip>
            <Tooltip title="Xóa thành viên">
              <IconButton size="small" aria-label={`Xóa thành viên ${index + 1}`} onClick={() => commit(members.filter((_member, memberIndex) => memberIndex !== index), 'Xóa thành viên khỏi quan hệ')} sx={{ color: '#94a3b8', '&:hover': { color: '#dc2626', bgcolor: '#fee2e2' } }}><X size={16} aria-hidden="true" /></IconButton>
            </Tooltip>
          </Stack>
          <TextField fullWidth size="small" label="Vai trò (role)" placeholder={relationRolePlaceholder(selected.tags.type)} value={member.role} onChange={event => updateMember(index, { role: event.target.value })} />
          {validation.members.has(index) && <Typography sx={{ mt: 0.55, color: '#b4233c', fontSize: 11 }}>{validation.members.get(index)}</Typography>}
        </Paper>
      ))}

      <Paper variant="outlined" sx={{ p: 1, borderRadius: 1.5, borderStyle: 'dashed', borderColor: '#c4b5fd', bgcolor: '#faf9ff' }}>
        <Typography sx={{ mb: 0.75, fontSize: 11, fontWeight: 700, color: '#6d28d9' }}>Thêm thành viên</Typography>
        <Stack direction="row" sx={{ gap: 0.5 }}>
          <TextField select size="small" value={newType} onChange={event => setNewType(event.target.value as EntityType)} sx={{ width: 94 }}>
            <MenuItem value="node">Node</MenuItem>
            <MenuItem value="way">Way</MenuItem>
            <MenuItem value="relation">Relation</MenuItem>
          </TextField>
          <TextField size="small" placeholder="ID" value={newRef} onChange={event => setNewRef(event.target.value)} slotProps={{ htmlInput: { inputMode: 'numeric' } }} sx={{ flex: 1, minWidth: 0 }} />
        </Stack>
        <Stack direction="row" sx={{ mt: 0.5, gap: 0.5 }}>
          <TextField size="small" placeholder={relationRolePlaceholder(selected.tags.type)} value={newRole} onChange={event => setNewRole(event.target.value)} sx={{ flex: 1 }} />
          <Button size="small" variant="contained" onClick={addMember} sx={{ bgcolor: '#7c3aed', textTransform: 'none', '&:hover': { bgcolor: '#6d28d9' } }}>Thêm</Button>
        </Stack>
      </Paper>

      {(selected.parents?.length ?? 0) > 0 && (
        <Box>
          <Typography sx={{ mt: 0.5, mb: 0.65, color: '#681626', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase' }}>Quan hệ cha</Typography>
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
            {selected.parents?.map(parent => (
              <Chip key={parent.id} label={parent.tags.name || 'Quan hệ cha chưa đặt tên'} size="small" sx={{ bgcolor: '#f1edff', color: '#5b21b6', fontWeight: 600 }} />
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
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

function PropertiesEditor({
  selected,
  onUpdate,
  onDelete,
  onDraftTags,
  onUpdateMembers
}: {
  selected: SelectedEntity;
  onUpdate: (tags: Tags, label: string) => void;
  onDelete: () => void;
  onDraftTags: (key: string, tags: Tags) => void;
  onUpdateMembers: (members: RelationMember[], label: string) => void;
}) {
  const [draftTags, setDraftTags] = useState<Tags>(selected.tags);
  const [newTagKey, setNewTagKey] = useState('');
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const [presetQuery, setPresetQuery] = useState('');
  const selectedIdentity = `${selected.type}/${selected.id}`;

  useEffect(() => {
    setDraftTags(selected.tags);
    setNewTagKey('');
    setPresetPickerOpen(false);
    setPresetQuery('');
  }, [selectedIdentity, selected.tags]);

  const commit = useCallback((label = 'Cập nhật thuộc tính') => {
    if (JSON.stringify(draftTags) !== JSON.stringify(selected.tags)) {
      onUpdate(draftTags, label);
    }
  }, [draftTags, onUpdate, selected.tags]);

  const updateValue = (key: string, value: string) => {
    const next = { ...draftTags, [key]: value }; setDraftTags(next); onDraftTags(selectedIdentity, next);
  };

  const removeTag = (key: string) => {
    setDraftTags(tags => {
      const next = { ...tags };
      delete next[key];
      onUpdate(next, `Xóa thuộc tính ${key}`);
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
    onUpdate(next, `Thêm thuộc tính ${key}`);
  };

  const geometry = geometryForPreset(selected.geometry, selected.type);
  const availablePresets = PRESETS.filter(preset => preset.geometry.includes(geometry));
  const normalizedPresetQuery = presetQuery.trim().toLocaleLowerCase('vi');
  const menuPresets = normalizedPresetQuery
    ? availablePresets.filter(preset => [preset.label, preset.sourceId, ...Object.entries(preset.matchTags).map(([key, value]) => `${key}=${value}`)]
      .some(value => value?.toLocaleLowerCase('vi').includes(normalizedPresetQuery)))
    : availablePresets;
  const activePreset = presetForTags(draftTags, geometry);
  const presetPalette = featureTypePalette(activePreset);
  const presetGroupLabel = PRESET_GROUPS.find(group => group.id === activePreset?.group)?.label;
  const formFields = activePreset?.fields ?? [{ key: 'name', label: 'Tên', type: 'text' as const, placeholder: 'Tên phổ biến hoặc chính thức' }];
  const activeFieldKeys = new Set([
    ...(activePreset ? Object.keys(activePreset.matchTags) : []),
    ...formFields.map(field => field.key)
  ]);
  const advancedTagEntries = Object.entries(draftTags).filter(([key]) => !activeFieldKeys.has(key));

  const updateAndCommit = (key: string, value: string, label: string) => {
    const next = { ...draftTags };
    if (value) next[key] = value;
    else delete next[key];
    setDraftTags(next);
    onUpdate(next, label);
  };

  const choosePreset = (preset: Preset) => {
    const next = applyPreset(draftTags, activePreset, preset);
    setDraftTags(next);
    setPresetPickerOpen(false);
    onUpdate(next, `Chọn thể loại ${preset.label}`);
  };

  const clearPreset = () => {
    if (!activePreset) return;
    const next = { ...draftTags };
    for (const [key, value] of Object.entries(activePreset.matchTags)) {
      if (next[key] === value) delete next[key];
    }
    setDraftTags(next);
    setPresetPickerOpen(false);
    onUpdate(next, `Bỏ thể loại ${activePreset.label}`);
  };

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Feature type / OSM preset */}
      <Box>
        <Typography sx={{ color: '#681626', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', mb: 0.8 }}>
          Thể loại đối tượng
        </Typography>
        <Paper
          component="button"
          type="button"
          disabled={!availablePresets.length}
          onClick={() => setPresetPickerOpen(open => !open)}
          aria-expanded={presetPickerOpen}
          aria-controls="preset-picker"
          sx={{
            p: 0,
            width: '100%',
            minHeight: 78,
            display: 'flex',
            overflow: 'hidden',
            textAlign: 'left',
            color: '#252c2b',
            bgcolor: '#ffffff',
            border: '1px solid #dce1e7',
            borderRadius: 1.5,
            cursor: availablePresets.length ? 'pointer' : 'not-allowed',
            transition: 'border-color .15s ease, transform .15s ease',
            '&:hover': availablePresets.length ? { borderColor: presetPalette.border, transform: 'translateY(-1px)', bgcolor: '#f5f2e9' } : {},
            '&:focus-visible': { outline: `2px solid ${presetPalette.border}`, outlineOffset: 2 }
          }}
        >
          <FeatureTypeGlyph preset={activePreset} />
          <Box sx={{ minWidth: 0, flex: 1, px: 1.5, py: 1.1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography sx={{ color: '#252c2b', fontSize: 14, fontWeight: 800 }}>
              {activePreset?.label ?? (availablePresets.length ? 'Chọn thể loại' : 'Không có thể loại phù hợp')}
            </Typography>
            {activePreset && (
              <Typography noWrap sx={{ mt: 0.35, color: '#626a63', fontSize: 11 }}>
                {presetGroupLabel}
              </Typography>
            )}
          </Box>
          <Box sx={{ width: 39, display: 'grid', placeItems: 'center', borderLeft: '1px solid #e2e6eb', color: '#626a63' }} aria-hidden="true"><ChevronDown size={18} /></Box>
          <Tooltip title={activePreset ? 'Nhấn để thay đổi thể loại' : 'Chọn thể loại cho đối tượng'}>
            <Box component="span" sx={{ width: 39, display: 'grid', placeItems: 'center', borderLeft: '1px solid #e2e6eb', color: '#626a63' }} aria-hidden="true"><Info size={16} /></Box>
          </Tooltip>
        </Paper>
        <Collapse in={presetPickerOpen} timeout={160} unmountOnExit>
          <Paper
            id="preset-picker"
            variant="outlined"
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setPresetPickerOpen(false);
              }
            }}
            sx={{ mt: 0.75, overflow: 'hidden', borderColor: '#d9c3c8', borderRadius: 1.5, bgcolor: '#ffffff' }}
          >
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1.25, py: 0.75, borderBottom: '1px solid #e8d7db' }}>
              <Typography sx={{ color: '#475569', fontSize: 12, fontWeight: 700 }}>
                Chọn thể loại
              </Typography>
              <Button
                size="small"
                disabled={!activePreset}
                onClick={clearPreset}
                sx={{ minWidth: 0, px: 0.75, py: 0.25, color: '#8d1b31', fontSize: 11, fontWeight: 800, textTransform: 'none' }}
              >
                Chưa phân loại
              </Button>
            </Stack>
            <Box sx={{ px: 1.25, py: 1 }}>
              <TextField
                autoFocus
                fullWidth
                size="small"
                value={presetQuery}
                onChange={event => setPresetQuery(event.target.value)}
                placeholder="Tìm thể loại hoặc tag"
                slotProps={{ htmlInput: { 'aria-label': 'Tìm thể loại đối tượng' } }}
              />
            </Box>
            <Box sx={{ maxHeight: { xs: 208, md: 264 }, overflowY: 'auto', pb: 0.5 }}>
              {PRESET_GROUPS.flatMap(group => {
                const groupPresets = menuPresets.filter(preset => preset.group === group.id);
                return groupPresets.length
                  ? [
                      <ListSubheader key={`${group.id}-header`} disableSticky sx={{ bgcolor: 'transparent', color: '#626a63', fontSize: 11, fontWeight: 800, lineHeight: '28px' }}>
                        {group.label}
                      </ListSubheader>,
                      ...groupPresets.map(preset => {
                        const isActive = preset.id === activePreset?.id;
                        return (
                          <Button
                            key={preset.id}
                            fullWidth
                            aria-pressed={isActive}
                            onClick={() => choosePreset(preset)}
                            sx={{
                              minHeight: 36,
                              mx: 0.5,
                              width: 'calc(100% - 8px)',
                              justifyContent: 'flex-start',
                              borderRadius: 1,
                              color: isActive ? '#7d172a' : '#252c2b',
                              bgcolor: isActive ? '#f7e9ec' : 'transparent',
                              fontSize: 13,
                              fontWeight: isActive ? 800 : 500,
                              textAlign: 'left',
                              textTransform: 'none',
                              '&:hover': { bgcolor: isActive ? '#f3d8de' : '#f5f2e9' },
                              '&:focus-visible': { outline: '2px solid #8b2235', outlineOffset: -2 }
                            }}
                          >
                            {preset.label}
                          </Button>
                        );
                      })
                    ]
                  : [];
              })}
              {menuPresets.length === 0 && (
                <Typography sx={{ px: 1.5, py: 1.25, color: '#626a63', fontSize: 12 }}>
                  Không tìm thấy thể loại phù hợp.
                </Typography>
              )}
            </Box>
          </Paper>
        </Collapse>
      </Box>

      {selected.type === 'relation' && (
        <>
          <Divider sx={{ my: 0.5, borderColor: '#ebd7db' }} />
          <RelationMembersEditor selected={selected} onUpdate={onUpdateMembers} />
        </>
      )}

      <Divider sx={{ my: 0.5, borderColor: '#ebd7db' }} />

      {/* Fields supplied by the selected preset. */}
      <Box>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.2 }}>
          <Typography sx={{ color: '#681626', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase' }}>
            Thuộc tính
          </Typography>
          <Chip
            label={activePreset ? activePreset.label : 'Thuộc tính chung'}
            size="small"
            sx={{ height: 22, fontSize: 11, fontWeight: 600, bgcolor: '#fcfbf7' }}
          />
        </Stack>

        <Stack sx={{ gap: 1 }}>
          {formFields.map(field => {
            const value = draftTags[field.key] ?? '';
            const options = field.options ?? [];
            const choiceOptions = [{ value: '', label: 'Chưa rõ' }, ...options];
            const isSegmented = field.type === 'yesno' || (field.type === 'select' && options.length <= 4);

            if (isSegmented) {
              return (
                <Paper
                  key={field.key}
                  variant="outlined"
                  sx={{
                    p: 1.25,
                    borderRadius: 2,
                    borderColor: value ? '#d9c3c8' : '#dbe3ea',
                    bgcolor: '#ffffff',
                    transition: 'border-color 160ms ease, box-shadow 160ms ease',
                    '&:focus-within': { borderColor: '#8b2235', boxShadow: '0 0 0 3px rgba(155, 25, 46, 0.12)' }
                  }}
                >
                  <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 1 }}>
                    <Box>
                      <Typography sx={{ color: '#252c2b', fontSize: 13, fontWeight: 800 }}>
                        {field.label}{field.required ? ' *' : ''}
                      </Typography>
                      <Typography sx={{ mt: 0.2, color: '#626a63', fontSize: 10.5 }}>
                        {field.type === 'yesno' ? 'Chọn trạng thái của đối tượng' : `${options.length} lựa chọn`}
                      </Typography>
                    </Box>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={value}
                      aria-label={field.label}
                      onChange={(_event, nextValue: string | null) => {
                        if (nextValue !== null) updateAndCommit(field.key, nextValue, `Cập nhật ${field.label}`);
                      }}
                      sx={{
                        alignSelf: { xs: 'stretch', sm: 'auto' },
                        '& .MuiToggleButton-root': {
                          minHeight: 44,
                          px: 1.1,
                          color: '#475569',
                          fontSize: 11,
                          fontWeight: 800,
                          textTransform: 'none',
                          borderColor: '#d8e0e7'
                        },
                        '& .Mui-selected': { bgcolor: '#fff1f2 !important', color: '#8b2235 !important', borderColor: '#d49aa4 !important' }
                      }}
                    >
                      {choiceOptions.map(option => <ToggleButton key={option.value || 'unknown'} value={option.value}>{option.label}</ToggleButton>)}
                    </ToggleButtonGroup>
                  </Stack>
                </Paper>
              );
            }

            if (field.type === 'select') {
              const selectedOption = choiceOptions.find(option => option.value === value) ?? (value ? { value, label: value } : choiceOptions[0]);
              return (
                <Autocomplete
                  key={field.key}
                  fullWidth
                  disableClearable
                  options={choiceOptions}
                  value={selectedOption}
                  isOptionEqualToValue={(option, candidate) => option.value === candidate.value}
                  getOptionLabel={option => option.label}
                  onChange={(_event, option) => updateAndCommit(field.key, option?.value ?? '', `Cập nhật ${field.label}`)}
                  renderInput={params => (
                    <TextField
                      {...params}
                      required={field.required}
                      label={field.label}
                      placeholder="Tìm hoặc chọn giá trị"
                      helperText="Gõ để lọc các giá trị có sẵn"
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, bgcolor: '#ffffff' } }}
                    />
                  )}
                />
              );
            }

            return (
              <Paper
                key={field.key}
                component="label"
                variant="outlined"
                sx={{
                  display: 'block',
                  p: 1.25,
                  borderRadius: 2,
                  borderColor: value ? '#d9c3c8' : '#dbe3ea',
                  bgcolor: '#ffffff',
                  cursor: 'text',
                  transition: 'border-color 160ms ease, box-shadow 160ms ease',
                  '&:focus-within': { borderColor: '#8b2235', boxShadow: '0 0 0 3px rgba(155, 25, 46, 0.12)' }
                }}
              >
                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography sx={{ color: '#475569', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3 }}>
                    {field.label}{field.required ? ' *' : ''}
                  </Typography>
                  <Typography sx={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 9.5 }}>{field.key}</Typography>
                </Stack>
                <InputBase
                  fullWidth
                  type={field.type === 'number' ? 'number' : 'text'}
                  placeholder={field.placeholder}
                  value={value}
                  onChange={event => updateValue(field.key, event.target.value)}
                  onBlur={() => commit(`Cập nhật ${field.label}`)}
                  inputProps={{ min: field.type === 'number' ? 0 : undefined, 'aria-label': field.label }}
                  sx={{ mt: 0.25, color: '#252c2b', fontSize: 16, fontWeight: 650, '& input': { py: 0.15 } }}
                />
              </Paper>
            );
          })}
        </Stack>
      </Box>

      {/* Tags not represented by the selected preset stay fully editable. */}
      <Box>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.2 }}>
          <Typography sx={{ color: '#681626', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase' }}>
            Thẻ nâng cao
          </Typography>
          <Chip
            label={`${advancedTagEntries.length} thẻ`}
            size="small"
            sx={{ height: 22, fontSize: 11, fontWeight: 600, bgcolor: '#fcfbf7' }}
          />
        </Stack>

        <Stack sx={{ gap: 1 }}>
          {advancedTagEntries.map(([key, value]) => (
            <Paper
              key={key}
              variant="outlined"
              sx={{
                p: 0.75,
                borderRadius: 1.5,
                borderColor: '#e2e6eb',
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                bgcolor: '#fafbfc'
              }}
            >
              <TextField
                size="small"
                value={key}
                slotProps={{
                  htmlInput: {
                    readOnly: true,
                    'aria-label': `Khóa ${key}`,
                    style: { padding: '4px 8px', fontSize: 12, fontFamily: 'monospace', fontWeight: 600, color: '#475569' }
                  }
                }}
                sx={{
                  width: 120,
                  bgcolor: '#ffffff',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#dce1e7' }
                }}
              />
              <TextField
                size="small"
                value={value}
                onChange={event => updateValue(key, event.target.value)}
                onBlur={() => commit(`Cập nhật thuộc tính ${key}`)}
                slotProps={{
                  htmlInput: {
                    'aria-label': `Giá trị ${key}`,
                    style: { padding: '4px 8px', fontSize: 12 }
                  }
                }}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  bgcolor: '#ffffff',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#dce1e7' }
                }}
              />
              <Tooltip title="Xóa thuộc tính">
                <IconButton
                  size="small"
                  onClick={() => removeTag(key)}
                  sx={{
                    color: '#94a3b8',
                    '&:hover': { color: '#dc2626', bgcolor: '#fee2e2' }
                  }}
                >
                  <X size={16} aria-hidden="true" />
                </IconButton>
              </Tooltip>
            </Paper>
          ))}
        </Stack>

        <Autocomplete
          freeSolo
          options={availableTagOptions}
          inputValue={newTagKey}
          value={null}
          onInputChange={(_event, value) => setNewTagKey(value)}
          onChange={(_event, option) => addTagOption(option)}
          getOptionLabel={option => (typeof option === 'string' ? option : `${option.label} (${option.key})`)}
          isOptionEqualToValue={(option, value) =>
            typeof option !== 'string' && typeof value !== 'string' && option.key === value.key
          }
          renderOption={(props, option) => (
            <li {...props} key={option.key}>
              <Box sx={{ py: 0.5 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#252c2b' }}>{option.label}</Typography>
                <Typography sx={{ color: '#626a63', fontFamily: 'monospace', fontSize: 11 }}>
                  {option.key} · {option.description}
                </Typography>
              </Box>
            </li>
          )}
          renderInput={params => (
            <TextField
              {...params}
              size="small"
              placeholder="+ Thêm thuộc tính mới..."
              sx={{
                mt: 1.5,
                '& .MuiOutlinedInput-root': { borderRadius: 1.5, bgcolor: '#ffffff' }
              }}
            />
          )}
        />
      </Box>

      {/* Action: Delete Feature */}
      <Box sx={{ mt: 1, pt: 1.5, borderTop: '1px solid #ebd7db' }}>
        <Button
          fullWidth
          variant="outlined"
          color="error"
          onClick={onDelete}
          sx={{
            borderRadius: 1.5,
            py: 0.75,
            fontSize: 12,
            fontWeight: 700,
            borderColor: '#fca5a5',
            color: '#b91c1c',
            bgcolor: '#fff5f5',
            '&:hover': {
              borderColor: '#ef4444',
              bgcolor: '#fee2e2'
            }
          }}
        >
          Xóa đối tượng này
        </Button>
        <Typography sx={{ mt: 1, color: '#626a63', fontSize: 11, textAlign: 'center' }}>
          Các thay đổi sẽ được áp dụng khi nhấn nút Lưu trên thanh công cụ.
        </Typography>
      </Box>
    </Box>
  );
}

export default function App() {
  const [dataset, setDataset] = useState<DatasetInfo | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadDatasets(controller.signal).then(datasets => {
      if (controller.signal.aborted) return;
      const requested = new URLSearchParams(window.location.search).get('dataset');
      const chosen = datasets.find(item => item.name === (requested ?? DATASET_NAME)) ?? (requested ? undefined : datasets[0]);
      if (requested && !chosen) throw new Error('Dataset trong URL chưa sẵn sàng hoặc không tồn tại. Bỏ tham số dataset để mở dữ liệu mặc định.');
      setDataset(chosen ?? { id: DATASET_NAME, name: DATASET_NAME, bounds: null, state: 'ready', canonicalRevision: 0, renderRevision: 0 });
    }).catch(reason => { if (!controller.signal.aborted) setBootError(reason instanceof Error ? reason.message : 'Không tải được danh sách dataset.'); });
    return () => controller.abort();
  }, []);
  const openDataset = (next: DatasetInfo) => {
    const url = new URL(window.location.href); url.searchParams.set('dataset', next.name); window.history.replaceState(null, '', url);
    setDataset(next);
  };
  if (!dataset) return <Box sx={{ p: 4 }}><Typography>{bootError ?? 'Đang kết nối dữ liệu…'}</Typography>{bootError && <Button onClick={() => window.location.reload()}>Thử lại sau khi khởi động lại API</Button>}</Box>;
  return (
    <EditorStoreProvider key={dataset.id}>
      <EditorShell dataset={dataset} onOpenDataset={openDataset} />
    </EditorStoreProvider>
  );
}

function EditorShell({ dataset, onOpenDataset }: { dataset: DatasetInfo; onOpenDataset: (dataset: DatasetInfo) => void }) {
  const [datasetManagerOpen, setDatasetManagerOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'topology'>('properties');
  const [issuesOpen, setIssuesOpen] = useState(true);
  const [graphVisible, setGraphVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conflictSession, setConflictSession] = useState<ConflictSession | null>(null);
  const writeBusyRef = useRef(false);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [coordinateAnchor, setCoordinateAnchor] = useState<HTMLElement | null>(null);
  const [coordinateInput, setCoordinateInput] = useState('');
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const [selectionMenuPosition, setSelectionMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [geometryToolGroup, setGeometryToolGroup] = useState<GeometryToolGroup | null>(null);
  const [geometryPreview, setGeometryPreview] = useState<GeometryCommandPlan | null>(null);
  const [undoOfferId, setUndoOfferId] = useState<number | null>(null);
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);
  const closeGeometryTool = useCallback(() => { setGeometryToolGroup(null); setGeometryPreview(null); }, []);
  const [locksOpen, setLocksOpen] = useState(false);
  const [geometryClipboard, setGeometryClipboard] = useState<GeometryClipboard | null>(null);
  const pasteCountRef = useRef(0);
  const mapPointerRef = useRef<Coordinate | null>(null);
  const handlePointerCoordinate = useCallback((coordinate: Coordinate | null) => { mapPointerRef.current = coordinate; }, []);
  const [pinpoint, setPinpoint] = useState<Coordinate | null>(null);
  const [pointerStatus, setPointerStatus] = useState<MapPointerStatus>({ longitude: 104.50728, latitude: 21.59988, zoom: 16 });
  const [drawMode, setDrawMode] = useState<DrawMode>('select');
  const [drawVertices, setDrawVertices] = useState<SnappedVertex[]>([]);
  const [drawingExtension, setDrawingExtension] = useState<WayExtension | null>(null);
  const [draftCamera, setDraftCamera] = useState<MapViewport['camera']>();
  const [restoredCamera, setRestoredCamera] = useState<MapViewport['camera']>();
  const [pendingTags, setPendingTags] = useState<{ key: string; tags: Tags } | null>(null);
  const onDraftTags = useCallback((key: string, tags: Tags) => setPendingTags({ key, tags }), []);
  const workspaceToken = useMemo(() => ({}), [drawMode, drawVertices, drawingExtension, draftCamera, pendingTags]);
  const [selectedVertexId, setSelectedVertexId] = useState<string | null>(null);
  const entityRequestRef = useRef(0);
  const viewportRef = useRef<MapViewport | null>(null);
  const nextNodeIdRef = useRef(-1);
  const nextWayIdRef = useRef(-1);
  const nextRelationIdRef = useRef(-1);

  const {
    features,
    selected,
    selectedKey,
    selectedKeys,
    selectedFeatures,
    loading,
    error,
    changes,
    changeCount,
    canUndo,
    canRedo,
    hydrateGraph,
    hydrateSupport,
    resolveConflicts,
    setLoading,
    setError,
    selectFeature,
    updateTags,
    replaceFeature,
    replaceFeatures,
    undo,
    redo,
    discardChanges
  } = useEditorStore();
  const { protectedKeys, lockedKeys, lockedLayers, lockGeometry, unlockGeometry, remapGeometryLocks, getFeatures, getDraftState, selectFeatureSet: storeSelectFeatureSet } = useEditorStore();
  const inspectGeometryTool = useCallback((request: GeometryOptions) => planGeometryCommand(getDraftState(), getFeatures(), selectedKeys, request,
    { node: nextNodeIdRef.current, way: nextWayIdRef.current, relation: nextRelationIdRef.current }), [getDraftState, getFeatures, selectedKeys, features, lockedKeys, lockedLayers]);
  useEffect(() => {
    // The inspector also resets its text buffer whenever the selected baseline
    // changes. Do not resurrect an old buffer after Undo/Redo or a preset change.
    setPendingTags(null);
  }, [selectedKey, selected?.tags]);
  const draft = useDraftProtection({
    dataset: `${dataset.id}:${dataset.name}`, busy: saving || Boolean(pendingCloseId), unfinished: drawVertices.length > 0 || Boolean(pendingTags), pendingTags,
    workspaceToken,
    workspace: () => ({ mode: drawMode, vertices: drawVertices, extension: drawingExtension, camera: draftCamera, nextIds: { node: nextNodeIdRef.current, way: nextWayIdRef.current, relation: nextRelationIdRef.current } }),
    onRestore: (state, workspace) => {
      setPendingTags(null);
      const ids = nextTemporaryIds(state);
      nextNodeIdRef.current = Math.min(ids.node, workspace?.nextIds.node ?? -1); nextWayIdRef.current = Math.min(ids.way, workspace?.nextIds.way ?? -1); nextRelationIdRef.current = Math.min(ids.relation, workspace?.nextIds.relation ?? -1);
      if (workspace) {
        setDrawMode(workspace.mode); setDrawVertices(workspace.vertices); setDrawingExtension(workspace.extension);
        if (workspace.camera) { setRestoredCamera(workspace.camera); setDraftCamera(workspace.camera); }
      }
      const feature = Object.values(state.overrides).find(item => item && item.geometry.type === 'Point') ?? Object.values(state.baseFeatures).find(item => item.geometry.type === 'Point');
      if (!workspace?.camera && feature?.geometry.type === 'Point') setPinpoint(feature.geometry.coordinates);
      const restoredChanges = pendingChanges(state);
      const keys = snapshotKeys(restoredChanges);
      if (keys.length) return loadEntitySnapshots(keys, dataset.name).then(batch => {
        const mismatch = batch.snapshots.some(snapshot => {
          const base = state.baseFeatures[snapshot.key];
          return !snapshot.visible || snapshot.version !== base?.properties.version;
        });
        if (mismatch) { setConflictSession({ changes: restoredChanges, batch }); setSaveStatus('Bản server đã thay đổi. Hãy đối chiếu bản nháp trước khi lưu.'); }
      }).catch(() => setSaveStatus('Đã khôi phục nháp. Chưa kiểm tra được phiên bản server; hệ thống sẽ kiểm tra lại khi lưu.'));
    }
  });
  const acceptCommand = useCallback((result: CommandResult) => {
    if (result.status === 'applied') return true;
    setSaveStatus(result.status === 'blocked' ? result.message : 'Không có thay đổi nội dung; không tạo bước Undo hoặc dữ liệu chờ lưu.');
    return false;
  }, []);
  const commitInspectedMutation = useCallback((command: PendingMutation) => {
    const fresh = inspectMutations(getDraftState(), getFeatures(), command.keys, command.plan.mutations);
    if (fresh.status !== 'ready') throw new Error(fresh.reason ?? 'Không có thay đổi để áp dụng.');
    if (fresh.fingerprint !== command.plan.fingerprint) throw new Error('Dữ liệu hoặc khóa đã thay đổi. Hủy và thực hiện lại để kiểm tra phạm vi mới.');
    const result = replaceFeatures(fresh.mutations, command.label);
    if (result.status === 'blocked') throw new Error(result.message);
    if (!acceptCommand(result)) return;
    setPendingMutation(null); setSelectedVertexId(null); setSelectionMenuPosition(null);
    setUndoOfferId(getDraftState().undoStack.at(-1)?.id ?? null);
    setSaveStatus(fresh.impact.deleted ? `Đã xóa ${fresh.impact.deleted} entity trong bản nháp, 1 bước Undo.` : `Đã di chuyển ${fresh.impact.selected} lựa chọn, ${fresh.impact.changedNodes} node; ảnh hưởng ${fresh.impact.externalWays.length} đường/vùng và ${fresh.impact.externalRelations.length} relation ngoài lựa chọn.`);
  }, [acceptCommand, getDraftState, getFeatures, replaceFeatures]);
  const geometryImpact = useMemo(() => geometryToolGroup === 'transform' || geometryToolGroup === 'align'
    ? summarizeGeometryImpact(selectedKeys, features) : undefined, [features, geometryToolGroup, selectedKeys]);
  const isGeometryLocked = useCallback((type: EntityType, id: string, geometryType?: string) => {
    if (protectedKeys.has(`${type}/${id}`)) return true;
    const feature = features.find(item => entityKey(item) === `${type}/${id}`);
    if (feature) return lockedLayers.includes(geometryLayer(feature));
    return lockedLayers.includes(type === 'node' ? 'points' : type === 'relation' ? 'relations' : geometryType === 'Polygon' || geometryType === 'MultiPolygon' ? 'areas' : 'lines');
  }, [features, lockedLayers, protectedKeys]);

  const changedKeys = useMemo(() => new Set(changes.map(change => change.key)), [changes]);
  const issues = useMemo(() => findEditorIssues(features, changedKeys), [changedKeys, features]);
  const blockingIssues = useMemo(() => issues.filter(issue => issue.severity === 'error'), [issues]);

  const selectFeatureSet = useCallback((items: GraphFeature[], active: GraphFeature) => {
    const result = storeSelectFeatureSet(items, active);
    if (result.status === 'blocked') { setSaveStatus(result.message); return false; }
    return true;
  }, [storeSelectFeatureSet]);

  const refreshPublishStatus = useCallback(async () => {
    try {
      setPublishStatus(await loadPublishStatus(dataset.name));
    } catch {
      // Ignore background sync errors quietly
    }
  }, [dataset.name]);

  useEffect(() => {
    void refreshPublishStatus();
    const timer = window.setInterval(() => { void refreshPublishStatus(); }, 3_000);
    return () => window.clearInterval(timer);
  }, [refreshPublishStatus]);

  const graphLoader = useMemo(() => new ViewportGraphLoader({
    load: (bbox, signal, part) => loadGraph(bbox, signal, part, dataset.name), onFeatures: hydrateGraph, onRelations: hydrateSupport, onLoading: setLoading, onError: setError
  }), [dataset.name, hydrateGraph, hydrateSupport, setLoading, setError]);

  useEffect(() => () => { graphLoader.cancel(); entityRequestRef.current += 1; }, [graphLoader]);

  const refreshGraph = useCallback(({ bbox: viewport, zoom, camera }: MapViewport) => {
    viewportRef.current = { bbox: viewport, zoom };
    if (camera) setDraftCamera(previous => JSON.stringify(previous) === JSON.stringify(camera) ? previous : camera);
    const shouldShowGraph = zoom >= GRAPH_MIN_ZOOM;
    setGraphVisible(shouldShowGraph);
    if (!shouldShowGraph) {
      graphLoader.cancel();
      setError(null);
      return;
    }
    void graphLoader.refresh(viewport);
  }, [graphLoader, setError]);

  const handleSelectEntity = useCallback((type: SelectedEntity['type'], id: string, toggleSelection = false, selectOnly = false) => {
    const requestId = ++entityRequestRef.current;
    setError(null);
    // A tile click only needs this entity, not another full viewport query.
    void loadEntitySnapshots([`${type}/${id}`], dataset.name)
      .then(result => {
        if (requestId !== entityRequestRef.current) return;
        const feature = result.snapshots[0]?.feature;
        if (feature) {
          hydrateSupport([...result.support, feature]);
          const loaded = getFeatures();
          const groupMembers = !toggleSelection && !selectOnly ? collectionMemberFeatures(feature, loaded) : [];
          if (groupMembers.length) {
            if (!selectFeatureSet(groupMembers, groupMembers.find(item => entityKey(item) === entityKey(feature)) ?? groupMembers.at(-1)!)) return;
          }
          else selectFeature(feature, toggleSelection ? 'toggle' : 'replace');
          setPropertiesOpen(true);
        } else {
          setError('Đối tượng không còn nằm trong khu vực hiển thị.');
        }
      })
      .catch(reason => {
        if (requestId === entityRequestRef.current) setError(reason instanceof Error ? reason.message : 'Không thể tải đối tượng.');
      });
  }, [dataset.name, getFeatures, hydrateSupport, selectFeature, selectFeatureSet, setError]);

  const refreshAfterCommit = useCallback(() => {
    entityRequestRef.current += 1;
    graphLoader.invalidate();
    const viewport = viewportRef.current;
    if (viewport) refreshGraph(viewport);
  }, [graphLoader, refreshGraph]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) refreshGraph(viewport);
  }, [refreshGraph]);

  const retryCloseChangeset = useCallback(async (changesetId: string) => {
    if (writeBusyRef.current) return;
    writeBusyRef.current = true;
    setSaving(true);
    setSaveStatus('Đang hoàn tất lưu thay đổi…');
    try {
      await closeChangeset(changesetId);
      setPendingCloseId(null);
      setSaveStatus('Đã lưu thay đổi thành công.');
    } catch {
      setSaveStatus('Dữ liệu đã được lưu thành công.');
    } finally {
      writeBusyRef.current = false;
      setSaving(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (pendingMutation || geometryToolGroup || draft.blocked || saving || writeBusyRef.current || conflictSession || historyOpen || datasetManagerOpen) return;
    if (drawVertices.length) { setSaveStatus('Hãy hoàn tất hoặc hủy bản vẽ dở trước khi lưu vào hệ thống. Bản vẽ vẫn được lưu nháp trên máy.'); return; }
    if (pendingCloseId) {
      await retryCloseChangeset(pendingCloseId);
      return;
    }
    if (!changes.length) return;

    if (blockingIssues.length) {
      setIssuesOpen(true);
      setSaveStatus(`Chưa thể lưu: còn ${blockingIssues.length} lỗi dữ liệu cần xử lý.`);
      return;
    }

    const presetErrors = presetErrorsForChanges(changes);
    if (presetErrors.length) {
      setSaveStatus(`Chưa thể lưu: ${presetErrors[0]}`);
      return;
    }

    let uploadPayload: ReturnType<typeof toUploadChanges>;
    try {
      uploadPayload = toUploadChanges(changes);
    } catch (reason) {
      setSaveStatus(`Không thể chuẩn bị dữ liệu: ${reason instanceof Error ? reason.message : 'Dữ liệu không hợp lệ.'}`);
      return;
    }

    writeBusyRef.current = true;
    setSaving(true);
    setSaveStatus('Đang lưu dữ liệu...');
    let createdId: string | null = null;
    let uploadStarted = false;
    try {
      const created = await createChangeset(dataset.name, CHANGESET_COMMENT);
      createdId = created.id;
      await draft.prepareUpload(created.id);
      setSaveStatus(`Đang áp dụng ${uploadPayload.length} thay đổi…`);
      uploadStarted = true;
      const uploaded = await uploadChangeset(created.id, uploadPayload);
      remapGeometryLocks(Object.fromEntries((uploaded.diffResult ?? []).map(item => [`${item.type}/${item.oldId}`, `${item.type}/${item.newId}`])));
      draft.confirmedUpload();
      discardChanges();
      refreshAfterCommit();
      void refreshPublishStatus();
      try {
        await closeChangeset(created.id);
        setSaveStatus('Đã lưu các thay đổi thành công.');
      } catch {
        setPendingCloseId(created.id);
        setSaveStatus('Dữ liệu đã được lưu thành công.');
      }
    } catch (reason) {
      const definiteRejection = reason instanceof ChangesetApiError && reason.phase === 'upload' && reason.status >= 400 && reason.status < 500;
      if (uploadStarted && !definiteRejection) draft.suspendForRecovery();
      else draft.rejectedUpload();
      if (createdId && !uploadStarted) void closeChangeset(createdId).catch(() => undefined);
      const message = reason instanceof Error ? reason.message : 'Lỗi không xác định.';
      const prefix = reason instanceof ChangesetApiError
        ? reason.phase === 'create' ? 'Không thể khởi tạo phiên lưu' : 'Không thể tải lên thay đổi'
        : 'Không thể lưu thay đổi';
      setSaveStatus(`${prefix}: ${message}`);
      if (definiteRejection) {
        // An HTTP rejection rolled back the upload transaction. Close the empty
        // session; network failures are ambiguous and are not treated this way.
        if (createdId) void closeChangeset(createdId).catch(() => undefined);
        if (reason.status === 409 && reason.code === 'version_conflict') {
          try {
            const batch = await loadEntitySnapshots(snapshotKeys(changes), dataset.name);
            setConflictSession({ changes, batch });
            setSaveStatus('Có xung đột version. Bản nháp được giữ để so sánh và áp lại.');
          } catch (snapshotError) {
            setSaveStatus(`Bản nháp vẫn được giữ. Không tải được dữ liệu so sánh: ${snapshotError instanceof Error ? snapshotError.message : 'Lỗi kết nối.'}`);
          }
        }
      }
    } finally {
      writeBusyRef.current = false;
      setSaving(false);
    }
  }, [pendingMutation, geometryToolGroup, drawVertices.length, draft.blocked, draft.prepareUpload, draft.rejectedUpload, draft.confirmedUpload, draft.suspendForRecovery, blockingIssues.length, changes, conflictSession, dataset.name, datasetManagerOpen, discardChanges, historyOpen, pendingCloseId, refreshAfterCommit, refreshPublishStatus, remapGeometryLocks, retryCloseChangeset, saving]);

  const handleApplyConflictResolution = useCallback((plan: ResolutionPlan) => {
    if (plan.blockers.length) return;
    graphLoader.invalidate();
    entityRequestRef.current += 1;
    resolveConflicts(plan);
    setConflictSession(null);
    setSelectedVertexId(null);
    setLoading(false);
    setSaveStatus('Đã cập nhật preview trên bản server mới. Kiểm tra kết quả và bấm Lưu nếu còn thay đổi.');
  }, [graphLoader, resolveConflicts, setLoading]);

  const handleExport = useCallback((format: 'osm' | 'osc') => {
    setExportAnchor(null);
    const query = new URLSearchParams({ dataset: dataset.name });
    if (format === 'osm') {
      const viewport = viewportRef.current;
      if (!viewport) {
        setSaveStatus('Chờ bản đồ xác định vùng cần xuất.');
        return;
      }
      query.set('bbox', viewport.bbox.join(','));
      query.set('limit', '5000');
    }
    window.location.assign(`/api/export/${format}?${query.toString()}`);
  }, [dataset.name]);

  const handleLocateCoordinate = useCallback(() => {
    const coordinate = parseLatLon(coordinateInput);
    if (!coordinate) {
      setCoordinateError('Nhập theo mẫu vĩ độ,kinh độ; ví dụ: 20.409586,106.1704618.');
      return;
    }
    setCoordinateError(null);
    setPinpoint(coordinate);
    setCoordinateAnchor(null);
    setSaveStatus(`Đã định vị tại ${coordinate[1].toFixed(6)}, ${coordinate[0].toFixed(6)}.`);
  }, [coordinateInput]);

  const handleRollbackChangeset = useCallback(async (changesetId: string) => {
    if (saving || writeBusyRef.current) throw new Error('Đang có thao tác khác thực hiện.');
    if (changeCount || pendingCloseId || conflictSession) throw new Error('Hãy hoàn tất lưu hoặc bỏ bản nháp trước khi revert.');
    writeBusyRef.current = true;
    setExportAnchor(null);
    setSaving(true);
    setSaveStatus('Đang hoàn tác changeset…');
    try {
      const reverted = await rollbackChangeset(changesetId);
      setHistoryOpen(false);
      selectFeature(null);
      setSelectedVertexId(null);
      refreshAfterCommit();
      void refreshPublishStatus();
      setSaveStatus(`Đã revert changeset #${changesetId} bằng changeset mới #${reverted.id}.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Lỗi không xác định.';
      setSaveStatus(`Không thể hoàn tác: ${message}`);
      throw reason;
    } finally {
      writeBusyRef.current = false;
      setSaving(false);
    }
  }, [changeCount, conflictSession, pendingCloseId, refreshAfterCommit, refreshPublishStatus, saving, selectFeature]);

  const handleSelectFeature = useCallback((feature: GraphFeature | null, toggleSelection = false, selectOnly = false) => {
    entityRequestRef.current += 1;
    try {
      const groupMembers = feature && !toggleSelection && !selectOnly ? collectionMemberFeatures(feature, getFeatures()) : [];
      if (feature && groupMembers.length) {
        if (!selectFeatureSet(groupMembers, groupMembers.find(item => entityKey(item) === entityKey(feature)) ?? groupMembers.at(-1)!)) return;
      }
      else selectFeature(feature, toggleSelection ? 'toggle' : 'replace');
    } catch (reason) { setSaveStatus(reason instanceof Error ? reason.message : 'Chưa thể chọn đủ nhóm.'); return; }
    setSelectedVertexId(null);
    setSelectionMenuPosition(null);
    if (feature) setPropertiesOpen(true);
  }, [getFeatures, selectFeature, selectFeatureSet]);

  const handleSelectionContextMenu = useCallback((position: { top: number; left: number }) => {
    if (drawMode === 'select') setSelectionMenuPosition(position);
  }, [drawMode]);

  const handleSelectIssue = useCallback((issue: EditorIssue) => {
    const feature = features.find(item => entityKey(item) === issue.entityKey);
    if (!feature) return;
    handleSelectFeature(feature);
    setPinpoint(issue.coordinate);
  }, [features, handleSelectFeature]);

  const handleUpdateTags = useCallback((tags: Tags, label: string) => {
    if (selectedKey) acceptCommand(updateTags(selectedKey, tags, label));
  }, [acceptCommand, selectedKey, updateTags]);

  const handleUpdateRelationMembers = useCallback((members: RelationMember[], label: string) => {
    if (!selectedKey || selected?.type !== 'relation') return;
    const relation = features.find(feature => entityKey(feature) === selectedKey);
    if (!relation) return;
    acceptCommand(replaceFeature({ ...relation, properties: { ...relation.properties, members } }, selectedKey, label));
  }, [acceptCommand, features, replaceFeature, selected, selectedKey]);

  const collectionGroups = useMemo(() => {
    const keys = new Set(selectedKeys);
    return getFeatures().filter(feature => feature.properties.entityType === 'relation' && feature.properties.tags.type === 'collection'
      && (keys.has(entityKey(feature)) || feature.properties.members?.some(member => keys.has(`${member.type}/${member.ref}`))));
  }, [features, getFeatures, selectedKeys]);

  const handleCreateRelation = useCallback(() => {
    if (!selected) {
      setSaveStatus('Chọn node, way hoặc relation sẽ làm thành viên đầu tiên trước khi tạo quan hệ.');
      return;
    }
    const id = String(nextRelationIdRef.current--);
    const feature: GraphFeature = {
      type: 'Feature',
      id: `relation-${id}`,
      properties: {
        entityType: 'relation', entityId: id, version: 0, tags: {},
        members: [{ type: selected.type, ref: selected.id, role: '', sequence: 0 }]
      },
      geometry: { type: 'Point', coordinates: relationAnchor(selected.geometry) }
    };
    if (!acceptCommand(replaceFeature(feature, `relation/${id}`, 'Tạo quan hệ mới'))) return;
    selectFeature(feature);
    setPropertiesOpen(true);
  }, [acceptCommand, replaceFeature, selectFeature, selected]);

  const handleGroupSelected = useCallback(() => {
    const members = selectedFeatures.length ? selectedFeatures : selected ? [selected] : [];
    if (!members.length) return;
    const id = String(nextRelationIdRef.current--);
    const feature: GraphFeature = {
      type: 'Feature',
      id: `relation-${id}`,
      properties: {
        entityType: 'relation', entityId: id, version: 0, tags: { type: 'collection' },
        members: members.map((member, sequence) => ({ type: member.type, ref: member.id, role: '', sequence }))
      },
      geometry: { type: 'Point', coordinates: relationAnchor(members.at(-1)!.geometry) }
    };
    if (!acceptCommand(replaceFeature(feature, `relation/${id}`, 'Nhóm đối tượng'))) return;
    selectFeature(feature);
    setPropertiesOpen(true);
    setSelectionMenuPosition(null);
    setSaveStatus(`Đã tạo nhóm với ${members.length} đối tượng.`);
  }, [acceptCommand, replaceFeature, selectFeature, selected, selectedFeatures]);

  const handleUngroupSelected = useCallback(() => {
    if (!selectedKeys.length || !collectionGroups.length) return;
    const keys = new Set(selectedKeys);
    const mutations: FeatureMutation[] = collectionGroups.map(group => {
      if (keys.has(entityKey(group))) return { key: entityKey(group), feature: null };
      const members = (group.properties.members ?? [])
        .filter(member => !keys.has(`${member.type}/${member.ref}`))
        .map((member, sequence) => ({ ...member, sequence }));
      return { key: entityKey(group), feature: members.length ? { ...group, properties: { ...group.properties, members } } : null };
    });
    if (!acceptCommand(replaceFeatures(mutations, 'Bỏ đối tượng khỏi nhóm'))) return;
    setSelectionMenuPosition(null);
    setSaveStatus(`Đã bỏ nhóm cho lựa chọn; cập nhật ${collectionGroups.length} nhóm, giữ nguyên các đối tượng.`);
  }, [acceptCommand, collectionGroups, replaceFeatures, selectedKeys]);

  const handleDeleteSelected = useCallback(() => {
    if (saving || drawMode !== 'select' || !selectedKeys.length) return;
    try {
      const mutations = planDeleteSelection(selectedKeys, getFeatures());
      const plan = inspectMutations(getDraftState(), getFeatures(), selectedKeys, mutations);
      if (plan.status !== 'ready') { setSaveStatus(plan.reason); return; }
      const command = { label: 'Xóa các đối tượng đã chọn', plan, keys: [...selectedKeys] };
      if (plan.impact.deleted > 1 || mutations.some(item => item.key.startsWith('relation/'))) { setSelectionMenuPosition(null); setPendingMutation(command); }
      else commitInspectedMutation(command);
    } catch (reason) { setSaveStatus(reason instanceof Error ? reason.message : 'Không thể xóa lựa chọn.'); }
  }, [commitInspectedMutation, drawMode, getDraftState, getFeatures, saving, selectedKeys]);

  const handleDuplicateSelected = useCallback((target?: Coordinate) => {
    if (saving || drawMode !== 'select' || !selectedKeys.length) return;
    try {
      const snapshot = captureGeometry(selectedKeys, getFeatures());
      const result = pasteGeometry(snapshot, () => String(nextNodeIdRef.current--), () => String(nextWayIdRef.current--), () => String(nextRelationIdRef.current--),
        target ? placementOffset(snapshot.sources, target) : duplicateOffset(snapshot.sources));
      if (!acceptCommand(replaceFeatures(result.mutations, snapshot.groups.length ? 'Nhân bản nhóm/lựa chọn' : 'Nhân bản lựa chọn'))) return;
      const active = selectedKey ? result.copies.get(selectedKey) : undefined;
      selectFeatureSet(result.features, active && active.properties.entityType !== 'relation' ? active : result.features.at(-1)!);
      setSelectedVertexId(null);
      setPropertiesOpen(true);
      setSelectionMenuPosition(null);
      setSaveStatus(`Đã nhân bản ${result.features.length} đối tượng${snapshot.groups.length ? ` trong ${snapshot.groups.length} nhóm` : ''}${target ? ' tại vị trí con trỏ.' : ', lệch khoảng 8 m về đông bắc.'}`);
    } catch (reason) {
      setSaveStatus(reason instanceof Error ? reason.message : 'Không thể nhân bản đối tượng.');
    }
  }, [acceptCommand, drawMode, getFeatures, replaceFeatures, saving, selectedKey, selectedKeys, selectFeatureSet]);

  const handleCopySelection = useCallback((cut = false) => {
    if (saving || drawMode !== 'select' || !selectedKeys.length) return;
    try {
      const available = getFeatures();
      const snapshot = captureGeometry(selectedKeys, available);
      // Validate geometry before cutting anything out of the editor.
      let temporaryId = -1;
      pasteGeometry(snapshot, () => String(temporaryId--), () => String(temporaryId--), () => String(temporaryId--), [0, 0]);
      if (cut) {
        if (!acceptCommand(replaceFeatures(cutGeometry(snapshot, available), 'Cắt đối tượng'))) return;
        selectFeature(null);
      }
      setGeometryClipboard(snapshot);
      pasteCountRef.current = 0;
      setSelectionMenuPosition(null);
      setSaveStatus(`Đã ${cut ? 'cắt' : 'sao chép'} ${snapshot.sources.length} đối tượng. Nhấn Ctrl+V để dán.`);
    } catch (reason) {
      setSaveStatus(reason instanceof Error ? reason.message : 'Không thể sao chép đối tượng.');
    }
  }, [acceptCommand, drawMode, getFeatures, replaceFeatures, saving, selectFeature, selectedKeys]);

  const handlePasteSelection = useCallback((target?: Coordinate) => {
    if (saving || drawMode !== 'select' || !geometryClipboard) return;
    try {
      const count = pasteCountRef.current + 1;
      const offset = duplicateOffset(geometryClipboard.sources);
      const result = pasteGeometry(geometryClipboard,
        () => String(nextNodeIdRef.current--), () => String(nextWayIdRef.current--), () => String(nextRelationIdRef.current--),
        target ? placementOffset(geometryClipboard.sources, target) : [offset[0] * count, offset[1] * count]);
      if (!acceptCommand(replaceFeatures(result.mutations, 'Dán đối tượng'))) return;
      selectFeatureSet(result.features, result.features[0]);
      if (!target) pasteCountRef.current = count;
      setSelectedVertexId(null);
      setPropertiesOpen(true);
      setSelectionMenuPosition(null);
      setSaveStatus(target ? `Đã dán ${result.features.length} đối tượng tại vị trí con trỏ.`
        : `Đã dán ${result.features.length} đối tượng, lệch khoảng ${8 * count} m về đông bắc so với bản sao chép.`);
    } catch (reason) {
      setSaveStatus(reason instanceof Error ? reason.message : 'Không thể dán đối tượng.');
    }
  }, [acceptCommand, drawMode, geometryClipboard, replaceFeatures, saving, selectFeatureSet]);

  const handleMoveNode = useCallback((nodeId: string, coordinate: Coordinate) => {
    const features = getFeatures();
    const existingNode = features.find(feature => feature.properties.entityType === 'node' && feature.properties.entityId === nodeId);
    const sourceNode = features
      .filter(feature => feature.properties.entityType === 'way')
      .flatMap(feature => feature.properties.nodes ?? [])
      .find(node => node.id === nodeId);
    if (!existingNode && !sourceNode) return;
    const node: GraphFeature = existingNode
      ? { ...existingNode, properties: { ...existingNode.properties, coordinates: coordinate }, geometry: { type: 'Point', coordinates: coordinate } }
      : {
          type: 'Feature',
          id: `node-${nodeId}`,
          properties: { entityType: 'node', entityId: nodeId, version: sourceNode?.version ?? 1, tags: sourceNode?.tags ?? {}, coordinates: coordinate, topologyNode: true },
          geometry: { type: 'Point', coordinates: coordinate }
        };
    const mutations: FeatureMutation[] = [{ key: `node/${nodeId}`, feature: node }];
    for (const way of features) {
      if (way.properties.entityType === 'way' && way.properties.nodeIds?.includes(nodeId)) {
        mutations.push({ key: entityKey(way), feature: moveNodeInWay(way, nodeId, coordinate) });
      }
    }
    const keys = selectedKeys.length ? selectedKeys : [`node/${nodeId}`];
    const plan = inspectMutations(getDraftState(), features, keys, mutations);
    if (plan.status !== 'ready') { setSaveStatus(plan.reason); return; }
    const command = { label: 'Di chuyển điểm', plan, keys: [...keys] };
    if (plan.impact.externalWays.length || plan.impact.externalRelations.length) setPendingMutation(command);
    else { try { commitInspectedMutation(command); } catch (reason) { setSaveStatus(reason instanceof Error ? reason.message : 'Không thể di chuyển điểm.'); } }
  }, [commitInspectedMutation, getDraftState, getFeatures, selectedKeys]);

  const handleMoveFeatures = useCallback((keys: readonly string[], offset: Coordinate) => {
    if (!Number.isFinite(offset[0]) || !Number.isFinite(offset[1]) || (offset[0] === 0 && offset[1] === 0)) return;
    const features = getFeatures();
    const selectedKeys = new Set(keys);
    const selectedFeatures = features.filter(feature => (
      feature.properties.entityType !== 'relation' && selectedKeys.has(entityKey(feature))
    ));
    if (!selectedFeatures.length) return;

    // Resolve each node once. Moving the node and every referencing way in the
    // same mutation keeps shared topology connected after a feature translation.
    const movedNodes = new Map<string, Coordinate>();
    const sourceNodes = new Map<string, { version?: number; tags?: Tags }>();
    for (const feature of features) {
      if (feature.properties.entityType === 'node') {
        sourceNodes.set(feature.properties.entityId, { version: feature.properties.version, tags: feature.properties.tags });
      }
      if (feature.properties.entityType === 'way') {
        for (const node of feature.properties.nodes ?? []) {
          if (!sourceNodes.has(node.id)) sourceNodes.set(node.id, { version: node.version, tags: node.tags });
        }
      }
    }
    for (const feature of selectedFeatures) {
      if (feature.properties.entityType === 'node' && feature.geometry.type === 'Point') {
        movedNodes.set(feature.properties.entityId, [feature.geometry.coordinates[0] + offset[0], feature.geometry.coordinates[1] + offset[1]]);
        continue;
      }
      if (feature.properties.entityType !== 'way') continue;
      const coordinates = coordinatesOfWay(feature);
      for (let index = 0; index < (feature.properties.nodeIds?.length ?? 0); index += 1) {
        const nodeId = feature.properties.nodeIds?.[index];
        const coordinate = coordinates?.[index];
        if (nodeId && coordinate) movedNodes.set(nodeId, [coordinate[0] + offset[0], coordinate[1] + offset[1]]);
      }
    }
    if (!movedNodes.size) return;

    const mutations = new Map<string, FeatureMutation>();
    for (const [nodeId, coordinate] of movedNodes) {
      const existingNode = features.find(feature => feature.properties.entityType === 'node' && feature.properties.entityId === nodeId);
      const sourceNode = sourceNodes.get(nodeId);
      const node: GraphFeature = existingNode
        ? { ...existingNode, properties: { ...existingNode.properties, coordinates: coordinate }, geometry: { type: 'Point', coordinates: coordinate } }
        : {
            type: 'Feature', id: `node-${nodeId}`,
            properties: { entityType: 'node', entityId: nodeId, version: sourceNode?.version ?? 1, tags: sourceNode?.tags ?? {}, coordinates: coordinate, topologyNode: true },
            geometry: { type: 'Point', coordinates: coordinate }
          };
      mutations.set(`node/${nodeId}`, { key: `node/${nodeId}`, feature: node });
    }
    for (const way of features) {
      if (way.properties.entityType !== 'way' || !way.properties.nodeIds?.some(nodeId => movedNodes.has(nodeId))) continue;
      let movedWay = way;
      for (const [nodeId, coordinate] of movedNodes) movedWay = moveNodeInWay(movedWay, nodeId, coordinate);
      mutations.set(entityKey(way), { key: entityKey(way), feature: movedWay });
    }
    const plan = inspectMutations(getDraftState(), getFeatures(), keys, [...mutations.values()]);
    if (plan.status !== 'ready') { setSaveStatus(plan.reason); return; }
    const command = { label: selectedFeatures.length > 1 ? 'Di chuyển các đối tượng' : 'Di chuyển đối tượng', keys: [...keys], plan };
    if (plan.impact.externalWays.length || plan.impact.externalRelations.length) setPendingMutation(command);
    else { try { commitInspectedMutation(command); } catch (reason) { setSaveStatus(reason instanceof Error ? reason.message : 'Không thể di chuyển lựa chọn.'); } }
  }, [commitInspectedMutation, getDraftState, getFeatures]);

  const handlePointerStatus = useCallback((status: MapPointerStatus) => setPointerStatus(status), []);

  const activateDrawMode = useCallback((mode: DrawMode) => {
    setDrawVertices([]);
    setDrawingExtension(null);
    setDrawMode(mode);
  }, []);

  const handleCancelDrawing = useCallback(() => {
    setDrawVertices([]);
    setDrawingExtension(null);
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
    if (!acceptCommand(replaceFeatures(mutations, vertex.segment ? 'Nối điểm vào đường' : 'Thêm điểm mới'))) return;
    if (node) handleSelectFeature(node);
    setDrawMode('select');
  }, [acceptCommand, drawMode, features, handleSelectFeature, replaceFeatures]);

  const handleInsertVertex = useCallback((vertex: SnappedVertex) => {
    if (!vertex.segment) return;
    const way = features.find(feature => feature.properties.entityType === 'way' && feature.properties.entityId === vertex.segment?.wayId);
    if (!way) return;
    const nodeId = String(nextNodeIdRef.current--);
    try {
      const updatedWay = insertNodeIntoFeature(way, nodeId, vertex.coordinate, vertex.segment.segmentIndex);
      const node = makeNodeFeature(nodeId, vertex.coordinate);
      const committed = replaceFeatures([
        { key: `node/${nodeId}`, feature: node },
        { key: entityKey(way), feature: updatedWay }
      ], 'Thêm đỉnh vào way');
      if (!acceptCommand(committed)) return;
      handleSelectFeature(updatedWay);
      setSelectedVertexId(nodeId);
    } catch (reason) {
      setSaveStatus(reason instanceof Error ? reason.message : 'Không thể thêm đỉnh vào way.');
    }
  }, [acceptCommand, features, handleSelectFeature, replaceFeatures]);

  const selectedWay = useMemo(() => selected?.type === 'way'
    ? features.find(feature => feature.properties.entityType === 'way' && feature.properties.entityId === selected.id) ?? null
    : null, [features, selected]);

  const handleTopologyAction = useCallback((action: TopologyAction, otherWayId?: string) => {
    if (!selectedWay) return;
    const needsVertex = action === 'split' || action === 'disconnect' || action === 'remove-vertex';
    if (needsVertex && !selectedVertexId) return;
    try {
      const result = (() => {
        switch (action) {
          case 'split': return splitFeature(selectedWay, selectedVertexId!, String(nextWayIdRef.current--), features);
          case 'disconnect': return disconnectVertex(selectedWay, selectedVertexId!, String(nextNodeIdRef.current--));
          case 'remove-vertex': return removeVertex(selectedWay, selectedVertexId!);
          case 'reverse': return reverseFeature(selectedWay, features);
          case 'close': return closeWay(selectedWay);
          case 'open': return openWay(selectedWay);
          case 'merge': {
            const otherWay = features.find(feature => feature.properties.entityType === 'way' && feature.properties.entityId === otherWayId);
            if (!otherWay) throw new Error('Way cần nối không còn trong vùng dữ liệu đã tải.');
            return mergeFeatures(selectedWay, otherWay, features);
          }
        }
      })();
      const labels: Record<TopologyAction, string> = {
        split: 'Tách way',
        merge: 'Nối hai way',
        disconnect: 'Tách node khỏi way',
        reverse: 'Đảo chiều way',
        'remove-vertex': 'Xóa đỉnh khỏi way',
        close: 'Đóng way thành vùng',
        open: 'Mở vùng thành đường'
      };
      if (!acceptCommand(replaceFeatures(result.mutations, labels[action]))) return;
      handleSelectFeature(result.selected);
      setSelectedVertexId(result.vertexId ?? selectedVertexId);
    } catch (reason) {
      setSaveStatus(reason instanceof Error ? reason.message : 'Không thể thực hiện thao tác topology.');
    }
  }, [acceptCommand, features, handleSelectFeature, replaceFeatures, selectedVertexId, selectedWay]);

  const handleContinueWay = useCallback(() => {
    if (!selectedWay || !selectedVertexId || !isOpenWay(selectedWay)) return;
    try {
      const vertices = wayVertices(selectedWay);
      const endpoint = vertices.find(node => node.id === selectedVertexId);
      if (!endpoint || (vertices[0].id !== endpoint.id && vertices.at(-1)!.id !== endpoint.id)) {
        throw new Error('Hãy chọn endpoint của way để tiếp tục vẽ.');
      }

      setDrawVertices([{ nodeId: endpoint.id, coordinate: [...endpoint.coordinates] as Coordinate }]);
      setDrawingExtension({ key: entityKey(selectedWay), endpoint: endpoint.id });
      setDrawMode('line');
    } catch (reason) {
      setSaveStatus(reason instanceof Error ? reason.message : 'Không thể tiếp tục way.');
    }
  }, [selectedVertexId, selectedWay]);

  const handleFinishDrawing = useCallback(() => {
    if (drawMode !== 'line' && drawMode !== 'area') return;
    const minimum = drawMode === 'area' ? 3 : 2;
    if (drawVertices.length < minimum) return;
    try {
      const { way, mutations } = planDrawing(features, drawVertices, drawMode, () => String(nextWayIdRef.current--), drawingExtension);
      if (!acceptCommand(replaceFeatures(mutations, drawingExtension ? 'Tiếp tục way' : drawMode === 'area' ? 'Vẽ vùng mới' : 'Vẽ đường mới'))) return;
      handleSelectFeature(way);
      setDrawVertices([]);
      setDrawingExtension(null);
      setDrawMode('select');
    } catch (reason) {
      setSaveStatus(reason instanceof Error ? reason.message : 'Không thể hoàn tất way.');
    }
  }, [acceptCommand, drawMode, drawVertices, drawingExtension, features, handleSelectFeature, replaceFeatures]);

  const handleGeometryTool = useCallback((request: GeometryToolRequest, fingerprint?: string) => {
    if (saving || drawMode !== 'select') throw new Error('Chờ lưu hoàn tất và chuyển về chế độ chọn.');
    const available = getFeatures();
    selectedKeys.forEach(key => {
      const feature = available.find(item => entityKey(item) === key);
      if (!feature) throw new Error('Đối tượng chưa được tải đầy đủ. Hãy chọn lại trên bản đồ.');
    });
    if (request.operation === 'lock') {
      lockGeometry(request.layer ? [] : selectedKeys, request.layer ? [request.layer] : []);
      setSelectedVertexId(null);
      setSaveStatus('Đã khóa tạm. Mở Quản lý khóa trên bản đồ để tiếp tục chỉnh sửa.');
      return;
    }
    const plan = inspectGeometryTool(request);
    if (plan.status !== 'ready') throw new Error(plan.reason ?? 'Không có thay đổi để áp dụng.');
    if (!fingerprint || plan.fingerprint !== fingerprint) throw new Error('Dữ liệu hoặc phạm vi tác động đã thay đổi. Kiểm tra lại preview trước khi áp dụng.');
    const committed = replaceFeatures(plan.mutations, `Geometry: ${request.operation}`);
    if (committed.status === 'blocked') throw new Error(committed.message);
    if (!acceptCommand(committed)) return;
    const ids = reservePlannedIds(plan.mutations, { node: nextNodeIdRef.current, way: nextWayIdRef.current, relation: nextRelationIdRef.current });
    nextNodeIdRef.current = ids.node; nextWayIdRef.current = ids.way; nextRelationIdRef.current = ids.relation;
    if (plan.selected) selectFeature(plan.selected);
    setSelectedVertexId(null);
    setUndoOfferId(getDraftState().undoStack.at(-1)?.id ?? null);
    setSaveStatus(plan.selected ? `Đã tạo vùng kết quả (${plan.impact.created} entity), giữ nguyên vùng gốc.` : `Đã cập nhật ${plan.impact.changedNodes} node; ${plan.impact.externalWays.length} đường/vùng và ${plan.impact.externalRelations.length} relation ngoài lựa chọn bị ảnh hưởng. ${committed.status === 'applied' ? committed.changedKeys.length : 0} entity thay đổi trong 1 bước Undo.`);
  }, [acceptCommand, drawMode, getFeatures, getDraftState, inspectGeometryTool, lockGeometry, replaceFeatures, saving, selectFeature, selectedKeys]);

  const selectedName = selected?.tags.name || (selected ? (selected.type === 'node' ? 'Điểm chưa đặt tên' : selected.type === 'way' ? 'Đường/Vùng chưa đặt tên' : 'Quan hệ chưa đặt tên') : '');

  const syncStatusText = useMemo(() => {
    if (!publishStatus) return 'Đang kết nối…';
    if (publishStatus.status === 'published') return 'Đã đồng bộ';
    if (publishStatus.status === 'rendering') return 'Đang cập nhật hiển thị';
    if (publishStatus.status === 'pending') return 'Đã lưu · Đang xử lý';
    if (publishStatus.status === 'failed') return 'Cần cập nhật lại';
    return 'Đang hoạt động';
  }, [publishStatus]);

  const syncStatusColor = useMemo(() => {
    if (!publishStatus) return '#94a3b8';
    if (publishStatus.status === 'published') return '#10b981';
    if (publishStatus.status === 'rendering' || publishStatus.status === 'pending') return '#f59e0b';
    if (publishStatus.status === 'failed') return '#ef4444';
    return '#10b981';
  }, [publishStatus]);

  // Keyboard shortcuts (like iD editor / JOSM)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (pendingMutation || draft.blocked || saving || conflictSession || historyOpen || datasetManagerOpen || geometryToolGroup || locksOpen) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        if (drawMode !== 'select') {
          event.preventDefault();
          handleCancelDrawing();
        } else if (selected) {
          event.preventDefault();
          selectFeature(null);
        }
        return;
      }
      if ((drawMode === 'line' || drawMode === 'area') && event.key === 'Enter') {
        event.preventDefault();
        handleFinishDrawing();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedKey) {
        event.preventDefault();
        handleDeleteSelected();
        return;
      }
      if (event.key === '1' && drawMode !== 'point') {
        event.preventDefault();
        activateDrawMode('point');
        return;
      }
      if (event.key === '2' && drawMode !== 'line') {
        event.preventDefault();
        activateDrawMode('line');
        return;
      }
      if (event.key === '3' && drawMode !== 'area') {
        event.preventDefault();
        activateDrawMode('area');
        return;
      }
      if (event.key === 's' || event.key === 'S') {
        if (drawMode !== 'select') {
          event.preventDefault();
          activateDrawMode('select');
          return;
        }
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (drawMode === 'select' && (key === 'c' || key === 'x' || key === 'v')) {
        event.preventDefault();
        if (key === 'v') {
          if (mapPointerRef.current) handlePasteSelection(mapPointerRef.current);
          else setSaveStatus('Đưa con trỏ vào bản đồ rồi nhấn Ctrl+V để dán tại vị trí đó.');
        }
        else handleCopySelection(key === 'x');
        return;
      }
      if (key === 'z' && !event.shiftKey && canUndo) {
        event.preventDefault();
        acceptCommand(undo());
      }
      if ((key === 'y' || (key === 'z' && event.shiftKey)) && canRedo) {
        event.preventDefault();
        acceptCommand(redo());
      }
      if (key === 'd' && drawMode === 'select') {
        event.preventDefault();
        if (mapPointerRef.current) handleDuplicateSelected(mapPointerRef.current);
        else setSaveStatus('Đưa con trỏ vào bản đồ rồi nhấn Ctrl+D để nhân bản tại vị trí đó.');
        return;
      }
      if (key === 's' && changeCount > 0 && !saving) {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingMutation, draft.blocked, activateDrawMode, canRedo, canUndo, changeCount, conflictSession, datasetManagerOpen, drawMode, geometryToolGroup, locksOpen, handleCancelDrawing, handleCopySelection, handlePasteSelection, handleDeleteSelected, handleDuplicateSelected, handleFinishDrawing, handleSave, historyOpen, redo, saving, selectFeature, selected, selectedKey, undo]);

  return (
    <Box className="osm-workspace" inert={draft.blocked} sx={{ height: '100dvh', width: '100%', minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: '56px minmax(0, 1fr) 32px', overflow: 'hidden', bgcolor: '#f5f2e9' }}>
      {draft.dialog}
      <CssBaseline />
      {/* Top Header / App Bar */}
      <AppBar className="osm-masthead"
        inert={Boolean(geometryToolGroup)}
        position="static"
        elevation={0}
        sx={{
          backgroundColor: '#681626',
          color: '#ffffff',
          borderBottom: '1px solid rgba(0, 0, 0, 0.25)',
          zIndex: 10
        }}
      >
        <Toolbar variant="dense" sx={{ minHeight: '56px !important', px: { xs: 1, sm: 2 }, gap: { xs: 0.75, sm: 1.5 }, overflowX: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
          <WorkspaceNavigation mode="osm" disabled={saving || Boolean(pendingCloseId) || Boolean(geometryToolGroup)} />

          {/* Sync Status Badge */}
          <Tooltip title="Trạng thái đồng bộ dữ liệu bản đồ">
            <Stack className="workspace-sync"
              direction="row"
              sx={{
                alignItems: 'center',
                gap: 0.8,
                display: { xs: 'none', md: 'flex' }, flexShrink: 0, whiteSpace: 'nowrap',
                bgcolor: 'rgba(0, 0, 0, 0.18)',
                px: 1.2,
                py: 0.4,
                borderRadius: 4
              }}
            >
              <Box className="workspace-sync-dot"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: syncStatusColor,
                  boxShadow: `0 0 6px ${syncStatusColor}`
                }}
              />
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#ffffff' }}>
                {syncStatusText}
              </Typography>
            </Stack>
          </Tooltip>

          <Box className="workspace-toolbar-spacer" sx={{ flex: 1 }} />

          {/* Feature count & actions */}
          <Stack className="workspace-header-actions" direction="row" sx={{ alignItems: 'center', gap: { xs: 0.75, sm: 1.5 }, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {graphVisible && (
              <Typography sx={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.85)', display: { xs: 'none', lg: 'block' } }}>
                {features.length > 0 ? `${features.length.toLocaleString('vi-VN')} đối tượng` : 'Chưa có đối tượng'}
                {changeCount > 0 && ` · ${changeCount} chỉnh sửa`}
              </Typography>
            )}

            <Tooltip title="Đi tới vị trí theo tọa độ">
              <Button
                size="small"
                variant="text"
                aria-label="Đi tới vị trí theo tọa độ"
                onClick={event => setCoordinateAnchor(event.currentTarget)}
                sx={{
                  color: '#ffffff',
                  minWidth: { xs: 36, sm: 64 },
                  bgcolor: 'rgba(255, 255, 255, 0.12)',
                  borderRadius: 1.5,
                  px: 1.25,
                  py: 0.5,
                  fontSize: 11.5,
                  fontWeight: 700,
                  textTransform: 'none',
                  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.22)' }
                }}
              >
                <Box component="span" sx={{ display: { xs: 'inline-flex', sm: 'none' } }}><Crosshair size={18} aria-hidden="true" /></Box><Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Tọa độ</Box>
              </Button>
            </Tooltip>
            <Menu
              anchorEl={coordinateAnchor}
              open={Boolean(coordinateAnchor)}
              onClose={() => { setCoordinateAnchor(null); setCoordinateError(null); }}
              slotProps={{ paper: { sx: { width: 330, mt: 0.75, p: 1.5, borderRadius: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' } } }}
            >
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#252c2b', mb: 0.5 }}>Đi tới tọa độ</Typography>
              <Typography sx={{ fontSize: 11, color: '#626a63', mb: 1.25 }}>Nhập theo thứ tự vĩ độ, kinh độ.</Typography>
              <TextField
                autoFocus
                fullWidth
                size="small"
                value={coordinateInput}
                placeholder="20.409586,106.1704618"
                error={Boolean(coordinateError)}
                helperText={coordinateError ?? 'Phạm vi: vĩ độ −90…90, kinh độ −180…180'}
                onChange={event => { setCoordinateInput(event.target.value); setCoordinateError(null); }}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); handleLocateCoordinate(); } }}
              />
              <Stack direction="row" sx={{ mt: 1.25, gap: 1, justifyContent: 'flex-end' }}>
                <Button size="small" onClick={() => setCoordinateAnchor(null)} sx={{ textTransform: 'none' }}>Hủy</Button>
                <Button size="small" variant="contained" onClick={handleLocateCoordinate} sx={{ textTransform: 'none', bgcolor: '#8b2235', '&:hover': { bgcolor: '#851224' } }}>Định vị</Button>
              </Stack>
            </Menu>

            {/* Export Menu */}
            <Tooltip title="Xuất dữ liệu bản đồ">
              <Button
                size="small"
                variant="text"
                onClick={event => setExportAnchor(event.currentTarget)}
                sx={{
                  color: '#ffffff',
                  bgcolor: 'rgba(255, 255, 255, 0.12)',
                  borderRadius: 1.5,
                  px: 1.25,
                  py: 0.5,
                  fontSize: 11.5,
                  fontWeight: 700,
                  textTransform: 'none',
                  '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.22)' }
                }}
              >
                Xuất tệp <ChevronDown size={14} aria-hidden="true" />
              </Button>
            </Tooltip>
            <Menu
              anchorEl={exportAnchor}
              open={Boolean(exportAnchor)}
              onClose={() => setExportAnchor(null)}
              slotProps={{ paper: { sx: { minWidth: 240, mt: 0.75, borderRadius: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' } } }}
            >
              <MenuItem onClick={() => handleExport('osm')}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#252c2b' }}>Xuất tệp dữ liệu (.osm)</Typography>
                  <Typography sx={{ fontSize: 11, color: '#626a63' }}>Toàn bộ đối tượng trong vùng đang xem</Typography>
                </Box>
              </MenuItem>
              <MenuItem onClick={() => handleExport('osc')}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#252c2b' }}>Xuất tập thay đổi (.osc)</Typography>
                  <Typography sx={{ fontSize: 11, color: '#626a63' }}>Các chỉnh sửa đã lưu gần nhất</Typography>
                </Box>
              </MenuItem>
              <MenuItem disabled={saving || drawMode !== 'select'} onClick={() => { setExportAnchor(null); setHistoryOpen(true); }}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#8b2235' }}>Lịch sử / Revert changeset</Typography>
                  <Typography sx={{ fontSize: 11, color: '#626a63' }}>Chọn một trong 3 changeset gần nhất</Typography>
                </Box>
              </MenuItem>
            </Menu>

            <Tooltip title={`Dữ liệu / Import PBF · ${dataset.name}`}><Button color="inherit" aria-label="Dữ liệu / Import PBF" disabled={saving || Boolean(conflictSession) || historyOpen} onClick={() => setDatasetManagerOpen(true)} sx={{ textTransform: 'none', minWidth: { xs: 36, md: 64 } }}><Box component="span" sx={{ display: { xs: 'inline-flex', md: 'none' } }}><Layers size={18} aria-hidden="true" /></Box><Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>Dữ liệu / Import PBF</Box></Button></Tooltip>

            {/* Prominent Save Button */}
            <Tooltip title={drawVertices.length ? 'Hoàn tất hoặc hủy bản vẽ dở trước khi lưu vào hệ thống' : changeCount > 0 ? `Lưu ${changeCount} thay đổi vào hệ thống (Ctrl+S)` : 'Không có thay đổi nào cần lưu'}>
              <span>
                <Button className="workspace-save"
                  size="small"
                  variant="contained"
                  disabled={saving || Boolean(geometryToolGroup) || Boolean(pendingMutation) || drawVertices.length > 0 || (!changeCount && !pendingCloseId)}
                  onClick={() => void handleSave()}
                  sx={{
                    minWidth: { xs: 92, sm: 100 },
                    height: 32,
                    borderRadius: 1.5,
                    bgcolor: changeCount > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0.2)',
                    color: changeCount > 0 ? '#681626' : 'rgba(255, 255, 255, 0.65)',
                    fontSize: 12,
                    fontWeight: 800,
                    textTransform: 'none',
                    boxShadow: changeCount > 0 ? '0 2px 8px rgba(0,0,0,0.2)' : 'none',
                    '&:hover': {
                      bgcolor: changeCount > 0 ? '#fff1f2' : 'rgba(255, 255, 255, 0.3)'
                    },
                    '&.Mui-disabled': {
                      bgcolor: 'rgba(255, 255, 255, 0.15)',
                      color: 'rgba(255, 255, 255, 0.5)'
                    }
                  }}
                >
                  {saving ? 'Đang lưu…' : pendingCloseId ? 'Hoàn tất lưu' : `Lưu thay đổi${changeCount ? ` (${changeCount})` : ''}`}
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      {datasetManagerOpen && <DatasetManagerDialog activeId={dataset.id} canSwitch={!changeCount && !saving && !pendingCloseId && !conflictSession && !historyOpen && drawMode === 'select'} onClose={() => setDatasetManagerOpen(false)} onOpenDataset={next => {
        if (changeCount || saving || pendingCloseId || conflictSession || historyOpen || drawMode !== 'select') return;
        graphLoader.cancel(); entityRequestRef.current += 1; onOpenDataset(next);
      }} />}
      {conflictSession && <ConflictDialog dataset={dataset.name} session={conflictSession} onClose={() => setConflictSession(null)} onApply={handleApplyConflictResolution} />}
      {historyOpen && <ChangesetHistoryDialog dataset={dataset.name} hasDraft={changeCount > 0 || Boolean(pendingCloseId)} busy={saving} onClose={() => setHistoryOpen(false)} onRevert={handleRollbackChangeset} />}
      {(selected || geometryClipboard || lockedKeys.length > 0 || lockedLayers.length > 0) && (
        <Menu
          open={Boolean(selectionMenuPosition)}
          onClose={() => setSelectionMenuPosition(null)}
          anchorReference="anchorPosition"
          anchorPosition={selectionMenuPosition ?? undefined}
          slotProps={{ list: { 'aria-label': 'Thao tác đối tượng đang chọn' }, paper: { sx: { width: 252, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', overflowX: 'hidden', borderRadius: 2, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)', '& .MuiMenuItem-root': { minHeight: 36 }, '& .MuiMenuItem-root:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } } } }}
        >
          <Box sx={{ px: 1.25, py: 1 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 0.75 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ color: '#252c2b', fontSize: 12.5, fontWeight: 800 }}>{selectedName || 'Công cụ biên tập'}</Typography>
                <Typography sx={{ mt: 0.15, color: '#626a63', fontFamily: 'monospace', fontSize: 10 }}>
                  {selectedKeys.length > 1 ? `${selectedKeys.length} đối tượng đang chọn` : selected ? `${selected.type}/${selected.id}` : lockedKeys.length + lockedLayers.length > 0 ? `${lockedKeys.length} đối tượng · ${lockedLayers.length} layer đang khóa` : 'Dán đối tượng từ bộ nhớ tạm'}
                </Typography>
              </Box>
            </Stack>
          </Box>
          <Divider />
          <MenuItem disabled={saving || !selected} onClick={() => handleCopySelection()} sx={{ minHeight: 34, gap: 1, '&.Mui-disabled': { opacity: 0.5, color: '#626a63' } }}>
            <Copy size={15} aria-hidden="true" />
            <Typography sx={{ fontSize: 12, fontWeight: 750 }}>Sao chép</Typography><Typography sx={{ ml: 'auto', fontSize: 10, color: '#94a3b8' }}>Ctrl+C</Typography>
          </MenuItem>
          <MenuItem disabled={saving || !geometryClipboard} onClick={() => handlePasteSelection()} sx={{ minHeight: 34, gap: 1, '&.Mui-disabled': { opacity: 0.5, color: '#626a63' } }}>
            <Clipboard size={15} aria-hidden="true" />
            <Typography sx={{ fontSize: 12, fontWeight: 750 }}>Dán</Typography><Typography sx={{ ml: 'auto', fontSize: 10, color: '#94a3b8' }}>Ctrl+V</Typography>
          </MenuItem>
          <MenuItem
            disabled={saving || !selected || (selected.type === 'relation' && selected.tags.type !== 'collection')}
            onClick={() => handleDuplicateSelected()}
            sx={{ minHeight: 34, gap: 1, color: '#626a63', '&.Mui-disabled': { opacity: 0.55, color: '#626a63' } }}
          >
            <Files size={15} aria-hidden="true" />
            <Typography sx={{ fontSize: 12, fontWeight: 750 }}>Nhân bản</Typography><Typography sx={{ ml: 'auto', fontSize: 10, color: '#94a3b8' }}>Ctrl+D</Typography>
          </MenuItem>
          <MenuItem
            disabled={saving || !selected}
            onClick={collectionGroups.length ? handleUngroupSelected : handleGroupSelected}
            sx={{ minHeight: 34, gap: 1, color: '#626a63', '&:hover': { bgcolor: '#f5f2e9' }, '&.Mui-disabled': { opacity: 0.55, color: '#626a63' } }}
          >
            <Network size={15} aria-hidden="true" />
            <Typography sx={{ fontSize: 12, fontWeight: 750 }}>{collectionGroups.length ? 'Bỏ nhóm' : 'Nhóm'}</Typography>
            {collectionGroups.length > 1 && <Typography sx={{ ml: 'auto', fontSize: 10, color: '#94a3b8' }}>{collectionGroups.length} nhóm</Typography>}
          </MenuItem>
          <Divider sx={{ my: 0.25 }} />
          {geometryToolGroups.map(({ id, label, icon: ToolIcon }) => (
            <MenuItem key={id} disabled={saving || !selected} onClick={() => { setSelectionMenuPosition(null); setGeometryToolGroup(id); }} sx={{ minHeight: 34, gap: 1 }}>
              <ToolIcon size={15} aria-hidden="true" />
              <Typography sx={{ fontSize: 12, fontWeight: 750 }}>{label}</Typography>
              <ChevronRight size={14} aria-hidden="true" style={{ marginLeft: 'auto' }} />
            </MenuItem>
          ))}
          <Divider sx={{ my: 0.25 }} />
          {(lockedKeys.length > 0 || lockedLayers.length > 0) && <MenuItem disabled={saving} onClick={() => { setSelectionMenuPosition(null); setLocksOpen(true); }} sx={{ gap: 1 }}><LockKeyhole size={15} aria-hidden="true" /><Typography sx={{ fontSize: 12, fontWeight: 750 }}>Quản lý khóa ({lockedKeys.length + lockedLayers.length})</Typography></MenuItem>}
          <MenuItem disabled={saving || !selected} onClick={() => handleCopySelection(true)} sx={{ minHeight: 34, gap: 1, '&.Mui-disabled': { opacity: 0.5, color: '#626a63' } }}>
            <Scissors size={15} aria-hidden="true" />
            <Typography sx={{ fontSize: 12, fontWeight: 750 }}>Cắt</Typography><Typography sx={{ ml: 'auto', fontSize: 10, color: '#94a3b8' }}>Ctrl+X</Typography>
          </MenuItem>
          <MenuItem
            disabled={saving || !selected}
            onClick={handleDeleteSelected}
            sx={{ minHeight: 34, gap: 1, color: '#b4233c', '&:hover': { bgcolor: '#fff1f2' }, '&.Mui-disabled': { opacity: 0.55, color: '#b4233c' } }}
          >
            <Trash2 size={15} aria-hidden="true" />
            <Typography sx={{ fontSize: 12, fontWeight: 750 }}>Xóa đối tượng</Typography>
          </MenuItem>
        </Menu>
      )}

      {locksOpen && <GeometryLocksDialog keys={lockedKeys} layers={lockedLayers} features={features} onClose={() => setLocksOpen(false)} onUnlock={() => { unlockGeometry(); setLocksOpen(false); setSaveStatus('Đã mở khóa tất cả đối tượng và layer.'); }} />}
      {pendingMutation && <CommandImpactDialog command={pendingMutation} onClose={() => setPendingMutation(null)} onApply={() => commitInspectedMutation(pendingMutation)} />}
      {geometryToolGroup && (
        <GeometryToolsDialog
          key={geometryToolGroup}
          group={geometryToolGroup}
          count={selectedKeys.length}
          polygonCount={selectedFeatures.filter(feature => feature.geometry.type === 'Polygon' || feature.type === 'relation' && feature.tags.type === 'multipolygon').length}
          selection={selectedFeatures}
          impact={geometryImpact}
          initialLayer={selectedKey && features.find(feature => entityKey(feature) === selectedKey) ? geometryLayer(features.find(feature => entityKey(feature) === selectedKey)!) : 'areas'}
          onApply={handleGeometryTool}
          onInspect={inspectGeometryTool}
          onPreview={setGeometryPreview}
          circularizable={selectedFeatures.length === 1 && (() => {
            const geometry = selectedFeatures[0].geometry;
            const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.type === 'LineString' ? geometry.coordinates : [];
            return ring.length >= 4 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]
              && new Set(ring.map(coordinate => coordinate.join(','))).size >= 3;
          })()}
          onClose={closeGeometryTool}
        />
      )}

      {/* Main Workspace Body */}
      <Box className="osm-main" component="main" inert={saving || undefined} sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: 0, position: 'relative', overflow: 'hidden', gap: { xs: 0.75, sm: 1 }, p: { xs: 0.75, sm: 1 }, bgcolor: '#f5f2e9' }}>
        {/* Map Canvas Area */}
        <Box className="osm-map" sx={{ position: 'relative', minWidth: 0, minHeight: 0, flex: 1, overflow: 'hidden', bgcolor: '#d4d3c8', borderRadius: { xs: 2, sm: 3 }, border: '1px solid #d7dee6' }}>
          {(lockedKeys.length > 0 || lockedLayers.length > 0) && <Button size="small" variant="outlined" disabled={saving} onClick={() => setLocksOpen(true)} startIcon={<LockKeyhole size={14} aria-hidden="true" />} aria-label="Xem đối tượng và layer đang khóa" sx={{ position: 'absolute', zIndex: 10, right: 76, top: 16, bgcolor: 'background.paper', borderColor: 'divider', color: 'primary.dark', '&:hover': { bgcolor: 'primary.light' } }}>Đang khóa · {lockedKeys.length + lockedLayers.length}</Button>}
          {/* Primary editing rail */}
          <Paper
            elevation={4}
            inert={Boolean(geometryToolGroup)}
            className="osm-tool-rail" aria-label="Công cụ biên tập bản đồ"
            sx={{
              position: 'absolute',
              zIndex: 10,
              top: 16,
              left: { xs: 10, sm: 16 },
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: 56,
              p: 0.5,
              borderRadius: 2,
              bgcolor: '#ffffff',
              boxShadow: '0 8px 24px rgba(70, 12, 26, 0.16)',
              border: '1px solid rgba(155, 25, 46, 0.20)'
            }}
          >
            <Typography sx={{ display: 'none' }}>Công cụ</Typography>
            <Tooltip title="Chọn & Xem đối tượng (Esc / S)" placement="right">
              <Button
                size="small"
                onClick={() => activateDrawMode('select')}
                aria-label="Chọn và xem đối tượng (Esc hoặc S)"
                sx={{
                  minWidth: 44, width: 44, height: 44, p: 0,
                  justifyContent: 'center',
                  borderRadius: 1.5,
                  bgcolor: drawMode === 'select' ? '#8b2235' : 'transparent',
                  color: drawMode === 'select' ? '#ffffff' : '#334155',
                  '&:hover': {
                    bgcolor: drawMode === 'select' ? '#681626' : '#fff1f2'
                  }
                }}
              >
                <MousePointer2 size={20} aria-hidden="true" />
              </Button>
            </Tooltip>

            <Divider sx={{ mx: 0.5, my: 0.65 }} />

            <Tooltip title="Vẽ điểm (Phím 1)" placement="right">
              <Button
                size="small"
                onClick={() => activateDrawMode('point')}
                aria-label="Vẽ điểm (phím 1)"
                sx={{
                  minWidth: 44, width: 44, height: 44, p: 0,
                  justifyContent: 'center',
                  borderRadius: 1.5,
                  bgcolor: drawMode === 'point' ? '#8b2235' : 'transparent',
                  color: drawMode === 'point' ? '#ffffff' : '#334155',
                  '&:hover': {
                    bgcolor: drawMode === 'point' ? '#681626' : '#fff1f2'
                  }
                }}
              >
                <CirclePlus size={20} aria-hidden="true" />
              </Button>
            </Tooltip>

            <Tooltip title="Vẽ đường (Phím 2)" placement="right">
              <Button
                size="small"
                onClick={() => activateDrawMode('line')}
                aria-label="Vẽ đường (phím 2)"
                sx={{
                  minWidth: 44, width: 44, height: 44, p: 0,
                  justifyContent: 'center',
                  borderRadius: 1.5,
                  bgcolor: drawMode === 'line' ? '#8b2235' : 'transparent',
                  color: drawMode === 'line' ? '#ffffff' : '#334155',
                  '&:hover': {
                    bgcolor: drawMode === 'line' ? '#681626' : '#fff1f2'
                  }
                }}
              >
                <Spline size={20} aria-hidden="true" />
              </Button>
            </Tooltip>

            <Tooltip title="Vẽ vùng (Phím 3)" placement="right">
              <Button
                size="small"
                onClick={() => activateDrawMode('area')}
                aria-label="Vẽ vùng (phím 3)"
                sx={{
                  minWidth: 44, width: 44, height: 44, p: 0,
                  justifyContent: 'center',
                  borderRadius: 1.5,
                  bgcolor: drawMode === 'area' ? '#8b2235' : 'transparent',
                  color: drawMode === 'area' ? '#ffffff' : '#334155',
                  '&:hover': {
                    bgcolor: drawMode === 'area' ? '#681626' : '#fff1f2'
                  }
                }}
              >
                <Pentagon size={20} aria-hidden="true" />
              </Button>
            </Tooltip>

            <Tooltip title="Tạo quan hệ (không có phím tắt)" placement="right">
              <Button
                size="small"
                onClick={handleCreateRelation}
                aria-label="Tạo quan hệ từ đối tượng đang chọn (không có phím tắt)"
                sx={{
                  minWidth: 44, width: 44, height: 44, p: 0,
                  justifyContent: 'center',
                  borderRadius: 1.5,
                  color: '#681626',
                  '&:hover': { bgcolor: '#fff1f2' }
                }}
              >
                <Network size={20} aria-hidden="true" />
              </Button>
            </Tooltip>

            <Divider sx={{ mx: 0.5, my: 0.65 }} />

            <Tooltip title="Hoàn tác (Ctrl+Z)" placement="right">
              <span>
                <IconButton
                  size="small"
                  disabled={!canUndo}
                  onClick={() => acceptCommand(undo())}
                  aria-label="Hoàn tác (Ctrl+Z)"
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 1.5,
                    color: canUndo ? '#334155' : '#cbd5e1',
                    '&:hover': { bgcolor: '#fff1f2' }
                  }}
                >
                  <Undo2 size={20} aria-hidden="true" />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Làm lại (Ctrl+Y)" placement="right">
              <span>
                <IconButton
                  size="small"
                  disabled={!canRedo}
                  onClick={() => acceptCommand(redo())}
                  aria-label="Làm lại (Ctrl+Y)"
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 1.5,
                    color: canRedo ? '#334155' : '#cbd5e1',
                    '&:hover': { bgcolor: '#fff1f2' }
                  }}
                >
                  <Redo2 size={20} aria-hidden="true" />
                </IconButton>
              </span>
            </Tooltip>
          </Paper>

          {/* Active Drawing Guide Banner */}
          {drawMode !== 'select' && (
            <Paper
              elevation={3}
              sx={{
                position: 'absolute',
                zIndex: 9,
                top: 72,
                left: { xs: 70, sm: '50%' },
                right: { xs: 10, sm: 'auto' },
                transform: { xs: 'none', sm: 'translateX(-50%)' },
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 1.5,
                px: 2,
                py: 0.8,
                borderRadius: 2,
                bgcolor: '#ffffff',
                border: '1px solid #fed7aa',
                boxShadow: '0 8px 20px rgba(15,23,42,0.14)'
              }}
            >
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#9a3412' }}>
                {drawMode === 'point' && 'Nhấp chuột lên vị trí bất kỳ trên bản đồ để đặt điểm.'}
                {drawMode === 'line' && `Đang vẽ đường (${drawVertices.length} điểm): Nhấp để thêm đỉnh, Enter để hoàn tất; Esc để hủy.`}
                {drawMode === 'area' && `Đang vẽ vùng (${drawVertices.length} điểm): Nhấp điểm đầu hoặc Enter để khép vùng.`}
              </Typography>
              {(drawMode === 'line' || drawMode === 'area') && drawVertices.length >= (drawMode === 'area' ? 3 : 2) && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleFinishDrawing}
                  sx={{
                    borderRadius: 1.5,
                    bgcolor: '#8b2235',
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'none',
                    py: 0.3,
                    '&:hover': { bgcolor: '#681626' }
                  }}
                >
                  Hoàn tất (Enter)
                </Button>
              )}
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                onClick={handleCancelDrawing}
                sx={{
                  borderRadius: 1.5,
                  fontSize: 11,
                  textTransform: 'none',
                  py: 0.3,
                  borderColor: '#cbd5e1',
                  color: '#626a63'
                }}
              >
                Hủy (Esc)
              </Button>
            </Paper>
          )}

          {/* Low Zoom Guidance Alert (iD / JOSM style) */}
          {!graphVisible && !saveStatus && (
            <Paper
              elevation={2}
              sx={{
                position: 'absolute',
                zIndex: 8,
                bottom: { xs: 12, sm: 24 },
                left: '50%',
                transform: 'translateX(-50%)',
                maxWidth: 'calc(100% - 32px)',
                px: 2,
                py: 1,
                borderRadius: 2,
                bgcolor: '#252c2b',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                gap: 1.5
              }}
            >
              <Typography sx={{ fontSize: 12.5, fontWeight: 500 }}>
                Phóng to bản đồ (mức thu phóng ≥ {GRAPH_MIN_ZOOM}, hiện tại Z {pointerStatus.zoom.toFixed(1)}) để bắt đầu biên tập đối tượng.
              </Typography>
            </Paper>
          )}

          {/* Data issues panel: local validation before the authoritative server check. */}
          {graphVisible && changeCount > 0 && issuesOpen && (
            <Paper
              elevation={4}
              sx={{
                // Keep validation close to the work area without competing
                // with the tool rail, drawing guide, or map controls.
                position: 'absolute', zIndex: 10, bottom: { xs: 10, sm: 16 }, left: { xs: 10, sm: 16 }, width: { xs: 'calc(100% - 20px)', sm: 320 },
                maxHeight: 'calc(100% - 32px)', overflowY: 'auto', borderRadius: 2,
                border: '1px solid #d4d3c8', bgcolor: '#ffffff', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)'
              }}
            >
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1.4, py: 1, borderBottom: '1px solid #d4d3c8', bgcolor: blockingIssues.length ? '#fff1f2' : '#f0fdf4' }}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#252c2b' }}>Kiểm tra dữ liệu</Typography>
                  <Typography sx={{ fontSize: 10.5, color: '#626a63' }}>Chỉ kiểm tra đối tượng đang sửa</Typography>
                </Box>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                  {blockingIssues.length > 0 && <Chip label={`${blockingIssues.length} lỗi`} size="small" sx={{ height: 20, fontSize: 10, fontWeight: 800, bgcolor: '#fee2e2', color: '#b4233c' }} />}
                  {issues.length > blockingIssues.length && <Chip label={`${issues.length - blockingIssues.length} lưu ý`} size="small" sx={{ height: 20, fontSize: 10, fontWeight: 800, bgcolor: '#fef3c7', color: '#92400e' }} />}
                  <Tooltip title="Thu gọn kiểm tra dữ liệu"><IconButton size="small" aria-label="Thu gọn kiểm tra dữ liệu" onClick={() => setIssuesOpen(false)} sx={{ color: '#626a63' }}><X size={16} aria-hidden="true" /></IconButton></Tooltip>
                </Stack>
              </Stack>
              {issues.length === 0 ? (
                <Typography sx={{ px: 1.4, py: 1.25, fontSize: 12, color: '#166534', fontWeight: 600 }}>Không phát hiện vấn đề trong các chỉnh sửa hiện tại.</Typography>
              ) : (
                <Stack sx={{ p: 0.75, gap: 0.6 }}>
                  {issues.slice(0, 12).map(issue => (
                    <Button
                      key={issue.id}
                      variant="text"
                      onClick={() => handleSelectIssue(issue)}
                      sx={{ alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left', borderRadius: 1.25, px: 0.9, py: 0.75, textTransform: 'none', color: '#252c2b', bgcolor: issue.severity === 'error' ? '#fff7f7' : '#fffbeb', '&:hover': { bgcolor: issue.severity === 'error' ? '#fee2e2' : '#fef3c7' } }}
                    >
                      <Box>
                        <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: issue.severity === 'error' ? '#b4233c' : '#92400e' }}>{issue.title}</Typography>
                        <Typography sx={{ mt: 0.2, fontSize: 10.5, lineHeight: 1.35, color: '#475569' }}>{issue.detail}</Typography>
                      </Box>
                    </Button>
                  ))}
                  {issues.length > 12 && <Typography sx={{ px: 0.75, color: '#626a63', fontSize: 11 }}>Và {issues.length - 12} vấn đề khác.</Typography>}
                </Stack>
              )}
            </Paper>
          )}
          {graphVisible && changeCount > 0 && !issuesOpen && (
            <Button onClick={() => setIssuesOpen(true)} size="small" variant="contained" sx={{ position: 'absolute', zIndex: 10, top: { xs: 144, sm: 176 }, right: { xs: 10, sm: 16 }, borderRadius: 1.5, bgcolor: blockingIssues.length ? '#b4233c' : '#15803d', textTransform: 'none', fontSize: 11, fontWeight: 800 }}>
              Kiểm tra dữ liệu{issues.length ? ` · ${issues.length}` : ''}
            </Button>
          )}

          {/* Operation Status Toast */}
          {saveStatus && (
            <Paper
              elevation={3}
              sx={{
                position: 'absolute',
                zIndex: 10,
                left: 16,
                bottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                maxWidth: 'min(440px, calc(100% - 32px))',
                px: 1.5,
                py: 1,
                borderRadius: 1.5,
                bgcolor: '#ffffff',
                border: '1px solid #ead6da',
                boxShadow: '0 8px 20px rgba(15,23,42,0.14)'
              }}
            >
              <Typography role="status" aria-live="polite" sx={{ fontSize: 12.5, fontWeight: 600, color: '#252c2b', overflowWrap: 'anywhere' }}>
                {saveStatus}
                {canUndo && undoOfferId !== null && undoOfferId === getDraftState().undoStack.at(-1)?.id && <Button size="small" disabled={saving || Boolean(geometryToolGroup)} onClick={() => { if (acceptCommand(undo())) { setUndoOfferId(null); setSaveStatus('Đã hoàn tác thao tác vừa áp dụng.'); } }} sx={{ ml: 1 }}>Hoàn tác</Button>}
              </Typography>
              <IconButton size="small" aria-label="Đóng thông báo trạng thái" onClick={() => setSaveStatus(null)} sx={{ color: '#94a3b8' }}>
                <X size={16} aria-hidden="true" />
              </IconButton>
            </Paper>
          )}

          {/* The Underlying Map Component */}
          <MapCanvas
            commandPreview={pendingMutation?.plan ?? geometryPreview}
            inspectionOnly={Boolean(geometryToolGroup) || Boolean(pendingMutation)}
            restoredCamera={restoredCamera}
            isGeometryLocked={isGeometryLocked}
            dataset={dataset.name}
            initialBounds={dataset.bounds}
            features={graphVisible ? features : EMPTY_GRAPH}
            pinpoint={pinpoint}
            drawMode={drawMode}
            drawVertices={drawVertices}
            selected={selected}
            selectedFeatures={selectedFeatures}
            selectedKeys={selectedKeys}
            selectedVertexId={selectedVertexId}
            changedKeys={changedKeys}
            onSelectVertex={setSelectedVertexId}
            onBoundsChange={refreshGraph}
            onSelect={handleSelectFeature}
            onSelectEntity={handleSelectEntity}
            onSelectionContextMenu={handleSelectionContextMenu}
            onInsertVertex={handleInsertVertex}
            onDrawVertex={handleDrawVertex}
            onFinishDrawing={handleFinishDrawing}
            onCancelDrawing={handleCancelDrawing}
            onMoveNode={handleMoveNode}
            onMoveFeatures={handleMoveFeatures}
            onPointerStatus={handlePointerStatus}
            onPointerCoordinate={handlePointerCoordinate}
          />
        </Box>

        {/* Feature Inspector */}
        {selected && propertiesOpen && (
          <Paper
            className="osm-inspector" component="aside"
            inert={Boolean(geometryToolGroup)}
            aria-label="Bảng chi tiết đối tượng đang chọn"
            sx={{
              width: { xs: '100%', md: propertiesWidth },
              maxWidth: '100vw',
              minHeight: { xs: 252, md: 0 },
              maxHeight: { xs: '46%', md: 'none' },
              border: '1px solid #d9c3c8',
              borderRadius: { xs: 2, md: 3 },
              bgcolor: '#fcfbf7',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 9,
              boxShadow: { xs: '0 -8px 24px rgba(15, 23, 42, 0.12)', md: '-10px 0 28px rgba(15, 23, 42, 0.14)' },
              overflow: 'hidden'
            }}
          >
            <Box component="header" className="osm-inspector-header">
              <Box className="osm-inspector-heading">
                <Box sx={{ minWidth: 0 }}>
                  <Typography component="h2">{selectedName}</Typography>
                  <Typography className="osm-inspector-meta">
                    {selected.type === 'node' ? 'Điểm' : selected.type === 'way' ? (selected.geometry.type === 'Polygon' ? 'Vùng' : 'Đường') : 'Quan hệ'} · #{selected.id}
                    {selectedKeys.length > 1 && ` · ${selectedKeys.length} đang chọn`}
                  </Typography>
                </Box>
                <IconButton aria-label="Đóng bảng thuộc tính" onClick={() => setPropertiesOpen(false)}><X size={20} /></IconButton>
              </Box>
              <Typography className="osm-inspector-meta">
                {Object.keys(selected.tags).length} tags · {selectedWay ? `${selectedWay.properties.nodeIds?.length ?? 0} đỉnh` : selected.geometry.type}
                {' · '}{changes.some(change => change.key === selectedKey) ? 'Có thay đổi chưa lưu' : 'Dữ liệu gốc'}
              </Typography>
            </Box>

            {selectedWay && (
              <Tabs
                value={inspectorTab}
                onChange={(_, value: 'properties' | 'topology') => setInspectorTab(value)}
                aria-label="Khu vực chỉnh sửa đối tượng"
                variant="fullWidth"
                sx={{ minHeight: 48, px: 1.25, bgcolor: '#ffffff', borderBottom: '1px solid #cbd5e1', '& .MuiTabs-indicator': { height: 3, borderRadius: '3px 3px 0 0', bgcolor: '#8b2235' } }}
              >
                <Tab value="properties" label="Thuộc tính" id="inspector-tab-properties" aria-controls="inspector-panel-properties" sx={{ minHeight: 48, py: 0, fontSize: 12, fontWeight: 800, textTransform: 'none', color: '#626a63', '&.Mui-selected': { color: '#8b2235' } }} />
                <Tab value="topology" label="Topology" id="inspector-tab-topology" aria-controls="inspector-panel-topology" sx={{ minHeight: 48, py: 0, fontSize: 12, fontWeight: 800, textTransform: 'none', color: '#626a63', '&.Mui-selected': { color: '#8b2235' } }} />
              </Tabs>
            )}

            <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto', scrollPaddingBlock: 2 }}>
              <Box
                role="tabpanel"
                id="inspector-panel-properties"
                aria-labelledby="inspector-tab-properties"
                hidden={Boolean(selectedWay) && inspectorTab !== 'properties'}
              >
                <PropertiesEditor
                  onDraftTags={onDraftTags}
                  selected={selected}
                  onUpdate={handleUpdateTags}
                  onDelete={handleDeleteSelected}
                  onUpdateMembers={handleUpdateRelationMembers}
                />
              </Box>
              {selectedWay && (
                <Box
                  role="tabpanel"
                  id="inspector-panel-topology"
                  aria-labelledby="inspector-tab-topology"
                  hidden={inspectorTab !== 'topology'}
                >
                  <TopologyTools
                    way={selectedWay}
                    features={features}
                    vertexId={selectedVertexId}
                    disabled={saving || drawMode !== 'select'}
                    onVertex={setSelectedVertexId}
                    onAction={handleTopologyAction}
                    onContinue={handleContinueWay}
                  />
                </Box>
              )}
            </Box>
          </Paper>
        )}

        {/* Toggle button to reopen properties when minimized */}
        {selected && !propertiesOpen && (
          <Tooltip title="Mở bảng thuộc tính">
            <IconButton
              onClick={() => setPropertiesOpen(true)}
              sx={{
                position: 'absolute',
                zIndex: 10,
                top: 14,
                right: 14,
                bgcolor: '#ffffff',
                color: '#8b2235',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                '&:hover': { bgcolor: '#fceef0' }
              }}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Modern Status Footer Bar (JOSM / iD style) */}
      <Box className="osm-footline" component="footer"
        sx={{
          display: 'flex',
          alignItems: 'center',
          minWidth: 0,
          px: { xs: 1, sm: 2 },
          bgcolor: '#321019',
          color: '#d4d3c8',
          borderTop: '1px solid #5f1020',
          fontSize: 11,
          userSelect: 'none',
          overflow: 'hidden'
        }}
      >
        {/* Status Indicator */}
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              bgcolor: error ? '#ef4444' : loading ? '#f59e0b' : '#10b981'
            }}
          />
          <Typography noWrap sx={{ fontSize: 11, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {error ? error : loading ? 'Đang tải dữ liệu...' : changeCount > 0 ? `${changeCount} thay đổi chưa lưu` : 'Sẵn sàng làm việc'}
          </Typography>
        </Stack>

        <Box sx={{ flex: 1 }} />

        <Button size="small" aria-label="Quản lý bản nháp" onClick={draft.open} disabled={saving} title={draft.error ?? 'Bản nháp chỉ nằm trên trình duyệt này; vẫn cần Lưu thay đổi để ghi vào hệ thống.'} sx={{ flexShrink: 1, minWidth: 0, maxWidth: { xs: 140, sm: 330 }, color: draft.error ? 'error.main' : 'text.secondary', fontSize: 11, textTransform: 'none' }}><Box component="span" role="status" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{draft.error ? 'Lỗi lưu nháp · Xem chi tiết' : draft.status}</Box></Button>
        {/* Pointer Position & Zoom HUD */}
        <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mr: { xs: 0, sm: 2 }, display: { xs: 'none', sm: 'flex' } }}>
          <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8' }}>
            {Math.abs(pointerStatus.latitude).toFixed(5)}° {pointerStatus.latitude >= 0 ? 'B' : 'N'}, {Math.abs(pointerStatus.longitude).toFixed(5)}° {pointerStatus.longitude >= 0 ? 'Đ' : 'T'}
          </Typography>
          <Box sx={{ height: 12, width: '1px', bgcolor: '#334155' }} />
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#f87171' }}>
            Z {pointerStatus.zoom.toFixed(1)}
          </Typography>
        </Stack>

        {/* Change Actions & System Attribution */}
        {changeCount > 0 && (
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, mr: 1.5 }}>
            <Button
              size="small"
              disabled={saving || Boolean(geometryToolGroup)}
              onClick={() => { if (!saving && window.confirm('Hủy các thay đổi chưa lưu và xóa bản nháp tương ứng? Không thể khôi phục bằng Undo.')) discardChanges(); }}
              sx={{ minWidth: 0, px: 1, py: 0, color: 'error.main', fontSize: 10.5, textTransform: 'none', '&:hover': { bgcolor: 'rgba(239, 68, 68, 0.15)' } }}
            >
              Hủy thay đổi
            </Button>
          </Stack>
        )}

        <Typography noWrap sx={{ display: { xs: 'none', lg: 'block' }, fontSize: 10.5, color: '#94a3b8' }}>
          Hệ thống Quản lý Dữ liệu Địa lý
        </Typography>
      </Box>
    </Box>
  );
}
