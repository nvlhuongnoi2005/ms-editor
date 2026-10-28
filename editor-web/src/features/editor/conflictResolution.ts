import type { GraphFeature, Tags, WayNode } from '../../types/osm';
import type { EditorChange } from './EditorStore';
import type { SnapshotBatch } from '../../api/conflicts';

export type ConflictChoice = 'local' | 'server';
export interface ConflictField {
  id: string;
  entityKey: string;
  label: string;
  base: unknown;
  local: unknown;
  server: unknown;
  conflict: boolean;
  choice?: ConflictChoice;
  localAllowed: boolean;
}
export interface RebasedEntity { key: string; base: GraphFeature | null; local: GraphFeature | null }
export interface ResolutionPlan { fields: ConflictField[]; entities: RebasedEntity[]; blockers: string[]; baselines: GraphFeature[]; removedKeys: string[] }
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalValue(item)]));
  return value;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonicalValue(a)) === JSON.stringify(canonicalValue(b));

function entityShape(feature: GraphFeature): unknown {
  if (feature.properties.entityType === 'relation') return feature.properties.members ?? [];
  // A way stores ordered node references. Coordinates belong to the node
  // entities and are resolved there, avoiding contradictory way/node choices.
  if (feature.properties.entityType === 'way') return feature.properties.nodeIds ?? [];
  return feature.geometry;
}

export function sameEntityContent(a: GraphFeature | null, b: GraphFeature | null): boolean {
  if (!a || !b) return a === b;
  const sortTags = (tags: Tags) => Object.entries(tags).sort(([a], [b]) => a.localeCompare(b));
  return same(sortTags(a.properties.tags), sortTags(b.properties.tags)) && same(entityShape(a), entityShape(b));
}

