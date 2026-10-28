import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Autocomplete,
  AppBar,
  Box,
  Button,
  Chip,
  CssBaseline,
  Divider,
  GlobalStyles,
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography
} from '@mui/material';
import { Banknote, Building2, BusFront, Fuel, GraduationCap, Hospital, Hotel, Landmark, MapPin, Route, ShoppingBag, TreePine, Utensils, Waves, type LucideIcon } from 'lucide-react';
import { closeChangeset, createChangeset, ChangesetApiError, rollbackChangeset, toUploadChanges, uploadChangeset } from './api/changeset';
import { DATASET_NAME, loadGraph } from './api/graph';
import { loadPublishStatus, type PublishStatus } from './api/publish';
import { EditorStoreProvider, entityKey, type EditorChange, type FeatureMutation, useEditorStore } from './features/editor/EditorStore';
import { insertNodeIntoFeature, makeNodeFeature, makeWayFeature, type DrawMode, type SnappedVertex } from './features/editor/drawing';
import { findEditorIssues, type EditorIssue } from './features/editor/issues';
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
import { resolvePointIcon, type PointIconName } from './features/map/styleRules';
import type { Coordinate, EntityType, GraphFeature, RelationMember, SelectedEntity, Tags } from './types/osm';

const propertiesWidth = 360;
const GRAPH_MIN_ZOOM = 16;
const CHANGESET_COMMENT = 'Chỉnh sửa từ Geodata WebGIS';
type Bbox = [number, number, number, number];

interface GraphCacheEntry {
  bbox: Bbox;
  features: GraphFeature[];
}

function bufferedBbox([west, south, east, north]: Bbox): Bbox {
  const longitudePadding = (east - west) * 0.18;
  const latitudePadding = (north - south) * 0.18;
  return [
    Math.max(-180, west - longitudePadding),
    Math.max(-85.051129, south - latitudePadding),
    Math.min(180, east + longitudePadding),
    Math.min(85.051129, north + latitudePadding)
  ];
}

