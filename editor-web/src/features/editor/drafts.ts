import type { EditorState } from './EditorStore';
import { parseFeature } from '../../api/graph';
import type { DrawMode, SnappedVertex } from './drawing';
import type { WayExtension } from './drawingTransactions';
import type { Coordinate } from '../../types/osm';

export interface DraftWorkspace {
  mode: DrawMode;
  vertices: SnappedVertex[];
  extension: WayExtension | null;
  nextIds: { node: number; way: number; relation: number };
  camera?: { center: Coordinate; zoom: number; bearing: number; pitch: number };
}

export interface DraftRecord {
  schema: 1;
  dataset: string;
  revision: string;
  savedAt: number;
  state: EditorState;
  workspace?: DraftWorkspace;
  pendingUpload?: string;
}

const fail = () => { throw new Error('Bản nháp không hợp lệ hoặc khác phiên bản. Hãy xuất bản sao trước khi xóa.'); };
/** Validate local storage just like untrusted input; never partially restore a graph. */
export function validateDraft(value: unknown, dataset: string): DraftRecord {
  const draft = value as DraftRecord;
  if (!draft || draft.schema !== 1 || draft.dataset !== dataset || typeof draft.revision !== 'string' || !Number.isFinite(draft.savedAt)) return fail();
  const state = draft.state;
  if (!state || !state.baseFeatures || !state.overrides || !Array.isArray(state.undoStack) || !Array.isArray(state.redoStack) || !Array.isArray(state.viewportKeys) || !Array.isArray(state.selectedKeys) || !Array.isArray(state.lockedKeys) || !Array.isArray(state.lockedLayers) || !Number.isSafeInteger(state.nextChangeId) || state.nextChangeId < 1) return fail();
  const feature = (key: string, value: unknown) => {
    if (!/^(node|way|relation)\/-?\d+$/.test(key)) return fail();
    const parsed = parseFeature(value);
    if (`${parsed.properties.entityType}/${parsed.properties.entityId}` !== key) return fail();
    if (!Number.isSafeInteger(parsed.properties.version) || parsed.properties.version < 0) return fail();
    const coordinates = parsed.geometry.type === 'Point' ? [parsed.geometry.coordinates] : parsed.geometry.type === 'LineString' ? parsed.geometry.coordinates : parsed.geometry.coordinates.flat();
    if (coordinates.some(([lon, lat]) => Math.abs(lon) > 180 || Math.abs(lat) > 90)) return fail();
    if (parsed.properties.entityType === 'node' && parsed.geometry.type !== 'Point') return fail();
    if (parsed.properties.entityType === 'way' && (!parsed.properties.nodeIds || parsed.properties.nodeIds.some(id => !/^-?\d+$/.test(id)))) return fail();
  };
  for (const [key, item] of Object.entries(state.baseFeatures)) feature(key, item);
  for (const [key, item] of Object.entries(state.overrides)) {
    if (item) feature(key, item);
    else if (item !== null || !state.baseFeatures[key]) return fail();
  }
  for (const transaction of [...state.undoStack, ...state.redoStack]) {
    if (!Array.isArray(transaction.changes) || typeof transaction.label !== 'string' || !Number.isSafeInteger(transaction.id)) return fail();
    for (const change of transaction.changes) {
      if (!/^(node|way|relation)\/-?\d+$/.test(change.key) || (!change.before && !change.after && !state.baseFeatures[change.key])) return fail();
      if (change.before) feature(change.key, change.before);
      if (change.after) feature(change.key, change.after);
    }
  }
  if (state.selectedKeys.some(key => typeof key !== 'string') || (state.selectedKey !== null && !state.selectedKeys.includes(state.selectedKey))) return fail();
  if (state.viewportKeys.some(key => typeof key !== 'string') || state.lockedKeys.some(key => typeof key !== 'string') || state.lockedLayers.some(layer => !['points', 'lines', 'areas', 'relations'].includes(layer))) return fail();
  if (draft.pendingUpload !== undefined && (typeof draft.pendingUpload !== 'string' || !/^\d+$/.test(draft.pendingUpload))) return fail();
  const workspace = draft.workspace;
  if (workspace) {
    const coordinate = (value: unknown) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
    if (!['select', 'point', 'line', 'area'].includes(workspace.mode) || !Array.isArray(workspace.vertices) || !workspace.nextIds || !['node', 'way', 'relation'].every(type => Number.isSafeInteger(workspace.nextIds[type as keyof typeof workspace.nextIds]) && workspace.nextIds[type as keyof typeof workspace.nextIds] < 0)) return fail();
    for (const vertex of workspace.vertices) {
      if (!coordinate(vertex.coordinate) || (vertex.nodeId !== undefined && !/^-?\d+$/.test(vertex.nodeId))) return fail();
      if (vertex.segment && (typeof vertex.segment.wayId !== 'string' || !Number.isSafeInteger(vertex.segment.segmentIndex) || vertex.segment.segmentIndex < 0 || !coordinate(vertex.segment.coordinate))) return fail();
    }
    if (workspace.extension && (typeof workspace.extension.key !== 'string' || typeof workspace.extension.endpoint !== 'string')) return fail();
    if (workspace.camera && (!coordinate(workspace.camera.center) || !Number.isFinite(workspace.camera.zoom) || workspace.camera.zoom < 0 || workspace.camera.zoom > 24 || !Number.isFinite(workspace.camera.bearing) || !Number.isFinite(workspace.camera.pitch) || workspace.camera.pitch < 0 || workspace.camera.pitch > 85)) return fail();
  }
  return structuredClone(draft);
}

