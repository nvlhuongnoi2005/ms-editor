import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GraphFeature, SelectedEntity, Tags } from '../../types/osm';
import { sameEntityContent, type ResolutionPlan } from './conflictResolution';
import { geometryLayer, lockViolation, protectedGeometry, type EditorLayer } from './geometryLocks';

// Entity keys are created exclusively by entityKey() and use "type/id" as their wire format.
export type EntityKey = string;
type FeatureOverride = GraphFeature | null | undefined;

export interface EditorChange {
  id: number;
  key: EntityKey;
  label: string;
  before: FeatureOverride;
  after: FeatureOverride;
}

interface EditorTransaction {
  id: number;
  label: string;
  changes: EditorChange[];
}

export const MAX_UNDO_TRANSACTIONS = 150;
const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const historySizes = new WeakMap<EditorTransaction, number>();
function historySize(entry: EditorTransaction): number {
  const cached = historySizes.get(entry);
  if (cached !== undefined) return cached;
  let size = 128;
  for (const change of entry.changes) for (const feature of [change.before, change.after]) if (feature) {
    const p = feature.properties, g = feature.geometry;
    const points = g.type === 'Point' ? 1 : g.type === 'LineString' ? g.coordinates.length : g.coordinates.reduce((sum, ring) => sum + ring.length, 0);
    size += 512 + points * 32 + (p.nodes?.length ?? 0) * 256 + (p.nodeIds?.length ?? 0) * 32 + (p.members?.length ?? 0) * 128;
    for (const [key, value] of Object.entries(p.tags)) size += (key.length + value.length) * 2 + 48;
  }
  historySizes.set(entry, size);
  return size;
}
function boundedHistory(entries: EditorTransaction[]): EditorTransaction[] {
  let start = entries.length, bytes = 0;
  while (start > 0 && entries.length - start < MAX_UNDO_TRANSACTIONS) {
    const size = historySize(entries[start - 1]);
    // Keep the latest transaction undoable, even if a single operation is huge.
    if (start < entries.length && bytes + size > MAX_HISTORY_BYTES) break;
    bytes += size; start--;
  }
  return start ? entries.slice(start) : entries;
}

export interface FeatureMutation {
  key: EntityKey;
  feature: GraphFeature | null;
}

export type CommandResult =
  | { status: 'applied'; changedKeys: string[] }
  | { status: 'noop' }
  | { status: 'blocked'; message: string };

/** Compare persisted content, not derived name/style/parent metadata or object-key order. */
export function samePersistedContent(a: GraphFeature | null, b: GraphFeature | null): boolean {
  if (!a || !b) return a === b;
  if (entityKey(a) !== entityKey(b)) return false;
  const tags = (feature: GraphFeature) => Object.entries(feature.properties.tags).sort(([a], [b]) => a.localeCompare(b));
  if (JSON.stringify(tags(a)) !== JSON.stringify(tags(b))) return false;
  if (a.properties.entityType === 'node') {
    if (a.geometry.type !== 'Point' || b.geometry.type !== 'Point') return false;
    return a.geometry.coordinates.every((value, index) => Math.round(value * 1e7) === Math.round(b.geometry.type === 'Point' ? b.geometry.coordinates[index] * 1e7 : NaN));
  }
  if (a.properties.entityType === 'way') return JSON.stringify(a.properties.nodeIds ?? []) === JSON.stringify(b.properties.nodeIds ?? []);
  const members = (feature: GraphFeature) => (feature.properties.members ?? []).map((member, index) => [member.type, member.ref, member.role ?? '', member.sequence ?? index]);
  return JSON.stringify(members(a)) === JSON.stringify(members(b));
}

export interface EditorState {
  lockedKeys: string[];
  lockedLayers: EditorLayer[];
  baseFeatures: Record<EntityKey, GraphFeature>;
  viewportKeys: EntityKey[];
  overrides: Record<EntityKey, GraphFeature | null>;
  selectedKey: EntityKey | null;
  selectedKeys: EntityKey[];
  undoStack: EditorTransaction[];
  redoStack: EditorTransaction[];
  nextChangeId: number;
  loading: boolean;
  error: string | null;
}

