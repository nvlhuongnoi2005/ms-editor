export type EncGeometry = { type: string; coordinates: unknown };
export type EncEditFeature = {
  key: string; objectClass: string; sourceId: string; geometry: EncGeometry;
  attributes: Record<string, unknown>; deleted: boolean; canMove: boolean; canDelete: boolean;
};
export type EncCredentials = { id: string; token: string; baseRevision: string };
export type EncWorkspace = {
  id: string; baseRevision: string; version: number; cellName: string; sourceChanged: boolean;
  features: EncEditFeature[]; attributes: Array<{ key: string; label: string; kind: 'text' | 'number' }>;
  pointClasses: string[];
  bounds?: [number, number, number, number] | null;
};
export type EncCommit = { requestId: string; expectedVersion: number; changes: Array<{ key: string; after: EncEditFeature | null }> };
type Documents = Record<string, EncEditFeature>;
type Transaction = { key: string; before?: EncEditFeature; after?: EncEditFeature };
export type EncEditState = {
  schema: 1; revision: string; workspace: EncCredentials; version: number;
  saved: Documents; documents: Documents; undo: Transaction[]; redo: Transaction[]; pending?: EncCommit;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const draftKey = (revision: string) => `enc:${revision}`;

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]));
  return value;
}
export function sameDocument(a: EncEditFeature | undefined, b: EncEditFeature | undefined): boolean {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}
export function initialEditing(workspace: EncCredentials, server: EncWorkspace): EncEditState {
  const documents = Object.fromEntries(server.features.map(feature => [feature.key, structuredClone(feature)]));
  return { schema: 1, revision: crypto.randomUUID(), workspace, version: server.version, saved: structuredClone(documents), documents, undo: [], redo: [] };
}
function replace(documents: Documents, key: string, value?: EncEditFeature): Documents {
  const result = { ...documents };
  if (value) result[key] = structuredClone(value); else delete result[key];
  return result;
}
export function changeFeature(state: EncEditState, key: string, after?: EncEditFeature): EncEditState {
  if (state.pending) throw new Error('Cần xác nhận lần lưu trước khi tiếp tục sửa. Bấm Lưu để kiểm tra lại.');
  const before = state.documents[key];
  if (sameDocument(before, after)) return state;
  let undo = [...state.undo, { key, before: before && structuredClone(before), after: after && structuredClone(after) }].slice(-150);
  while (undo.length > 1 && JSON.stringify(undo).length > 4 * 1024 * 1024) undo = undo.slice(1);
  return { ...state, documents: replace(state.documents, key, after), undo, redo: [] };
}
export function travelHistory(state: EncEditState, direction: 'undo' | 'redo'): EncEditState {
  if (state.pending) return state;
  const from = state[direction], entry = from.at(-1);
  if (!entry) return state;
  return { ...state, documents: replace(state.documents, entry.key, direction === 'undo' ? entry.before : entry.after),
    undo: direction === 'undo' ? from.slice(0, -1) : [...state.undo, entry], redo: direction === 'redo' ? from.slice(0, -1) : [...state.redo, entry] };
}
export function commitChanges(state: EncEditState): EncCommit['changes'] {
  return [...new Set([...Object.keys(state.saved), ...Object.keys(state.documents)])].sort()
    .filter(key => !sameDocument(state.saved[key], state.documents[key]))
    .map(key => ({ key, after: state.documents[key] ?? null }));
}
export function acknowledgeCommit(state: EncEditState, version: number): EncEditState {
  if (!state.pending || version !== state.pending.expectedVersion + 1) throw new Error('Phản hồi lưu không khớp bản nháp. Giữ nguyên dữ liệu để kiểm tra lại.');
  return { ...state, version, saved: structuredClone(state.documents), pending: undefined };
}
export function validateEditingDraft(value: unknown, baseRevision: string): EncEditState {
  const state = value as EncEditState;
  const fail = () => { throw new Error('Bản nháp ENC không hợp lệ. Giữ bản nháp và xuất bản sao để đối soát.'); };
  if (!state || state.schema !== 1 || !uuid.test(state.revision) || !state.workspace || state.workspace.baseRevision !== baseRevision
    || !uuid.test(state.workspace.id) || !/^[a-f0-9]{64}$/i.test(state.workspace.token) || !Number.isSafeInteger(state.version) || state.version < 0
    || !state.documents || !state.saved || !Array.isArray(state.undo) || !Array.isArray(state.redo) || state.undo.length > 150 || state.redo.length > 150) return fail();
  const document = (key: string, feature: EncEditFeature | undefined) => {
    if (typeof key !== 'string' || key.length > 500) return fail();
    if (feature === undefined) return;
    if (!feature || feature.key !== key || key !== `${feature.objectClass}/${feature.sourceId}` || !feature.attributes || typeof feature.attributes !== 'object'
      || Array.isArray(feature.attributes) || !feature.geometry || typeof feature.geometry.type !== 'string' || feature.geometry.coordinates == null
      || typeof feature.deleted !== 'boolean' || typeof feature.canMove !== 'boolean' || typeof feature.canDelete !== 'boolean') return fail();
    if (feature.geometry.type === 'Point') {
      const c = feature.geometry.coordinates;
      if (!Array.isArray(c) || c.length < 2 || c.some(n => typeof n !== 'number' || !Number.isFinite(n)) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) return fail();
    }
  };
  for (const documents of [state.documents, state.saved]) {
    if (Array.isArray(documents) || typeof documents !== 'object' || Object.keys(documents).length > 1000) return fail();
    for (const [key, feature] of Object.entries(documents)) document(key, feature);
  }
  for (const tx of [...state.undo, ...state.redo]) { if (!tx) return fail(); document(tx.key, tx.before); document(tx.key, tx.after); }
  if (state.pending) {
    if (!uuid.test(state.pending.requestId) || state.pending.expectedVersion !== state.version || !Array.isArray(state.pending.changes)
      || JSON.stringify(state.pending.changes) !== JSON.stringify(commitChanges(state))) return fail();
  }
  return structuredClone(state);
}

export class EncEditingError extends Error {
  constructor(message: string, readonly code = '', readonly status = 0) { super(message); }
}
async function request<T>(credentials: EncCredentials, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/enc/workspaces${path}`, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    headers: { 'Content-Type': 'application/json', 'X-Editor-Import': '1', 'X-ENC-Workspace-Token': credentials.token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new EncEditingError(result?.error || 'Không kết nối được dịch vụ biên tập ENC.', result?.code, response.status);
  return result as T;
}
export const createEncWorkspace = (credentials: EncCredentials) => request(credentials, '', { ...credentials });
export const loadEncWorkspace = (credentials: EncCredentials) => request<EncWorkspace>(credentials, `/${credentials.id}`);
export const loadEncFeature = (credentials: EncCredentials, key: string) => request<EncEditFeature>(credentials, `/${credentials.id}/feature?${new URLSearchParams({ key })}`);
export const saveEncWorkspace = (credentials: EncCredentials, commit: EncCommit) => request<{ version: number; requestId: string }>(credentials, `/${credentials.id}/commits`, commit);