function containsBbox(outer: Bbox, inner: Bbox) {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

function bboxKey(bbox: Bbox) {
  return bbox.map(value => value.toFixed(4)).join(',');
}

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
    <Box sx={{ width: 76, alignSelf: 'stretch', display: 'grid', placeItems: 'center', borderRight: '1px solid #e2e6eb', bgcolor: '#f8fafc' }} aria-hidden="true">
      <Icon size={42} color={palette.icon} strokeWidth={1.8} />
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
        <Typography sx={{ color: '#7a1426', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase' }}>
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
              <span><IconButton size="small" disabled={index === 0} onClick={() => { const next = [...members]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; commit(next, 'Đổi thứ tự thành viên quan hệ'); }}>↑</IconButton></span>
            </Tooltip>
            <Tooltip title="Đưa xuống">
              <span><IconButton size="small" disabled={index === members.length - 1} onClick={() => { const next = [...members]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; commit(next, 'Đổi thứ tự thành viên quan hệ'); }}>↓</IconButton></span>
            </Tooltip>
            <Tooltip title="Xóa thành viên">
              <IconButton size="small" onClick={() => commit(members.filter((_member, memberIndex) => memberIndex !== index), 'Xóa thành viên khỏi quan hệ')} sx={{ color: '#94a3b8', '&:hover': { color: '#dc2626', bgcolor: '#fee2e2' } }}>×</IconButton>
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
          <Typography sx={{ mt: 0.5, mb: 0.65, color: '#7a1426', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase' }}>Quan hệ cha</Typography>
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
  onUpdateMembers
}: {
  selected: SelectedEntity;
  onUpdate: (tags: Tags, label: string) => void;
  onDelete: () => void;
  onUpdateMembers: (members: RelationMember[], label: string) => void;
}) {
  const [draftTags, setDraftTags] = useState<Tags>(selected.tags);
  const [newTagKey, setNewTagKey] = useState('');
  const [presetMenuAnchor, setPresetMenuAnchor] = useState<HTMLElement | null>(null);
  const [presetQuery, setPresetQuery] = useState('');
  const selectedIdentity = `${selected.type}/${selected.id}`;

  useEffect(() => {
    setDraftTags(selected.tags);
    setNewTagKey('');
    setPresetMenuAnchor(null);
    setPresetQuery('');
  }, [selectedIdentity, selected.tags]);

  const commit = useCallback((label = 'Cập nhật thuộc tính') => {
    if (JSON.stringify(draftTags) !== JSON.stringify(selected.tags)) {
      onUpdate(draftTags, label);
    }
  }, [draftTags, onUpdate, selected.tags]);

  const updateValue = (key: string, value: string) => setDraftTags(tags => ({ ...tags, [key]: value }));

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
    setPresetMenuAnchor(null);
    onUpdate(next, `Chọn thể loại ${preset.label}`);
  };

  const clearPreset = () => {
    if (!activePreset) return;
    const next = { ...draftTags };
    for (const [key, value] of Object.entries(activePreset.matchTags)) {
      if (next[key] === value) delete next[key];
    }
    setDraftTags(next);
    setPresetMenuAnchor(null);
    onUpdate(next, `Bỏ thể loại ${activePreset.label}`);
  };

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Feature type / OSM preset */}
      <Box>
        <Typography sx={{ color: '#7a1426', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', mb: 0.8 }}>
          Thể loại đối tượng
        </Typography>
        <Paper
          component="button"
          type="button"
          disabled={!availablePresets.length}
          onClick={event => setPresetMenuAnchor(event.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={Boolean(presetMenuAnchor)}
          sx={{
            p: 0,
            width: '100%',
            minHeight: 78,
            display: 'flex',
            overflow: 'hidden',
            textAlign: 'left',
            color: '#1e293b',
            bgcolor: '#ffffff',
            border: '1px solid #dce1e7',
            borderRadius: 1.5,
            cursor: availablePresets.length ? 'pointer' : 'not-allowed',
            transition: 'border-color .15s ease, transform .15s ease',
            '&:hover': availablePresets.length ? { borderColor: presetPalette.border, transform: 'translateY(-1px)', bgcolor: '#f8fafc' } : {},
            '&:focus-visible': { outline: `2px solid ${presetPalette.border}`, outlineOffset: 2 }
          }}
        >
          <FeatureTypeGlyph preset={activePreset} />
          <Box sx={{ minWidth: 0, flex: 1, px: 1.5, py: 1.1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography sx={{ color: '#1e293b', fontSize: 14, fontWeight: 800 }}>
              {activePreset?.label ?? (availablePresets.length ? 'Chọn thể loại' : 'Không có thể loại phù hợp')}
            </Typography>
            {activePreset && (
              <Typography noWrap sx={{ mt: 0.35, color: '#64748b', fontSize: 11 }}>
                {presetGroupLabel}
              </Typography>
            )}
          </Box>
          <Box sx={{ width: 39, display: 'grid', placeItems: 'center', borderLeft: '1px solid #e2e6eb', color: '#64748b', fontSize: 19 }} aria-hidden="true">⌄</Box>
          <Tooltip title={activePreset ? 'Nhấn để thay đổi thể loại' : 'Chọn thể loại cho đối tượng'}>
            <Box component="span" sx={{ width: 39, display: 'grid', placeItems: 'center', borderLeft: '1px solid #e2e6eb', color: '#64748b', fontSize: 16, fontWeight: 800 }} aria-hidden="true">i</Box>
          </Tooltip>
        </Paper>
        <Menu
          anchorEl={presetMenuAnchor}
          open={Boolean(presetMenuAnchor)}
          onClose={() => { setPresetMenuAnchor(null); setPresetQuery(''); }}
          slotProps={{ paper: { sx: { mt: 0.5, minWidth: 300, maxHeight: 420, borderRadius: 1.5 } } }}
        >
          <MenuItem onClick={clearPreset}><em>Chưa phân loại</em></MenuItem>
          <Box sx={{ px: 1, pb: 1, position: 'sticky', top: 0, zIndex: 1, bgcolor: '#ffffff' }} onKeyDown={event => event.stopPropagation()}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              value={presetQuery}
              onChange={event => setPresetQuery(event.target.value)}
              placeholder="Tìm thể loại hoặc tag, ví dụ amenity=atm"
              slotProps={{ htmlInput: { 'aria-label': 'Tìm thể loại đối tượng' } }}
            />
          </Box>
          {PRESET_GROUPS.flatMap(group => {
            const groupPresets = menuPresets.filter(preset => preset.group === group.id);
            return groupPresets.length
              ? [
                  <ListSubheader key={`${group.id}-header`}>{group.label}</ListSubheader>,
                  ...groupPresets.map(preset => (
                    <MenuItem key={preset.id} selected={preset.id === activePreset?.id} onClick={() => choosePreset(preset)}>
                      {preset.label}
                    </MenuItem>
                  ))
                ]
              : [];
          })}
          {menuPresets.length === 0 && <MenuItem disabled>Không tìm thấy thể loại phù hợp.</MenuItem>}
        </Menu>
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
          <Typography sx={{ color: '#7a1426', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase' }}>
            Thuộc tính
          </Typography>
          <Chip
            label={activePreset ? activePreset.label : 'Thuộc tính chung'}
            size="small"
            sx={{ height: 22, fontSize: 11, fontWeight: 600, bgcolor: '#f4f6f8' }}
          />
        </Stack>

        <Stack sx={{ gap: 1 }}>
          {formFields.map(field => (
            <TextField
              key={field.key}
              fullWidth
              select={field.type === 'select' || field.type === 'yesno'}
              size="small"
              required={field.required}
              type={field.type === 'number' ? 'number' : 'text'}
              label={field.label}
              placeholder={field.placeholder}
              value={draftTags[field.key] ?? ''}
              onChange={event => {
                if (field.type === 'select' || field.type === 'yesno') {
                  updateAndCommit(field.key, event.target.value, `Cập nhật ${field.label}`);
                } else {
                  updateValue(field.key, event.target.value);
                }
              }}
              onBlur={() => {
                if (field.type !== 'select' && field.type !== 'yesno') commit(`Cập nhật ${field.label}`);
              }}
              slotProps={field.type === 'number' ? { htmlInput: { min: 0 } } : undefined}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5, bgcolor: '#ffffff' } }}
            >
              {(field.type === 'select' || field.type === 'yesno') && [
                <MenuItem key="empty" value=""><em>Không rõ</em></MenuItem>,
                ...(field.options ?? []).map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)
              ]}
            </TextField>
          ))}
        </Stack>
      </Box>

      {/* Tags not represented by the selected preset stay fully editable. */}
      <Box>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.2 }}>
          <Typography sx={{ color: '#7a1426', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase' }}>
            Thẻ nâng cao
          </Typography>
          <Chip
            label={`${advancedTagEntries.length} thẻ`}
            size="small"
            sx={{ height: 22, fontSize: 11, fontWeight: 600, bgcolor: '#f4f6f8' }}
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
                  <span style={{ fontSize: 16, lineHeight: 1 }}>×</span>
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
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{option.label}</Typography>
                <Typography sx={{ color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>
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
        <Typography sx={{ mt: 1, color: '#64748b', fontSize: 11, textAlign: 'center' }}>
          Các thay đổi sẽ được áp dụng khi nhấn nút Lưu trên thanh công cụ.
        </Typography>
      </Box>
    </Box>
  );
}

export default function App() {
  return (
    <EditorStoreProvider>
      <EditorShell />
    </EditorStoreProvider>
  );
}

function EditorShell() {
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [issuesOpen, setIssuesOpen] = useState(true);
  const [graphVisible, setGraphVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [lastCommittedChangesetId, setLastCommittedChangesetId] = useState<string | null>(null);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [coordinateAnchor, setCoordinateAnchor] = useState<HTMLElement | null>(null);
  const [coordinateInput, setCoordinateInput] = useState('');
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const [pinpoint, setPinpoint] = useState<Coordinate | null>(null);
  const [pointerStatus, setPointerStatus] = useState<MapPointerStatus>({ longitude: 104.50728, latitude: 21.59988, zoom: 16 });
  const [drawMode, setDrawMode] = useState<DrawMode>('select');
  const [drawVertices, setDrawVertices] = useState<SnappedVertex[]>([]);
  const graphCacheRef = useRef(new Map<string, GraphCacheEntry>());
  const graphRequestRef = useRef<AbortController | null>(null);
  const graphRequestIdRef = useRef(0);
  const viewportRef = useRef<MapViewport | null>(null);
  const nextNodeIdRef = useRef(-1);
  const nextWayIdRef = useRef(-1);
  const nextRelationIdRef = useRef(-1);

  const {
    features,
    selected,
    selectedKey,
    loading,
    error,
    changes,
    changeCount,
    canUndo,
    canRedo,
    hydrateGraph,
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

  const changedKeys = useMemo(() => new Set(changes.map(change => change.key)), [changes]);
  const issues = useMemo(() => findEditorIssues(features, changedKeys), [changedKeys, features]);
  const blockingIssues = useMemo(() => issues.filter(issue => issue.severity === 'error'), [issues]);

  const refreshPublishStatus = useCallback(async () => {
    try {
      setPublishStatus(await loadPublishStatus(DATASET_NAME));
    } catch {
      // Ignore background sync errors quietly
    }
  }, []);

  useEffect(() => {
    void refreshPublishStatus();
    const timer = window.setInterval(() => { void refreshPublishStatus(); }, 3_000);
    return () => window.clearInterval(timer);
  }, [refreshPublishStatus]);

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
        setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu bản đồ.');
      })
      .finally(() => {
        if (requestId === graphRequestIdRef.current) setLoading(false);
      });
  }, [hydrateGraph, setError, setLoading]);

  const handleSelectEntity = useCallback((type: SelectedEntity['type'], id: string) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bbox = bufferedBbox(viewport.bbox);
    setLoading(true);
    setError(null);
    void loadGraph(bbox)
      .then(result => {
        const key = bboxKey(bbox);
        graphCacheRef.current.set(key, { bbox, features: result.features });
        hydrateGraph(result.features);
        const feature = result.features.find(item => item.properties.entityType === type && item.properties.entityId === id);
        if (feature) {
          selectFeature(feature);
          setPropertiesOpen(true);
        } else {
          setError('Đối tượng không còn nằm trong khu vực hiển thị.');
        }
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Không thể tải đối tượng.'))
      .finally(() => setLoading(false));
  }, [hydrateGraph, selectFeature, setError, setLoading]);

  const refreshAfterCommit = useCallback(() => {
    graphCacheRef.current.clear();
    const viewport = viewportRef.current;
    if (viewport) refreshGraph(viewport);
  }, [refreshGraph]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) refreshGraph(viewport);
  }, [refreshGraph]);

  const retryCloseChangeset = useCallback(async (changesetId: string) => {
    setSaving(true);
    setSaveStatus('Đang hoàn tất lưu thay đổi…');
    try {
      await closeChangeset(changesetId);
      setPendingCloseId(null);
      setSaveStatus('Đã lưu thay đổi thành công.');
    } catch {
      setSaveStatus('Dữ liệu đã được lưu thành công.');
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

    setSaving(true);
    setSaveStatus('Đang lưu dữ liệu...');
    try {
      const created = await createChangeset(DATASET_NAME, CHANGESET_COMMENT);
      setSaveStatus(`Đang áp dụng ${uploadPayload.length} thay đổi…`);
      const committed = await uploadChangeset(created.id, uploadPayload);
      setLastCommittedChangesetId(committed.id);
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
      const message = reason instanceof Error ? reason.message : 'Lỗi không xác định.';
      const prefix = reason instanceof ChangesetApiError
        ? reason.phase === 'create' ? 'Không thể khởi tạo phiên lưu' : 'Không thể tải lên thay đổi'
        : 'Không thể lưu thay đổi';
      setSaveStatus(`${prefix}: ${message}`);
    } finally {
      setSaving(false);
    }
  }, [blockingIssues.length, changes, discardChanges, pendingCloseId, refreshAfterCommit, refreshPublishStatus, retryCloseChangeset, saving]);

  const handleExport = useCallback((format: 'osm' | 'osc') => {
    setExportAnchor(null);
    const query = new URLSearchParams({ dataset: DATASET_NAME });
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
  }, []);

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

  const handleRollbackLastCommit = useCallback(async () => {
    if (!lastCommittedChangesetId || saving) return;
    if (!window.confirm('Hoàn tác lần lưu gần nhất? Hệ thống sẽ tạo một changeset mới và chỉ thực hiện nếu chưa có chỉnh sửa xung đột.')) return;
    setExportAnchor(null);
    setSaving(true);
    setSaveStatus('Đang hoàn tác changeset…');
    try {
      const reverted = await rollbackChangeset(lastCommittedChangesetId);
      setLastCommittedChangesetId(reverted.id);
      graphCacheRef.current.clear();
      refreshAfterCommit();
      void refreshPublishStatus();
      setSaveStatus('Đã hoàn tác bằng changeset mới.');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Lỗi không xác định.';
      setSaveStatus(`Không thể hoàn tác: ${message}`);
    } finally {
      setSaving(false);
    }
  }, [lastCommittedChangesetId, refreshAfterCommit, refreshPublishStatus, saving]);

  const handleSelectFeature = useCallback((feature: GraphFeature | null) => {
    selectFeature(feature);
    if (feature) setPropertiesOpen(true);
  }, [selectFeature]);

  const handleSelectIssue = useCallback((issue: EditorIssue) => {
    const feature = features.find(item => entityKey(item) === issue.entityKey);
    if (!feature) return;
    handleSelectFeature(feature);
    setPinpoint(issue.coordinate);
  }, [features, handleSelectFeature]);

  const handleUpdateTags = useCallback((tags: Tags, label: string) => {
    if (selectedKey) updateTags(selectedKey, tags, label);
  }, [selectedKey, updateTags]);

  const handleUpdateRelationMembers = useCallback((members: RelationMember[], label: string) => {
    if (!selectedKey || selected?.type !== 'relation') return;
    const relation = features.find(feature => entityKey(feature) === selectedKey);
    if (!relation) return;
    replaceFeature({ ...relation, properties: { ...relation.properties, members } }, selectedKey, label);
  }, [features, replaceFeature, selected, selectedKey]);

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
    replaceFeature(feature, `relation/${id}`, 'Tạo quan hệ mới');
    selectFeature(feature);
    setPropertiesOpen(true);
  }, [replaceFeature, selectFeature, selected]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedKey) {
      replaceFeature(null, selectedKey, 'Xóa đối tượng');
      selectFeature(null);
    }
  }, [replaceFeature, selectFeature, selectedKey]);

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
    replaceFeatures(mutations, 'Di chuyển điểm');
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
    replaceFeatures(mutations, vertex.segment ? 'Nối điểm vào đường' : 'Thêm điểm mới');
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
      if (key === 'z' && !event.shiftKey && canUndo) {
        event.preventDefault();
        undo();
      }
      if ((key === 'y' || (key === 'z' && event.shiftKey)) && canRedo) {
        event.preventDefault();
        redo();
      }
      if (key === 's' && changeCount > 0 && !saving) {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activateDrawMode, canRedo, canUndo, changeCount, drawMode, handleCancelDrawing, handleDeleteSelected, handleFinishDrawing, handleSave, redo, saving, selectFeature, selected, selectedKey, undo]);

  return (
    <Box sx={{ height: '100dvh', display: 'grid', gridTemplateRows: '52px minmax(0, 1fr) 30px', overflow: 'hidden', bgcolor: '#f1f5f9' }}>
      <CssBaseline />
      <GlobalStyles styles={{
        '*': { boxSizing: 'border-box' },
        '.maplibregl-ctrl-group': { borderRadius: '8px !important', boxShadow: '0 4px 14px rgba(0, 0, 0, 0.15) !important', overflow: 'hidden' },
        '.maplibregl-ctrl button': { width: '36px !important', height: '36px !important' }
      }} />

      {/* Top Header / App Bar */}
      <AppBar
        position="static"
        elevation={0}
        sx={{
          background: 'linear-gradient(180deg, #9b192e 0%, #851224 100%)',
          color: '#ffffff',
          borderBottom: '1px solid rgba(0, 0, 0, 0.25)',
          zIndex: 10
        }}
      >
        <Toolbar variant="dense" sx={{ minHeight: '52px !important', px: 1.5, gap: 1.5 }}>
          {/* Logo & Application Title */}
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                display: 'grid',
                placeItems: 'center',
                bgcolor: '#ffffff',
                color: '#8b1327',
                borderRadius: 1.5,
                fontWeight: 900,
                fontSize: 16,
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
              }}
            >
              ⌖
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 800, fontSize: 14, letterSpacing: 0.5, lineHeight: 1.15 }}>
                GEODATA WEBGIS
              </Typography>
              <Typography sx={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.75)', letterSpacing: 0.2 }}>
                Biên tập & Quản lý bản đồ
              </Typography>
            </Box>
          </Stack>

          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255, 255, 255, 0.2)', mx: 0.5 }} />

          {/* Sync Status Badge */}
          <Tooltip title="Trạng thái đồng bộ dữ liệu bản đồ">
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                gap: 0.8,
                bgcolor: 'rgba(0, 0, 0, 0.18)',
                px: 1.2,
                py: 0.4,
                borderRadius: 4
              }}
            >
              <Box
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

          <Box sx={{ flex: 1 }} />

          {/* Feature count & actions */}
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
            {graphVisible && (
              <Typography sx={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.85)', display: { xs: 'none', sm: 'block' } }}>
                {features.length > 0 ? `${features.length.toLocaleString('vi-VN')} đối tượng` : 'Chưa có đối tượng'}
                {changeCount > 0 && ` · ${changeCount} chỉnh sửa`}
              </Typography>
            )}

            <Tooltip title="Đi tới vị trí theo tọa độ">
              <Button
                size="small"
                variant="text"
                onClick={event => setCoordinateAnchor(event.currentTarget)}
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
                Tọa độ
              </Button>
            </Tooltip>
            <Menu
              anchorEl={coordinateAnchor}
              open={Boolean(coordinateAnchor)}
              onClose={() => { setCoordinateAnchor(null); setCoordinateError(null); }}
              slotProps={{ paper: { sx: { width: 330, mt: 0.75, p: 1.5, borderRadius: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' } } }}
            >
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#1e293b', mb: 0.5 }}>Đi tới tọa độ</Typography>
              <Typography sx={{ fontSize: 11, color: '#64748b', mb: 1.25 }}>Nhập theo thứ tự vĩ độ, kinh độ.</Typography>
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
                <Button size="small" variant="contained" onClick={handleLocateCoordinate} sx={{ textTransform: 'none', bgcolor: '#9b192e', '&:hover': { bgcolor: '#851224' } }}>Định vị</Button>
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
                Xuất tệp ▾
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
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>Xuất tệp dữ liệu (.osm)</Typography>
                  <Typography sx={{ fontSize: 11, color: '#64748b' }}>Toàn bộ đối tượng trong vùng đang xem</Typography>
                </Box>
              </MenuItem>
              <MenuItem onClick={() => handleExport('osc')}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>Xuất tập thay đổi (.osc)</Typography>
                  <Typography sx={{ fontSize: 11, color: '#64748b' }}>Các chỉnh sửa đã lưu gần nhất</Typography>
                </Box>
              </MenuItem>
              <MenuItem disabled={!lastCommittedChangesetId || saving} onClick={() => void handleRollbackLastCommit()}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#9b192e' }}>Hoàn tác lần lưu gần nhất</Typography>
                  <Typography sx={{ fontSize: 11, color: '#64748b' }}>Tạo changeset mới, không ghi đè lịch sử</Typography>
                </Box>
              </MenuItem>
            </Menu>

            {/* Prominent Save Button */}
            <Tooltip title={changeCount > 0 ? `Lưu ${changeCount} thay đổi vào hệ thống (Ctrl+S)` : 'Không có thay đổi nào cần lưu'}>
              <span>
                <Button
                  size="small"
                  variant="contained"
                  disabled={saving || (!changeCount && !pendingCloseId)}
                  onClick={() => void handleSave()}
                  sx={{
                    minWidth: 100,
                    height: 32,
                    borderRadius: 1.5,
                    bgcolor: changeCount > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0.2)',
                    color: changeCount > 0 ? '#8b1327' : 'rgba(255, 255, 255, 0.65)',
                    fontSize: 12,
                    fontWeight: 800,
                    textTransform: 'none',
                    boxShadow: changeCount > 0 ? '0 2px 8px rgba(0,0,0,0.2)' : 'none',
                    '&:hover': {
                      bgcolor: changeCount > 0 ? '#fceef0' : 'rgba(255, 255, 255, 0.3)'
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

      {/* Main Workspace Body */}
      <Box sx={{ display: 'flex', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {/* Map Canvas Area */}
        <Box sx={{ position: 'relative', minWidth: 0, flex: 1, overflow: 'hidden', bgcolor: '#e2e8f0' }}>
          {/* iD Editor / JOSM Style Floating Central Toolbar */}
          <Paper
            elevation={4}
            sx={{
              position: 'absolute',
              zIndex: 10,
              top: 14,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              p: 0.5,
              borderRadius: 2.5,
              bgcolor: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.16)',
              border: '1px solid rgba(0, 0, 0, 0.08)'
            }}
          >
            <Tooltip title="Chọn & Xem đối tượng (Esc / S)" placement="bottom">
              <Button
                size="small"
                onClick={() => activateDrawMode('select')}
                sx={{
                  minWidth: 42,
                  height: 38,
                  px: 1.25,
                  borderRadius: 2,
                  bgcolor: drawMode === 'select' ? '#9b192e' : 'transparent',
                  color: drawMode === 'select' ? '#ffffff' : '#334155',
                  fontWeight: 700,
                  fontSize: 12,
                  textTransform: 'none',
                  display: 'flex',
                  gap: 0.6,
                  '&:hover': {
                    bgcolor: drawMode === 'select' ? '#851224' : 'rgba(155, 25, 46, 0.08)'
                  }
                }}
              >
                <span style={{ fontSize: 16 }}>⌖</span> Chọn
              </Button>
            </Tooltip>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.8 }} />

            <Tooltip title="Vẽ điểm (Phím 1)" placement="bottom">
              <Button
                size="small"
                onClick={() => activateDrawMode('point')}
                sx={{
                  minWidth: 42,
                  height: 38,
                  px: 1.25,
                  borderRadius: 2,
                  bgcolor: drawMode === 'point' ? '#9b192e' : 'transparent',
                  color: drawMode === 'point' ? '#ffffff' : '#334155',
                  fontWeight: 700,
                  fontSize: 12,
                  textTransform: 'none',
                  display: 'flex',
                  gap: 0.6,
                  '&:hover': {
                    bgcolor: drawMode === 'point' ? '#851224' : 'rgba(155, 25, 46, 0.08)'
                  }
                }}
              >
                <span style={{ fontSize: 16 }}>●</span> Điểm
              </Button>
            </Tooltip>

            <Tooltip title="Vẽ đường (Phím 2)" placement="bottom">
              <Button
                size="small"
                onClick={() => activateDrawMode('line')}
                sx={{
                  minWidth: 42,
                  height: 38,
                  px: 1.25,
                  borderRadius: 2,
                  bgcolor: drawMode === 'line' ? '#9b192e' : 'transparent',
                  color: drawMode === 'line' ? '#ffffff' : '#334155',
                  fontWeight: 700,
                  fontSize: 12,
                  textTransform: 'none',
                  display: 'flex',
                  gap: 0.6,
                  '&:hover': {
                    bgcolor: drawMode === 'line' ? '#851224' : 'rgba(155, 25, 46, 0.08)'
                  }
                }}
              >
                <span style={{ fontSize: 16 }}>╱</span> Đường
              </Button>
            </Tooltip>

            <Tooltip title="Vẽ vùng (Phím 3)" placement="bottom">
              <Button
                size="small"
                onClick={() => activateDrawMode('area')}
                sx={{
                  minWidth: 42,
                  height: 38,
                  px: 1.25,
                  borderRadius: 2,
                  bgcolor: drawMode === 'area' ? '#9b192e' : 'transparent',
                  color: drawMode === 'area' ? '#ffffff' : '#334155',
                  fontWeight: 700,
                  fontSize: 12,
                  textTransform: 'none',
                  display: 'flex',
                  gap: 0.6,
                  '&:hover': {
                    bgcolor: drawMode === 'area' ? '#851224' : 'rgba(155, 25, 46, 0.08)'
                  }
                }}
              >
                <span style={{ fontSize: 16 }}>▱</span> Vùng
              </Button>
            </Tooltip>

            <Tooltip title="Tạo quan hệ từ đối tượng đang chọn" placement="bottom">
              <Button
                size="small"
                onClick={handleCreateRelation}
                sx={{
                  minWidth: 42,
                  height: 38,
                  px: 1.1,
                  borderRadius: 2,
                  color: '#5b21b6',
                  fontWeight: 700,
                  fontSize: 12,
                  textTransform: 'none',
                  display: 'flex',
                  gap: 0.5,
                  '&:hover': { bgcolor: '#f1edff' }
                }}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }}>∞</span> Quan hệ
              </Button>
            </Tooltip>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.8 }} />

            <Tooltip title="Hoàn tác (Ctrl+Z)" placement="bottom">
              <span>
                <IconButton
                  size="small"
                  disabled={!canUndo}
                  onClick={undo}
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: 2,
                    color: canUndo ? '#334155' : '#cbd5e1',
                    '&:hover': { bgcolor: 'rgba(155, 25, 46, 0.08)' }
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 700 }}>↶</span>
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Làm lại (Ctrl+Y)" placement="bottom">
              <span>
                <IconButton
                  size="small"
                  disabled={!canRedo}
                  onClick={redo}
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: 2,
                    color: canRedo ? '#334155' : '#cbd5e1',
                    '&:hover': { bgcolor: 'rgba(155, 25, 46, 0.08)' }
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 700 }}>↷</span>
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
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 0.8,
                borderRadius: 2,
                bgcolor: '#ffffff',
                border: '1px solid #fed7aa',
                boxShadow: '0 4px 14px rgba(0,0,0,0.1)'
              }}
            >
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#9a3412' }}>
                {drawMode === 'point' && 'Nhấp chuột lên vị trí bất kỳ trên bản đồ để đặt điểm.'}
                {drawMode === 'line' && `Đang vẽ đường (${drawVertices.length} điểm): Nhấp để thêm đỉnh, Enter để hoàn tất.`}
                {drawMode === 'area' && `Đang vẽ vùng (${drawVertices.length} điểm): Nhấp điểm đầu hoặc Enter để khép vùng.`}
              </Typography>
              {(drawMode === 'line' || drawMode === 'area') && drawVertices.length >= (drawMode === 'area' ? 3 : 2) && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleFinishDrawing}
                  sx={{
                    borderRadius: 1.5,
                    bgcolor: '#9b192e',
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'none',
                    py: 0.3,
                    '&:hover': { bgcolor: '#851224' }
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
                  color: '#64748b'
                }}
              >
                Hủy (Esc)
              </Button>
            </Paper>
          )}

          {/* Low Zoom Guidance Alert (iD / JOSM style) */}
          {!graphVisible && (
            <Paper
              elevation={2}
              sx={{
                position: 'absolute',
                zIndex: 8,
                bottom: 24,
                left: '50%',
                transform: 'translateX(-50%)',
                px: 2,
                py: 1,
                borderRadius: 2,
                bgcolor: 'rgba(30, 41, 59, 0.92)',
                color: '#ffffff',
                backdropFilter: 'blur(4px)',
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
                position: 'absolute', zIndex: 10, top: 72, left: 16, width: 320,
                maxHeight: 'calc(100% - 160px)', overflowY: 'auto', borderRadius: 2,
                border: '1px solid #e2e8f0', bgcolor: '#ffffff', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)'
              }}
            >
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1.4, py: 1, borderBottom: '1px solid #e2e8f0', bgcolor: blockingIssues.length ? '#fff1f2' : '#f0fdf4' }}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#1e293b' }}>Kiểm tra dữ liệu</Typography>
                  <Typography sx={{ fontSize: 10.5, color: '#64748b' }}>Chỉ kiểm tra đối tượng đang sửa</Typography>
                </Box>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                  {blockingIssues.length > 0 && <Chip label={`${blockingIssues.length} lỗi`} size="small" sx={{ height: 20, fontSize: 10, fontWeight: 800, bgcolor: '#fee2e2', color: '#b4233c' }} />}
                  {issues.length > blockingIssues.length && <Chip label={`${issues.length - blockingIssues.length} lưu ý`} size="small" sx={{ height: 20, fontSize: 10, fontWeight: 800, bgcolor: '#fef3c7', color: '#92400e' }} />}
                  <Tooltip title="Thu gọn kiểm tra dữ liệu"><IconButton size="small" onClick={() => setIssuesOpen(false)} sx={{ color: '#64748b' }}>×</IconButton></Tooltip>
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
                      sx={{ alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left', borderRadius: 1.25, px: 0.9, py: 0.75, textTransform: 'none', color: '#1e293b', bgcolor: issue.severity === 'error' ? '#fff7f7' : '#fffbeb', '&:hover': { bgcolor: issue.severity === 'error' ? '#fee2e2' : '#fef3c7' } }}
                    >
                      <Box>
                        <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: issue.severity === 'error' ? '#b4233c' : '#92400e' }}>{issue.title}</Typography>
                        <Typography sx={{ mt: 0.2, fontSize: 10.5, lineHeight: 1.35, color: '#475569' }}>{issue.detail}</Typography>
                      </Box>
                    </Button>
                  ))}
                  {issues.length > 12 && <Typography sx={{ px: 0.75, color: '#64748b', fontSize: 11 }}>Và {issues.length - 12} vấn đề khác.</Typography>}
                </Stack>
              )}
            </Paper>
          )}
          {graphVisible && changeCount > 0 && !issuesOpen && (
            <Button onClick={() => setIssuesOpen(true)} size="small" variant="contained" sx={{ position: 'absolute', zIndex: 10, top: 72, left: 16, borderRadius: 1.5, bgcolor: blockingIssues.length ? '#b4233c' : '#15803d', textTransform: 'none', fontSize: 11, fontWeight: 800 }}>
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
                maxWidth: 440,
                px: 1.5,
                py: 1,
                borderRadius: 2,
                bgcolor: '#ffffff',
                borderLeft: '4px solid #9b192e',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)'
              }}
            >
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#1e293b' }}>
                {saveStatus}
              </Typography>
              <IconButton size="small" onClick={() => setSaveStatus(null)} sx={{ color: '#94a3b8' }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>×</span>
              </IconButton>
            </Paper>
          )}

          {/* The Underlying Map Component */}
          <MapCanvas
            features={graphVisible ? features : []}
            pinpoint={pinpoint}
            drawMode={drawMode}
            drawVertices={drawVertices}
            selected={selected}
            onBoundsChange={refreshGraph}
            onSelect={handleSelectFeature}
            onSelectEntity={handleSelectEntity}
            onDrawVertex={handleDrawVertex}
            onFinishDrawing={handleFinishDrawing}
            onCancelDrawing={handleCancelDrawing}
            onMoveNode={handleMoveNode}
            onPointerStatus={handlePointerStatus}
          />
        </Box>

        {/* Feature Properties Inspector Sidebar (iD / JOSM Style) */}
        {selected && propertiesOpen && (
          <Paper
            square
            sx={{
              width: propertiesWidth,
              borderLeft: '1px solid #e2e8f0',
              bgcolor: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 9,
              boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.06)',
              overflowY: 'auto'
            }}
          >
            {/* Inspector Header */}
            <Box
              sx={{
                p: 2,
                bgcolor: '#fff7f8',
                borderBottom: '1px solid #ebd7db'
              }}
            >
              <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 0.8, mb: 0.5 }}>
                    <Chip
                      label={selected.type === 'node' ? 'Điểm' : selected.type === 'way' ? (selected.geometry.type === 'Polygon' ? 'Vùng' : 'Đường') : 'Quan hệ'}
                      size="small"
                      sx={{
                        bgcolor: '#9b192e',
                        color: '#ffffff',
                        fontWeight: 800,
                        fontSize: 10,
                        height: 20
                      }}
                    />
                  </Stack>
                  <Typography noWrap sx={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>
                    {selectedName}
                  </Typography>
                </Box>
                <Tooltip title="Đóng bảng thuộc tính (Esc)">
                  <IconButton
                    size="small"
                    onClick={() => setPropertiesOpen(false)}
                    sx={{ color: '#64748b', '&:hover': { bgcolor: '#fceef0', color: '#9b192e' } }}
                  >
                    <span style={{ fontSize: 18, lineHeight: 1 }}>×</span>
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>

            {/* Inspector Form Editor */}
            <PropertiesEditor
              selected={selected}
              onUpdate={handleUpdateTags}
              onDelete={handleDeleteSelected}
              onUpdateMembers={handleUpdateRelationMembers}
            />
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
                color: '#9b192e',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                '&:hover': { bgcolor: '#fceef0' }
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 700 }}>›</span>
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Modern Status Footer Bar (JOSM / iD style) */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 2,
          bgcolor: '#1e293b',
          color: '#e2e8f0',
          borderTop: '1px solid #0f172a',
          fontSize: 11,
          userSelect: 'none'
        }}
      >
        {/* Status Indicator */}
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              bgcolor: error ? '#ef4444' : loading ? '#f59e0b' : '#10b981'
            }}
          />
          <Typography sx={{ fontSize: 11, color: '#f1f5f9' }}>
            {error ? error : loading ? 'Đang tải dữ liệu...' : changeCount > 0 ? `${changeCount} thay đổi chưa lưu` : 'Sẵn sàng làm việc'}
          </Typography>
        </Stack>

        <Box sx={{ flex: 1 }} />

        {/* Pointer Position & Zoom HUD */}
        <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mr: 2 }}>
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
              onClick={discardChanges}
              sx={{ minWidth: 0, px: 1, py: 0, color: '#fca5a5', fontSize: 10.5, textTransform: 'none', '&:hover': { bgcolor: 'rgba(239, 68, 68, 0.15)' } }}
            >
              Hủy thay đổi
            </Button>
          </Stack>
        )}

        <Typography sx={{ fontSize: 10.5, color: '#64748b' }}>
          Hệ thống Quản lý Dữ liệu Địa lý
        </Typography>
      </Box>
    </Box>
  );
}