type EditorAction =
  | { type: 'lock'; keys?: string[]; layers?: EditorLayer[] }
  | { type: 'unlock-all' }
  | { type: 'remap-locks'; mapping: Record<string, string> }
  | { type: 'hydrate'; features: GraphFeature[] }
  | { type: 'hydrate-support'; features: GraphFeature[] }
  | { type: 'resolve-conflicts'; plan: ResolutionPlan }
  | { type: 'select'; key: EntityKey | null; mode: 'replace' | 'toggle' }
  | { type: 'select-set'; keys: EntityKey[]; active: EntityKey }
  | { type: 'loading'; value: boolean }
  | { type: 'error'; value: string | null }
  | { type: 'commit'; key: EntityKey; feature: GraphFeature | null; label: string }
  | { type: 'commit-many'; mutations: FeatureMutation[]; label: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'discard' };

export const initialState: EditorState = {
  lockedKeys: [], lockedLayers: [],
  baseFeatures: {},
  viewportKeys: [],
  overrides: {},
  selectedKey: null,
  selectedKeys: [],
  undoStack: [],
  redoStack: [],
  nextChangeId: 1,
  loading: false,
  error: null
};

export function entityKey(feature: Pick<GraphFeature, 'properties'>): EntityKey {
  return `${feature.properties.entityType}/${feature.properties.entityId}`;
}

/** Capture text still focused in the inspector without changing live undo granularity. */
export function capturePendingTags(state: EditorState, pending?: { key: string; tags: Tags } | null): EditorState {
  if (!pending) return state;
  const feature = readFeature(state, pending.key);
  if (!feature) return state;
  return executeTransaction(state, [{ key: pending.key, feature: { ...feature, properties: { ...feature.properties, tags: { ...pending.tags }, name: pending.tags.name ?? '' } } }], 'Khôi phục thuộc tính đang nhập').state;
}

function cloneFeature(feature: GraphFeature): GraphFeature {
  return {
    ...feature,
    geometry: structuredClone(feature.geometry),
    properties: {
      ...feature.properties,
      tags: { ...feature.properties.tags },
      ...(feature.properties.nodeIds ? { nodeIds: [...feature.properties.nodeIds] } : {}),
      ...(feature.properties.nodes ? { nodes: feature.properties.nodes.map(node => ({ ...node, coordinates: [...node.coordinates] as [number, number], ...(node.tags ? { tags: { ...node.tags } } : {}) })) } : {}),
      ...(feature.properties.members ? { members: feature.properties.members.map(member => ({ ...member })) } : {}),
      ...(feature.properties.parents ? { parents: feature.properties.parents.map(parent => ({ ...parent, tags: { ...parent.tags } })) } : {})
    }
  };
}

function cloneOverride(override: FeatureOverride): FeatureOverride {
  return override && cloneFeature(override);
}

function readOverride(state: EditorState, key: EntityKey): FeatureOverride {
  return Object.prototype.hasOwnProperty.call(state.overrides, key) ? state.overrides[key] : undefined;
}

function readFeature(state: EditorState, key: EntityKey, projectNodes = true): GraphFeature | null {
  const override = readOverride(state, key);
  const feature = override !== undefined ? override : state.baseFeatures[key] ?? null;
  if (!projectNodes || !feature || feature.properties.entityType !== 'way' || !feature.properties.nodes) return feature;
  let changed = false;
  const nodes = feature.properties.nodes.map(node => {
    const moved = state.overrides[`node/${node.id}`];
    if (!moved || moved.geometry.type !== 'Point') return node;
    changed = true;
    return { ...node, coordinates: moved.geometry.coordinates, version: moved.properties.version, tags: moved.properties.tags };
  });
  if (!changed) return feature;
  const coordinates = nodes.map(node => node.coordinates);
  return { ...feature, properties: { ...feature.properties, nodes }, geometry: feature.geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: [coordinates] } : { type: 'LineString', coordinates } };
}

function normalizedOverride(state: EditorState, key: EntityKey, feature: GraphFeature | null): FeatureOverride {
  const base = state.baseFeatures[key];
  if (base && feature && samePersistedContent(base, feature)) return undefined;
  if (!base && feature === null) return undefined;
  return feature;
}

