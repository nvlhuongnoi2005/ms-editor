import type { EditorChange } from '../features/editor/EditorStore';
import type { GraphFeature, RelationMember, Tags } from '../types/osm';

export interface ChangesetInfo {
  id: string;
  status: 'open' | 'committed' | 'closed';
  committedRevision?: number;
}

interface UploadEntityBase {
  type: 'node' | 'way' | 'relation';
  id: string;
  version: number;
  tags: Tags;
}

interface NodeUploadEntity extends UploadEntityBase {
  type: 'node';
  lon: number;
  lat: number;
}

interface WayUploadEntity extends UploadEntityBase {
  type: 'way';
  nodeRefs: string[];
}

interface RelationUploadEntity extends UploadEntityBase {
  type: 'relation';
  members: Array<{ type: RelationMember['type']; ref: string; role: string; sequence: number }>;
}

type UploadEntity = NodeUploadEntity | WayUploadEntity | RelationUploadEntity;

interface UploadChange {
  operation: 'create' | 'modify' | 'delete';
  entity: UploadEntity;
}

type JsonRecord = Record<string, unknown>;

export class ChangesetApiError extends Error {
  constructor(readonly phase: 'create' | 'upload' | 'close' | 'rollback', message: string, readonly status = 0, readonly code: string | null = null) {
    super(message);
    this.name = 'ChangesetApiError';
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseChangesetInfo(value: unknown): ChangesetInfo {
  if (!isRecord(value) || typeof value.id !== 'string') throw new Error('Phản hồi changeset không hợp lệ.');
  if (value.status !== 'open' && value.status !== 'committed' && value.status !== 'closed') throw new Error('Trạng thái changeset không hợp lệ.');
  if (value.committedRevision !== undefined && typeof value.committedRevision !== 'number') throw new Error('Revision changeset không hợp lệ.');
  return {
    id: value.id,
    status: value.status,
    ...(value.committedRevision === undefined ? {} : { committedRevision: value.committedRevision })
  };
}

function parseChangesetResponse(value: unknown): ChangesetInfo {
  if (!isRecord(value)) throw new Error('Phản hồi changeset không hợp lệ.');
  return parseChangesetInfo(value.changeset);
}

function apiErrorMessage(value: unknown, status: number): string {
  return isRecord(value) && typeof value.error === 'string'
    ? value.error
    : `Yêu cầu changeset thất bại (${status}).`;
}

async function request(phase: ChangesetApiError['phase'], path: string, method: 'POST' | 'PUT', body?: unknown): Promise<ChangesetInfo> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ChangesetApiError(phase, apiErrorMessage(payload, response.status), response.status, isRecord(payload) && typeof payload.code === 'string' ? payload.code : null);
  return parseChangesetResponse(payload);
}

function entityPayload(feature: GraphFeature): UploadEntity {
  const base: UploadEntityBase = {
    type: feature.properties.entityType,
    id: feature.properties.entityId,
    version: feature.properties.version,
    tags: feature.properties.tags
  };
  if (feature.properties.entityType === 'node') {
    if (feature.geometry.type !== 'Point') throw new Error(`Node ${feature.properties.entityId} không có Point geometry.`);
    return { ...base, type: 'node', lon: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] };
  }
  if (feature.properties.entityType === 'way') {
    if (!feature.properties.nodeIds?.length) throw new Error(`Way ${feature.properties.entityId} không có node references.`);
    return { ...base, type: 'way', nodeRefs: feature.properties.nodeIds };
  }
  if (!feature.properties.members) throw new Error(`Relation ${feature.properties.entityId} không có members.`);
  return { ...base, type: 'relation', members: feature.properties.members.map(member => ({
    type: member.type,
    ref: member.ref,
    role: member.role,
    sequence: member.sequence
  })) };
}

export function toUploadChanges(changes: EditorChange[]): UploadChange[] {
  return changes.map(change => {
    const entity = change.after ?? change.before;
    if (!entity) throw new Error(`Thay đổi ${change.key} không có đối tượng.`);
    return {
      operation: change.after === null ? 'delete' : change.before ? 'modify' : 'create',
      entity: entityPayload(entity)
    };
  });
}

export function createChangeset(dataset: string, comment: string): Promise<ChangesetInfo> {
  return request('create', '/api/0.6/changeset/create', 'PUT', { dataset, comment });
}

export function uploadChangeset(id: string, changes: UploadChange[]): Promise<ChangesetInfo> {
  return request('upload', `/api/0.6/changeset/${encodeURIComponent(id)}/upload`, 'POST', { changes });
}

export function closeChangeset(id: string): Promise<ChangesetInfo> {
  return request('close', `/api/0.6/changeset/${encodeURIComponent(id)}/close`, 'PUT');
}

// The server accepts only one of the latest three committed changesets and
// creates a new, auditable changeset instead of rewriting history.
export function rollbackChangeset(id: string, comment = ''): Promise<ChangesetInfo> {
  return request('rollback', `/api/0.6/changeset/${encodeURIComponent(id)}/rollback`, 'POST', { comment });
}

export interface RecentChangeset {
  id: string;
  revision: number;
  comment: string;
  author: string;
  createdAt: string;
  creates: number;
  modifies: number;
  deletes: number;
  canRevert: boolean;
  reason?: string;
}

export async function loadRecentChangesets(dataset: string, signal?: AbortSignal): Promise<RecentChangeset[]> {
  const response = await fetch(`/api/changesets/recent?${new URLSearchParams({ dataset })}`, { cache: 'no-store', signal });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(payload, response.status));
  if (!isRecord(payload) || !Array.isArray(payload.changesets)) throw new Error('Danh sách changeset không hợp lệ.');
  return payload.changesets.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.canRevert !== 'boolean'
      || typeof item.createdAt !== 'string' || typeof item.comment !== 'string' || typeof item.author !== 'string'
      || ![item.revision, item.creates, item.modifies, item.deletes].every(value => typeof value === 'number')) throw new Error('Thông tin changeset không hợp lệ.');
    return item as unknown as RecentChangeset;
  });
}