/** A three-way merge applies only the local delta; server-only edits survive. */
export function planConflictResolution(changes: EditorChange[], batch: SnapshotBatch, choices: Record<string, ConflictChoice> = {}): ResolutionPlan {
  const snapshots = new Map(batch.snapshots.map(item => [item.key, item]));
  const fields: ConflictField[] = [], blockers: string[] = [], entities: RebasedEntity[] = [];
  const merge = (key: string, field: string, label: string, base: unknown, local: unknown, server: unknown): unknown => {
    const conflict = !same(local, base) && !same(server, base) && !same(local, server);
    const id = `${key}::${field}`;
    const choice = conflict ? choices[id] : same(local, base) ? 'server' : 'local';
    if (!same(base, local) || !same(base, server)) fields.push({ id, entityKey: key, label, base, local, server, conflict, choice, localAllowed: true });
    if (conflict && !choice) blockers.push(`Chưa chọn cách xử lý ${key} · ${label}.`);
    return choice === 'local' ? local : server;
  };
  for (const change of changes) {
    if (!change.before) {
      entities.push({ key: change.key, base: null, local: change.after ? structuredClone(change.after) : null });
      continue;
    }
    const snapshot = snapshots.get(change.key);
    if (!snapshot) { blockers.push(`Thiếu snapshot ${change.key}.`); continue; }
    const server = snapshot.feature, local = change.after ?? null, base = change.before;
    if (!server) {
      if (local) {
        const id = `${change.key}::deleted`;
        fields.push({ id, entityKey: change.key, label: 'Đã bị xóa trên server', base: 'Tồn tại', local: 'Giữ bản đang sửa', server: 'Đã xóa', conflict: true, choice: choices[id], localAllowed: false });
        if (choices[id] !== 'server') blockers.push(`${change.key} đã bị xóa. Chọn bản server hoặc đóng panel để giữ draft.`);
      }
      entities.push({ key: change.key, base: null, local: null });
      continue;
    }
    if (!local) {
      const changedOnServer = !sameEntityContent(base, server);
      const id = `${change.key}::delete`;
      fields.push({ id, entityKey: change.key, label: 'Xóa đối tượng', base: 'Tồn tại', local: 'Xóa', server: changedOnServer ? 'Đã được sửa tiếp' : 'Tồn tại', conflict: changedOnServer, choice: changedOnServer ? choices[id] : 'local', localAllowed: true });
      if (changedOnServer && !choices[id]) blockers.push(`Cần xác nhận xóa ${change.key} vì server đã sửa đối tượng.`);
      entities.push({ key: change.key, base: server, local: changedOnServer && choices[id] === 'server' ? server : null });
      continue;
    }
    const merged = structuredClone(server);
    const tags: Tags = {};
    const keys = new Set([...Object.keys(base.properties.tags), ...Object.keys(local.properties.tags), ...Object.keys(server.properties.tags)]);
    for (const key of [...keys].sort()) {
      const value = merge(change.key, `tag:${key}`, key, base.properties.tags[key], local.properties.tags[key], server.properties.tags[key]);
      if (value !== undefined) tags[key] = value as string;
    }
    merged.properties.tags = tags;
    merged.properties.name = tags.name ?? '';
    const shape = merge(change.key, 'shape', local.properties.entityType === 'relation' ? 'Thành viên / thứ tự / role' : local.properties.entityType === 'way' ? 'Node references / thứ tự đỉnh' : 'Vị trí tọa độ', entityShape(base), entityShape(local), entityShape(server));
    const source = same(shape, entityShape(server)) ? server : local;
    if (local.properties.entityType === 'relation') merged.properties.members = structuredClone(source.properties.members ?? []);
    else {
      merged.geometry = structuredClone(source.geometry);
      if (merged.geometry.type === 'Point') merged.properties.coordinates = [...merged.geometry.coordinates];
      if (local.properties.entityType === 'way') {
        merged.properties.nodeIds = [...(source.properties.nodeIds ?? [])];
        merged.properties.nodes = structuredClone(source.properties.nodes ?? []);
      }
    }
    entities.push({ key: change.key, base: server, local: merged });
  }
  // Rebuild affected way previews using resolved node positions. Ways upload
  // references, not coordinate arrays; the preview must match that same model.
  const nodeMap = new Map<string, WayNode>();
  const addNode = (feature: GraphFeature | null) => {
    if (feature?.properties.entityType === 'node' && feature.geometry.type === 'Point') nodeMap.set(feature.properties.entityId, { id: feature.properties.entityId, coordinates: feature.geometry.coordinates, version: feature.properties.version, tags: feature.properties.tags });
  };
  batch.support.forEach(addNode);
  batch.snapshots.forEach(item => addNode(item.feature));
  entities.forEach(item => addNode(item.local));
  const removed = new Set(entities.filter(item => !item.local).map(item => item.key));
  for (const item of entities) {
    const feature = item.local;
    if (!feature) continue;
    if (feature.properties.entityType === 'way') {
      const previousNodes = new Map(feature.properties.nodes?.map(node => [node.id, node]));
      const nodes = (feature.properties.nodeIds ?? []).map(id => nodeMap.get(id) ?? previousNodes.get(id));
      const invalid = (feature.properties.nodeIds ?? []).some(id => removed.has(`node/${id}`));
      if (invalid || nodes.some(node => !node)) blockers.push(`${item.key} còn tham chiếu node bị bỏ/xóa. Hãy xử lý cả nhóm topology.`);
      else {
        feature.properties.nodes = nodes as WayNode[];
        const coordinates = (nodes as WayNode[]).map(node => node.coordinates);
        feature.geometry = feature.geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: [coordinates] } : { type: 'LineString', coordinates };
      }
    }
    if (feature.properties.members?.some(member => removed.has(`${member.type}/${member.ref}`))) blockers.push(`${item.key} còn tham chiếu thành viên bị bỏ/xóa. Hãy xử lý cả nhóm topology.`);
  }
  const referenced = new Set(entities.flatMap(item => [
    ...(item.local?.properties.nodeIds ?? []).map(id => `node/${id}`),
    ...(item.local?.properties.members ?? []).map(member => `${member.type}/${member.ref}`)
  ]));
  for (const item of entities) {
    if (!item.base && item.local?.properties.entityType === 'node' && item.local.properties.topologyNode
      && !Object.keys(item.local.properties.tags).length && !referenced.has(item.key)) item.local = null;
  }
  return {
    fields, entities, blockers,
    baselines: [...batch.support, ...batch.snapshots.flatMap(item => item.feature ? [item.feature] : [])],
    removedKeys: batch.snapshots.filter(item => !item.visible).map(item => item.key)
  };
}

export function snapshotKeys(changes: EditorChange[]): string[] {
  return changes.filter(change => change.before).map(change => change.key);
}