function writeOverride(overrides: EditorState['overrides'], key: EntityKey, override: FeatureOverride): void {
  if (override === undefined) delete overrides[key];
  else overrides[key] = override ? cloneFeature(override) : null;
}

function applyHistoryEntry(state: EditorState, entry: EditorTransaction, direction: 'undo' | 'redo'): EditorState {
  const overrides = { ...state.overrides };
  const changes = direction === 'undo' ? [...entry.changes].reverse() : entry.changes;
  for (const change of changes) writeOverride(overrides, change.key, direction === 'undo' ? change.before : change.after);
  return { ...state, overrides };
}

export function executeTransaction(state: EditorState, mutations: FeatureMutation[], label: string): { state: EditorState; result: CommandResult } {
  const blocked = (message: string): { state: EditorState; result: CommandResult } => ({ state: { ...state, error: message }, result: { status: 'blocked', message } });
  if (mutations.some(item => item.feature && entityKey(item.feature) !== item.key)) return blocked('ID đối tượng không khớp transaction.');
  // Last write wins within a transaction. Only the final net change enters history.
  const final = [...new Map(mutations.map(item => [item.key, item])).values()];
  const effective = final.filter(item => !samePersistedContent(readFeature(state, item.key, false), item.feature));
  if (!effective.length) return { state: state.error ? { ...state, error: null } : state, result: { status: 'noop' } };
  const all = Object.keys({ ...state.baseFeatures, ...state.overrides }).flatMap(key => { const feature = readFeature(state, key); return feature ? [feature] : []; });
  if (lockViolation(all, state.lockedKeys, state.lockedLayers, effective)) return blocked('Thao tác tác động đối tượng/layer hoặc node dùng chung đang khóa. Hãy mở khóa trước.');
  const removed = new Set(effective.filter(item => !item.feature).map(item => item.key));
  const finalByKey = new Map(final.map(item => [item.key, item.feature]));
  // Validate final references, not intermediate writes. Never silently cascade deletion.
  const finalFeatures = new Map(all.map(feature => [entityKey(feature), feature]));
  for (const item of final) if (item.feature) finalFeatures.set(item.key, item.feature); else finalFeatures.delete(item.key);
  for (const current of finalFeatures.values()) {
    const feature = finalByKey.has(entityKey(current)) ? finalByKey.get(entityKey(current)) : current;
    if (!feature) continue;
    if (feature.properties.nodeIds?.some(id => removed.has(`node/${id}`)) || feature.properties.members?.some(member => removed.has(`${member.type}/${member.ref}`))) return blocked('Đối tượng còn được đường/quan hệ ngoài tập xóa sử dụng. Hãy bỏ liên kết hoặc chọn đủ đối tượng.');
  }
  for (const { key } of effective.filter(item => !item.feature)) {
    const feature = readFeature(state, key);
    for (const parent of feature?.properties.parents ?? []) {
      if (state.overrides[`relation/${parent.id}`] !== null && !removed.has(`relation/${parent.id}`) && !finalByKey.has(`relation/${parent.id}`) && !all.some(item => entityKey(item) === `relation/${parent.id}`)) return blocked(`Chưa tải quan hệ cha ${parent.id}. Không thể xác nhận xóa an toàn.`);
    }
  }
  const overrides = { ...state.overrides }, changes: EditorChange[] = [];
  for (const item of effective) {
    const before = readOverride(state, item.key);
    const after = normalizedOverride(state, item.key, item.feature);
    changes.push({ id: state.nextChangeId, key: item.key, label, before: cloneOverride(before), after: cloneOverride(after) });
    writeOverride(overrides, item.key, after);
  }
  const updated = { ...state, error: null, overrides };
  const selectedKeys = state.selectedKeys.filter(key => readFeature(updated, key));
  return { state: { ...updated, selectedKeys, selectedKey: state.selectedKey && selectedKeys.includes(state.selectedKey) ? state.selectedKey : selectedKeys.at(-1) ?? null,
    undoStack: boundedHistory([...state.undoStack, { id: state.nextChangeId, label, changes }]), redoStack: [], nextChangeId: state.nextChangeId + 1 }, result: { status: 'applied', changedKeys: changes.map(change => change.key) } };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const locked = state.lockedKeys.length > 0 || state.lockedLayers.length > 0;
  if (locked && ['undo', 'redo', 'select'].includes(action.type)) {
    const all = Object.keys({ ...state.baseFeatures, ...state.overrides }).flatMap(key => { const feature = readFeature(state, key); return feature ? [feature] : []; });
    if (action.type === 'select' && action.key) {
      const feature = readFeature(state, action.key);
      if (protectedGeometry(all, state.lockedKeys, state.lockedLayers).has(action.key) || (feature && state.lockedLayers.includes(geometryLayer(feature)))) return { ...state, error: 'Đối tượng đang khóa. Mở khóa từ menu chuột phải trước khi chọn.' };
    }
    const mutations = action.type === 'undo' || action.type === 'redo' ? (action.type === 'undo' ? state.undoStack : state.redoStack).at(-1)?.changes.map(change => ({ key: change.key, feature: readFeature(state, change.key) ?? change.after ?? change.before ?? null })) ?? [] : [];
    if (lockViolation(all, state.lockedKeys, state.lockedLayers, mutations)) return { ...state, error: 'Thao tác tác động đối tượng/layer hoặc node dùng chung đang khóa. Hãy mở khóa trước.' };
  }
  switch (action.type) {
    case 'lock':
      return { ...state, lockedKeys: [...new Set([...state.lockedKeys, ...(action.keys ?? [])])], lockedLayers: [...new Set([...state.lockedLayers, ...(action.layers ?? [])])], selectedKey: null, selectedKeys: [], error: null };
    case 'unlock-all': return { ...state, lockedKeys: [], lockedLayers: [], error: null };
    case 'remap-locks': return { ...state, lockedKeys: state.lockedKeys.map(key => action.mapping[key] ?? key) };
    case 'resolve-conflicts': {
      if (action.plan.blockers.length) return state;
      const baseFeatures = { ...state.baseFeatures };
      for (const key of action.plan.removedKeys) delete baseFeatures[key];
      for (const feature of action.plan.baselines) baseFeatures[entityKey(feature)] = cloneFeature(feature);
      const overrides: EditorState['overrides'] = {};
      const changes: EditorChange[] = [];
      const viewportKeys = new Set(state.viewportKeys.filter(key => !action.plan.removedKeys.includes(key)));
      for (const item of action.plan.entities) {
        if (item.base) baseFeatures[item.key] = cloneFeature(item.base);
        else delete baseFeatures[item.key];
        if (item.base || item.local) viewportKeys.add(item.key);
        else viewportKeys.delete(item.key);
        if (sameEntityContent(item.base, item.local)) continue;
        writeOverride(overrides, item.key, item.local);
        changes.push({ id: state.nextChangeId, key: item.key, label: 'Áp lại thay đổi trên bản server mới', before: undefined, after: cloneOverride(item.local) });
      }
      // Old undo entries use old versions. Start one new atomic transaction on
      // the refreshed baseline; undo/redo can never restore stale versions.
      return { ...state, baseFeatures, overrides, viewportKeys: [...viewportKeys],
        undoStack: changes.length ? [{ id: state.nextChangeId, label: 'Giải quyết xung đột', changes }] : [],
        redoStack: [], nextChangeId: state.nextChangeId + 1 };
    }
    case 'hydrate-support': {
      const protectedKeys = new Set([...Object.keys(state.overrides), ...[...state.undoStack, ...state.redoStack].flatMap(entry => entry.changes.map(change => change.key))]);
      const baseFeatures = { ...state.baseFeatures };
      const viewportKeys = new Set(state.viewportKeys);
      for (const feature of action.features) {
        const key = entityKey(feature);
        if (!protectedKeys.has(key)) baseFeatures[key] = cloneFeature(feature);
        viewportKeys.add(key);
      }
      return { ...state, baseFeatures, viewportKeys: [...viewportKeys] };
    }
    case 'hydrate': {
      // Preserve the original baseline for dirty entities and undo/redo history
      // across viewport reloads. Otherwise a modify can become a create on Save.
      const retained = new Set([
        ...Object.keys(state.overrides),
        ...[...state.undoStack, ...state.redoStack].flatMap(entry => entry.changes.map(change => change.key))
      ]);
      let keepLocked = new Set<string>();
      if (state.lockedKeys.length || state.lockedLayers.length) {
        const all = Object.keys({ ...state.baseFeatures, ...state.overrides }).flatMap(key => { const feature = readFeature(state, key); return feature ? [feature] : []; });
        keepLocked = protectedGeometry(all, state.lockedKeys, state.lockedLayers);
      }
      const baseFeatures: Record<EntityKey, GraphFeature> = Object.fromEntries(
        // Keep selection even when the next bounded viewport omits it. Unlike
        // dirty baselines, a clean selection may still refresh from the server.
        Object.entries(state.baseFeatures).filter(([key]) => retained.has(key) || state.selectedKeys.includes(key) || keepLocked.has(key))
      );
      const viewportKeys: EntityKey[] = [];
      const incomingKeys = new Set(action.features.map(entityKey));
      for (const feature of action.features) {
        const key = entityKey(feature);
        if (!retained.has(key)) baseFeatures[key] = cloneFeature(feature);
        viewportKeys.push(key);
        if (feature.properties.entityType !== 'way') continue;
        for (const node of feature.properties.nodes ?? []) {
          const nodeKey: EntityKey = `node/${node.id}`;
          if (baseFeatures[nodeKey] && (retained.has(nodeKey) || incomingKeys.has(nodeKey))) continue;
          baseFeatures[nodeKey] = {
            type: 'Feature',
            id: `node-${node.id}`,
            properties: { entityType: 'node', entityId: node.id, version: node.version ?? 1, tags: node.tags ?? {}, coordinates: node.coordinates, topologyNode: true },
            geometry: { type: 'Point', coordinates: node.coordinates }
          };
        }
      }
      const selectedKeys = state.selectedKeys.filter(key => Boolean(readFeature({ ...state, baseFeatures }, key)));
      const selectedKey = state.selectedKey && selectedKeys.includes(state.selectedKey)
        ? state.selectedKey
        : selectedKeys.at(-1) ?? null;
      return { ...state, baseFeatures, viewportKeys, selectedKeys, selectedKey };
    }
    case 'select': {
      if (!action.key) return { ...state, selectedKey: null, selectedKeys: [] };
      if (action.mode === 'replace') return { ...state, selectedKey: action.key, selectedKeys: [action.key] };
      if (!state.selectedKeys.includes(action.key)) {
        return { ...state, selectedKey: action.key, selectedKeys: [...state.selectedKeys, action.key] };
      }
      const selectedKeys = state.selectedKeys.filter(key => key !== action.key);
      return { ...state, selectedKeys, selectedKey: state.selectedKey === action.key ? selectedKeys.at(-1) ?? null : state.selectedKey };
    }
    case 'select-set': {
      const keys = [...new Set(action.keys)];
      if (!keys.length || !keys.includes(action.active) || keys.some(key => !readFeature(state, key))) return { ...state, error: 'Chưa tải đủ đối tượng để chọn cả nhóm.' };
      const all = Object.keys({ ...state.baseFeatures, ...state.overrides }).flatMap(key => { const feature = readFeature(state, key); return feature ? [feature] : []; });
      const protectedKeys = protectedGeometry(all, state.lockedKeys, state.lockedLayers);
      if (keys.some(key => protectedKeys.has(key))) return { ...state, error: 'Nhóm có đối tượng đang khóa. Không chọn một phần nhóm.' };
      return { ...state, error: null, selectedKeys: keys, selectedKey: action.active };
    }
    case 'loading':
      return { ...state, loading: action.value };
    case 'error':
      return { ...state, error: action.value };
    case 'commit': return executeTransaction(state, [{ key: action.key, feature: action.feature }], action.label).state;
    case 'commit-many': return executeTransaction(state, action.mutations, action.label).state;
    case 'undo': {
      const entry = state.undoStack.at(-1);
      if (!entry) return state;
      const restored = applyHistoryEntry(state, entry, 'undo');
      const selectedKeys = state.selectedKeys.filter(key => readFeature(restored, key));
      return { ...restored, error: null, selectedKeys, selectedKey: state.selectedKey && selectedKeys.includes(state.selectedKey) ? state.selectedKey : selectedKeys.at(-1) ?? null, undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, entry] };
    }
    case 'redo': {
      const entry = state.redoStack.at(-1);
      if (!entry) return state;
      const restored = applyHistoryEntry(state, entry, 'redo');
      const selectedKeys = state.selectedKeys.filter(key => readFeature(restored, key));
      return { ...restored, error: null, selectedKeys, selectedKey: state.selectedKey && selectedKeys.includes(state.selectedKey) ? state.selectedKey : selectedKeys.at(-1) ?? null, undoStack: [...state.undoStack, entry], redoStack: state.redoStack.slice(0, -1) };
    }
    case 'discard':
      return { ...state, overrides: {}, undoStack: [], redoStack: [] };
  }
}

