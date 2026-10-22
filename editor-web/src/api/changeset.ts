import type { EditorChange } from '../features/editor/EditorStore';
import type { GraphFeature, Tags } from '../types/osm';

export interface ChangesetInfo {
  id: string;
  status: 'open' | 'committed' | 'closed';
  committedRevision?: number;
}

interface UploadEntityBase {
  type: 'node' | 'way';
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

type UploadEntity = NodeUploadEntity | WayUploadEntity;

interface UploadChange {
  operation: 'create' | 'modify' | 'delete';
  entity: UploadEntity;
}

type JsonRecord = Record<string, unknown>;

export class ChangesetApiError extends Error {
  constructor(readonly phase: 'create' | 'upload' | 'close', message: string) {
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
  if (!response.ok) throw new ChangesetApiError(phase, apiErrorMessage(payload, response.status));
  return parseChangesetResponse(payload);
}

function entityPayload(feature: GraphFeature): UploadEntity {
  const base: UploadEntityBase = {
    type: feature.properties.entityType === 'node' ? 'node' : 'way',
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
  throw new Error(`Relation ${feature.properties.entityId} chưa được hỗ trợ khi lưu.`);
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