/** Retain editing dependencies, not an entire viewport cache, in each autosave. */
export function compactDraftState(state: EditorState, workspace?: DraftWorkspace): EditorState {
  const keep = new Set([...Object.keys(state.overrides), ...state.selectedKeys, ...state.lockedKeys, ...[...state.undoStack, ...state.redoStack].flatMap(entry => entry.changes.map(change => change.key))]);
  if (state.lockedLayers.length) Object.keys(state.baseFeatures).forEach(key => keep.add(key));
  for (const vertex of workspace?.vertices ?? []) {
    if (vertex.nodeId) keep.add(`node/${vertex.nodeId}`);
    if (vertex.segment) keep.add(`way/${vertex.segment.wayId}`);
  }
  if (workspace?.extension) keep.add(workspace.extension.key);
  for (const [key, feature] of Object.entries(state.baseFeatures)) {
    if (feature.properties.nodeIds?.some(id => keep.has(`node/${id}`))) keep.add(key);
  }
  const history = new Map<string, Array<EditorState['overrides'][string]>>();
  for (const entry of [...state.undoStack, ...state.redoStack]) for (const change of entry.changes) history.set(change.key, [...(history.get(change.key) ?? []), change.before ?? null, change.after ?? null]);
  const visit = (key: string) => {
    const features = [state.baseFeatures[key], state.overrides[key], ...(history.get(key) ?? [])];
    for (const feature of features) {
      if (!feature) continue;
      const refs = [...(feature.properties.nodeIds ?? []).map(id => `node/${id}`), ...(feature.properties.members ?? []).map(member => `${member.type}/${member.ref}`), ...(feature.properties.parents ?? []).map(parent => `relation/${parent.id}`)];
      for (const ref of refs) if (!keep.has(ref)) { keep.add(ref); visit(ref); }
    }
  };
  [...keep].forEach(visit);
  return structuredClone({ ...state, baseFeatures: Object.fromEntries(Object.entries(state.baseFeatures).filter(([key]) => keep.has(key))), viewportKeys: state.viewportKeys.filter(key => keep.has(key)), loading: false, error: null });
}

export function nextTemporaryIds(state: EditorState): { node: number; way: number; relation: number } {
  const next = { node: -1, way: -1, relation: -1 };
  const reserve = (type: keyof typeof next, id: string) => {
    const numeric = Number(id);
    if (Number.isSafeInteger(numeric) && numeric < 0) next[type] = Math.min(next[type], numeric - 1);
  };
  const features = [...Object.values(state.baseFeatures), ...Object.values(state.overrides), ...[...state.undoStack, ...state.redoStack].flatMap(entry => entry.changes.flatMap(change => [change.before, change.after]))];
  for (const feature of features) {
    if (!feature) continue;
    reserve(feature.properties.entityType, feature.properties.entityId);
    for (const id of feature.properties.nodeIds ?? []) reserve('node', id);
    for (const member of feature.properties.members ?? []) reserve(member.type, member.ref);
  }
  return next;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('geodata-editor-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Kho nháp đang bị chặn bởi tab khác. Đóng tab cũ rồi thử lại.')); };
  });
}

export async function readDraft(dataset: string): Promise<unknown> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get(dataset);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export class DraftConflictError extends Error {
  constructor() { super('Bản nháp đã thay đổi ở tab khác. Không ghi đè để tránh mất dữ liệu. Xuất bản sao rồi tải lại trang.'); }
}

/** Compare-and-swap inside ONE IndexedDB transaction, including deletions. */
export async function writeDraft<T extends { revision: string } = DraftRecord>(dataset: string, expected: string | null, draft: T | null): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      const store = tx.objectStore('drafts');
      let conflict = false;
      let failure: unknown;
      const read = store.get(dataset);
      read.onsuccess = () => {
        if ((read.result?.revision ?? null) !== expected) { conflict = true; tx.abort(); return; }
        try {
          if (draft) store.put(draft, dataset);
          else store.delete(dataset);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(conflict ? new DraftConflictError() : failure ?? tx.error ?? new Error('Không ghi được bản nháp.'));
      tx.onerror = () => { /* onabort reports request/quota errors */ };
    });
  } finally { db.close(); }
}