function toSelectedEntity(feature: GraphFeature | null): SelectedEntity | null {
  if (!feature) return null;
  return {
    id: feature.properties.entityId,
    type: feature.properties.entityType,
    version: feature.properties.version,
    tags: feature.properties.tags,
    geometry: feature.geometry,
    ...(feature.properties.members ? { members: feature.properties.members.map(member => ({ ...member })) } : {}),
    ...(feature.properties.parents ? { parents: feature.properties.parents.map(parent => ({ ...parent, tags: { ...parent.tags } })) } : {})
  };
}

export function visibleFeatures(state: EditorState): GraphFeature[] {
  const projectNodes = Object.keys(state.overrides).some(key => key.startsWith('node/'));
  const renderedKeys = new Set<EntityKey>();
  const features = state.viewportKeys.flatMap(key => {
    renderedKeys.add(key);
    const feature = readFeature(state, key, projectNodes);
    return feature ? [feature] : [];
  });
  for (const [key, feature] of Object.entries(state.overrides)) {
    if (!renderedKeys.has(key) && feature) features.push(readFeature(state, key, projectNodes)!);
  }
  return features;
}

export function pendingChanges(state: EditorState): EditorChange[] {
  const labels = new Map<EntityKey, string>();
  for (let index = state.undoStack.length - 1; index >= 0; index--) {
    const transaction = state.undoStack[index];
    for (const change of transaction.changes) if (!labels.has(change.key)) labels.set(change.key, transaction.label);
  }
  return Object.entries(state.overrides).map(([key, after], index) => {
    const before = state.baseFeatures[key];
    const latestLabel = labels.get(key);
    return {
      id: index + 1,
      key,
      label: latestLabel ?? (after === null ? 'Xóa đối tượng' : before ? 'Cập nhật đối tượng' : 'Tạo đối tượng'),
      before: before ? cloneFeature(before) : undefined,
      after: after ? cloneFeature(after) : null
    };
  });
}

