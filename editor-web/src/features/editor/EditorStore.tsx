import { createContext, useCallback, useContext, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { GraphFeature, SelectedEntity, Tags } from '../../types/osm';
import { sameEntityContent, type ResolutionPlan } from './conflictResolution';

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

export interface FeatureMutation {
  key: EntityKey;
  feature: GraphFeature | null;
}

interface EditorState {
  baseFeatures: Record<EntityKey, GraphFeature>;
  viewportKeys: EntityKey[];
  overrides: Record<EntityKey, GraphFeature | null>;
  selectedKey: EntityKey | null;
  undoStack: EditorTransaction[];
  redoStack: EditorTransaction[];
  nextChangeId: number;
  loading: boolean;
  error: string | null;
}

type EditorAction =
  | { type: 'hydrate'; features: GraphFeature[] }
  | { type: 'hydrate-support'; features: GraphFeature[] }
  | { type: 'resolve-conflicts'; plan: ResolutionPlan }
  | { type: 'select'; key: EntityKey | null }
  | { type: 'loading'; value: boolean }
  | { type: 'error'; value: string | null }
  | { type: 'commit'; key: EntityKey; feature: GraphFeature | null; label: string }
  | { type: 'commit-many'; mutations: FeatureMutation[]; label: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'discard' };

export const initialState: EditorState = {
  baseFeatures: {},
  viewportKeys: [],
  overrides: {},
  selectedKey: null,
  undoStack: [],
  redoStack: [],
  nextChangeId: 1,
  loading: false,
  error: null
};

export function entityKey(feature: Pick<GraphFeature, 'properties'>): EntityKey {
  return `${feature.properties.entityType}/${feature.properties.entityId}`;
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

function equalOverride(left: FeatureOverride, right: FeatureOverride): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
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
  if (base && feature && equalOverride(base, feature)) return undefined;
  if (!base && feature === null) return undefined;
  return feature;
}

function writeOverride(overrides: EditorState['overrides'], key: EntityKey, override: FeatureOverride): void {
  if (override === undefined) delete overrides[key];
  else overrides[key] = override ? cloneFeature(override) : null;
}

function withOverride(state: EditorState, key: EntityKey, override: FeatureOverride): EditorState['overrides'] {
  const overrides = { ...state.overrides };
  writeOverride(overrides, key, override);
  return overrides;
}

function applyHistoryEntry(state: EditorState, entry: EditorTransaction, direction: 'undo' | 'redo'): EditorState {
  const overrides = { ...state.overrides };
  const changes = direction === 'undo' ? [...entry.changes].reverse() : entry.changes;
  for (const change of changes) writeOverride(overrides, change.key, direction === 'undo' ? change.before : change.after);
  return { ...state, overrides };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
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
      const baseFeatures: Record<EntityKey, GraphFeature> = Object.fromEntries(
        Object.entries(state.baseFeatures).filter(([key]) => retained.has(key))
      );
      const viewportKeys: EntityKey[] = [];
      for (const feature of action.features) {
        const key = entityKey(feature);
        if (!retained.has(key)) baseFeatures[key] = cloneFeature(feature);
        viewportKeys.push(key);
        if (feature.properties.entityType !== 'way') continue;
        for (const node of feature.properties.nodes ?? []) {
          const nodeKey: EntityKey = `node/${node.id}`;
          if (baseFeatures[nodeKey]) continue;
          baseFeatures[nodeKey] = {
            type: 'Feature',
            id: `node-${node.id}`,
            properties: { entityType: 'node', entityId: node.id, version: node.version ?? 1, tags: node.tags ?? {}, coordinates: node.coordinates, topologyNode: true },
            geometry: { type: 'Point', coordinates: node.coordinates }
          };
        }
      }
      const selected = state.selectedKey ? readFeature({ ...state, baseFeatures }, state.selectedKey) : null;
      return { ...state, baseFeatures, viewportKeys, selectedKey: selected ? state.selectedKey : null };
    }
    case 'select':
      return { ...state, selectedKey: action.key };
    case 'loading':
      return { ...state, loading: action.value };
    case 'error':
      return { ...state, error: action.value };
    case 'commit': {
      const before = readOverride(state, action.key);
      const after = normalizedOverride(state, action.key, action.feature);
      if (equalOverride(before, after)) return state;
      const change: EditorChange = { id: state.nextChangeId, key: action.key, label: action.label, before: cloneOverride(before), after: cloneOverride(after) };
      return {
        ...state,
        overrides: withOverride(state, action.key, after),
        undoStack: [...state.undoStack, { id: state.nextChangeId, label: action.label, changes: [change] }],
        redoStack: [],
        nextChangeId: state.nextChangeId + 1
      };
    }
    case 'commit-many': {
      const changes: EditorChange[] = [];
      const overrides = { ...state.overrides };
      for (const mutation of action.mutations) {
        const before = overrides[mutation.key];
        const after = normalizedOverride(state, mutation.key, mutation.feature);
        if (equalOverride(before, after)) continue;
        changes.push({ id: state.nextChangeId, key: mutation.key, label: action.label, before: cloneOverride(before), after: cloneOverride(after) });
        writeOverride(overrides, mutation.key, after);
      }
      if (!changes.length) return state;
      return { ...state, overrides, undoStack: [...state.undoStack, { id: state.nextChangeId, label: action.label, changes }], redoStack: [], nextChangeId: state.nextChangeId + 1 };
    }
    case 'undo': {
      const entry = state.undoStack.at(-1);
      if (!entry) return state;
      const restored = applyHistoryEntry(state, entry, 'undo');
      return { ...restored, undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, entry] };
    }
    case 'redo': {
      const entry = state.redoStack.at(-1);
      if (!entry) return state;
      const restored = applyHistoryEntry(state, entry, 'redo');
      return { ...restored, undoStack: [...state.undoStack, entry], redoStack: state.redoStack.slice(0, -1) };
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

function pendingChanges(state: EditorState): EditorChange[] {
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
  features: GraphFeature[];
  selected: SelectedEntity | null;
  selectedKey: EntityKey | null;
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
  selectFeature: (feature: GraphFeature | null) => void;
  updateTags: (key: EntityKey, tags: Tags, label?: string) => void;
  replaceFeature: (feature: GraphFeature | null, key: EntityKey, label: string) => void;
  replaceFeatures: (mutations: FeatureMutation[], label: string) => void;
  undo: () => void;
  redo: () => void;
  discardChanges: () => void;
}

const EditorStoreContext = createContext<EditorStoreValue | null>(null);

export function EditorStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, initialState);

  const hydrateGraph = useCallback((features: GraphFeature[]) => dispatch({ type: 'hydrate', features }), []);
  const hydrateSupport = useCallback((features: GraphFeature[]) => dispatch({ type: 'hydrate-support', features }), []);
  const resolveConflicts = useCallback((plan: ResolutionPlan) => dispatch({ type: 'resolve-conflicts', plan }), []);
  const setLoading = useCallback((value: boolean) => dispatch({ type: 'loading', value }), []);
  const setError = useCallback((value: string | null) => dispatch({ type: 'error', value }), []);
  const selectFeature = useCallback((feature: GraphFeature | null) => dispatch({ type: 'select', key: feature ? entityKey(feature) : null }), []);
  const replaceFeature = useCallback((feature: GraphFeature | null, key: EntityKey, label: string) => dispatch({ type: 'commit', key, feature, label }), []);
  const replaceFeatures = useCallback((mutations: FeatureMutation[], label: string) => dispatch({ type: 'commit-many', mutations, label }), []);
  const updateTags = useCallback((key: EntityKey, tags: Tags, label = 'Cập nhật thuộc tính') => {
    const feature = readFeature(state, key);
    if (!feature) return;
    const next = cloneFeature(feature);
    next.properties.tags = { ...tags };
    next.properties.name = next.properties.tags.name || '';
    dispatch({ type: 'commit', key, feature: next, label });
  }, [state]);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const discardChanges = useCallback(() => dispatch({ type: 'discard' }), []);

  // Loading/selection changes must not rebuild the full render graph, topology,
  // pending upload payload and issue list on every pointer interaction.
  const features = useMemo(() => visibleFeatures(state), [state.baseFeatures, state.viewportKeys, state.overrides]);
  const changes = useMemo(() => pendingChanges(state), [state.baseFeatures, state.overrides, state.undoStack]);
  const selected = useMemo(() => toSelectedEntity(state.selectedKey ? readFeature(state, state.selectedKey) : null), [state.baseFeatures, state.overrides, state.selectedKey]);

  const value = useMemo<EditorStoreValue>(() => {
    return {
      features,
      selected,
      selectedKey: state.selectedKey,
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
      updateTags,
      replaceFeature,
      replaceFeatures,
      undo,
      redo,
      discardChanges
    };
  }, [changes, discardChanges, features, hydrateGraph, hydrateSupport, redo, replaceFeature, replaceFeatures, resolveConflicts, selected, selectFeature, setError, setLoading, state, undo, updateTags]);

  return <EditorStoreContext.Provider value={value}>{children}</EditorStoreContext.Provider>;
}

export function useEditorStore(): EditorStoreValue {
  const store = useContext(EditorStoreContext);
  if (!store) throw new Error('useEditorStore must be used inside EditorStoreProvider.');
  return store;
}