interface EditorStoreValue {
  protectedKeys: ReadonlySet<string>;
  lockedKeys: string[];
  lockedLayers: EditorLayer[];
  lockGeometry: (keys: string[], layers: EditorLayer[]) => void;
  unlockGeometry: () => void;
  remapGeometryLocks: (mapping: Record<string, string>) => void;
  features: GraphFeature[];
  selected: SelectedEntity | null;
  selectedKey: EntityKey | null;
  selectedKeys: EntityKey[];
  selectedFeatures: SelectedEntity[];
  loading: boolean;
  error: string | null;
  changes: EditorChange[];
  changeCount: number;
  canUndo: boolean;
  canRedo: boolean;
  hydrateGraph: (features: GraphFeature[]) => void;
  hydrateSupport: (features: GraphFeature[]) => void;
  resolveConflicts: (plan: ResolutionPlan) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectFeature: (feature: GraphFeature | null, mode?: 'replace' | 'toggle') => void;
  selectFeatureSet: (features: GraphFeature[], active: GraphFeature) => CommandResult;
  updateTags: (key: EntityKey, tags: Tags, label?: string) => CommandResult;
  replaceFeature: (feature: GraphFeature | null, key: EntityKey, label: string) => CommandResult;
  replaceFeatures: (mutations: FeatureMutation[], label: string) => CommandResult;
  undo: () => CommandResult;
  redo: () => CommandResult;
  getFeatures: () => GraphFeature[];
  draftToken: object;
  getDraftState: () => EditorState;
  restoreDraftState: (snapshot: EditorState) => void;
  discardChanges: () => void;
}

const EditorStoreContext = createContext<EditorStoreValue | null>(null);

export function EditorStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(initialState);
  // Publish synchronously so commands and their follow-up selections see the same
  // authoritative state even inside one React-batched event.
  const publish = useCallback((next: EditorState) => { stateRef.current = next; setState(next); }, []);
  const dispatch = useCallback((action: EditorAction) => {
    const next = editorReducer(stateRef.current, action); publish(next); return next;
  }, [publish]);
  const getFeatures = useCallback(() => Object.keys({ ...stateRef.current.baseFeatures, ...stateRef.current.overrides }).flatMap(key => {
    const feature = readFeature(stateRef.current, key);
    if (!feature) return [];
    const parents = feature.properties.parents?.filter(parent => {
      const key = `relation/${parent.id}`;
      if (stateRef.current.overrides[key] === null) return false;
      const relation = readFeature(stateRef.current, key, false);
      return !relation?.properties.members || relation.properties.members.some(member => `${member.type}/${member.ref}` === entityKey(feature));
    });
    return [{ ...feature, properties: { ...feature.properties, ...(parents ? { parents } : {}) } }];
  }), []);
  const lockGeometry = useCallback((keys: string[], layers: EditorLayer[]) => dispatch({ type: 'lock', keys, layers }), []);
  const unlockGeometry = useCallback(() => dispatch({ type: 'unlock-all' }), []);
  const remapGeometryLocks = useCallback((mapping: Record<string, string>) => dispatch({ type: 'remap-locks', mapping }), []);

  const hydrateGraph = useCallback((features: GraphFeature[]) => dispatch({ type: 'hydrate', features }), []);
  const hydrateSupport = useCallback((features: GraphFeature[]) => dispatch({ type: 'hydrate-support', features }), []);
  const resolveConflicts = useCallback((plan: ResolutionPlan) => dispatch({ type: 'resolve-conflicts', plan }), []);
  const setLoading = useCallback((value: boolean) => dispatch({ type: 'loading', value }), []);
  const setError = useCallback((value: string | null) => dispatch({ type: 'error', value }), []);
  const selectFeature = useCallback((feature: GraphFeature | null, mode: 'replace' | 'toggle' = 'replace') => dispatch({ type: 'select', key: feature ? entityKey(feature) : null, mode }), []);
  const selectFeatureSet = useCallback((features: GraphFeature[], active: GraphFeature): CommandResult => {
    const next = dispatch({ type: 'select-set', keys: features.map(entityKey), active: entityKey(active) });
    return next.error ? { status: 'blocked', message: next.error } : { status: 'applied', changedKeys: next.selectedKeys };
  }, [dispatch]);
  const replaceFeatures = useCallback((mutations: FeatureMutation[], label: string) => {
    const command = executeTransaction(stateRef.current, mutations, label); publish(command.state); return command.result;
  }, [publish]);
  const replaceFeature = useCallback((feature: GraphFeature | null, key: EntityKey, label: string) => replaceFeatures([{ key, feature }], label), [replaceFeatures]);
  const updateTags = useCallback((key: EntityKey, tags: Tags, label = 'Cập nhật thuộc tính') => {
    const feature = readFeature(stateRef.current, key);
    if (!feature) return { status: 'blocked', message: 'Đối tượng không còn trong dữ liệu đã tải.' } as CommandResult;
    const next = cloneFeature(feature);
    next.properties.tags = { ...tags };
    next.properties.name = next.properties.tags.name || '';
    return replaceFeature(next, key, label);
  }, [replaceFeature]);
  const historyCommand = useCallback((type: 'undo' | 'redo'): CommandResult => {
    const before = stateRef.current, stack = type === 'undo' ? before.undoStack : before.redoStack;
    if (!stack.length) return { status: 'noop' };
    const next = dispatch({ type });
    if ((type === 'undo' ? next.undoStack : next.redoStack).length === stack.length) return { status: 'blocked', message: next.error ?? 'Không thể hoàn tác/làm lại.' };
    return { status: 'applied', changedKeys: stack.at(-1)!.changes.map(change => change.key) };
  }, [dispatch]);
  const undo = useCallback(() => historyCommand('undo'), [historyCommand]);
  const redo = useCallback(() => historyCommand('redo'), [historyCommand]);
  const discardChanges = useCallback(() => dispatch({ type: 'discard' }), []);
  // Snapshot builders clone only retained dependencies; do not clone an entire
  // viewport graph first. Consumers must treat this synchronous read as immutable.
  const getDraftState = useCallback(() => stateRef.current, []);
  const restoreDraftState = useCallback((snapshot: EditorState) => {
    const copy = structuredClone(snapshot);
    publish({ ...copy, undoStack: boundedHistory(copy.undoStack), redoStack: boundedHistory(copy.redoStack), loading: false, error: null });
  }, [publish]);
  const draftToken = useMemo(() => ({}), [state.overrides, state.undoStack, state.redoStack, state.lockedKeys, state.lockedLayers]);

  // Loading/selection changes must not rebuild the full render graph, topology,
  // pending upload payload and issue list on every pointer interaction.
  const features = useMemo(() => visibleFeatures(state), [state.baseFeatures, state.viewportKeys, state.overrides]);
  const protectedKeys = useMemo(() => {
    if (!state.lockedKeys.length && !state.lockedLayers.length) return new Set<string>();
    const all = Object.keys({ ...state.baseFeatures, ...state.overrides }).flatMap(key => { const feature = readFeature(state, key); return feature ? [feature] : []; });
    return protectedGeometry(all, state.lockedKeys, state.lockedLayers);
  }, [state.baseFeatures, state.overrides, state.lockedKeys, state.lockedLayers]);
  const changes = useMemo(() => pendingChanges(state), [state.baseFeatures, state.overrides, state.undoStack]);
  const selected = useMemo(() => toSelectedEntity(state.selectedKey ? readFeature(state, state.selectedKey) : null), [state.baseFeatures, state.overrides, state.selectedKey]);
  const selectedFeatures = useMemo(() => state.selectedKeys.flatMap(key => {
    const feature = readFeature(state, key);
    const entity = toSelectedEntity(feature);
    return entity ? [entity] : [];
  }), [state.baseFeatures, state.overrides, state.selectedKeys]);

  const value = useMemo<EditorStoreValue>(() => {
    return {
      protectedKeys, lockedKeys: state.lockedKeys, lockedLayers: state.lockedLayers, lockGeometry, unlockGeometry, remapGeometryLocks,
      features,
      getFeatures,
      draftToken, getDraftState, restoreDraftState,
      selected,
      selectedKey: state.selectedKey,
      selectedKeys: state.selectedKeys,
      selectedFeatures,
      loading: state.loading,
      error: state.error,
      changes,
      changeCount: Object.keys(state.overrides).length,
      canUndo: state.undoStack.length > 0,
      canRedo: state.redoStack.length > 0,
      hydrateGraph,
      hydrateSupport,
      resolveConflicts,
      setLoading,
      setError,
      selectFeature,
      selectFeatureSet,
      updateTags,
      replaceFeature,
      replaceFeatures,
      undo,
      redo,
      discardChanges
    };
  }, [changes, discardChanges, features, hydrateGraph, hydrateSupport, redo, replaceFeature, replaceFeatures, resolveConflicts, selected, selectedFeatures, selectFeature, setError, setLoading, state, undo, updateTags]);

  return <EditorStoreContext.Provider value={value}>{children}</EditorStoreContext.Provider>;
}

export function useEditorStore(): EditorStoreValue {
  const store = useContext(EditorStoreContext);
  if (!store) throw new Error('useEditorStore must be used inside EditorStoreProvider.');
  return store;
}
