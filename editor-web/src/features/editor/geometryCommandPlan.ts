import { executeTransaction, samePersistedContent, type EditorState, type FeatureMutation } from './EditorStore';
import { geometryLayer, protectedGeometry } from './geometryLocks';
import { booleanGeometry, expandGeometrySelection, transformGeometry, type GeometryOptions } from './geometryOperations';
import type { GraphFeature } from '../../types/osm';

const keyOf = (feature: GraphFeature) => `${feature.properties.entityType}/${feature.properties.entityId}`;
export interface CommandImpact {
  selected: number; expanded: number; groups: number; changedEntities: number; changedNodes: number;
  externalWays: string[]; externalRelations: string[]; created: number; deleted: number;
}
export interface GeometryCommandPlan {
  status: 'ready' | 'noop' | 'blocked'; reason: string | null;
  mutations: FeatureMutation[]; impact: CommandImpact; selected?: GraphFeature;
  before: GraphFeature[]; after: GraphFeature[]; beforeSupport: GraphFeature[]; support: GraphFeature[]; fingerprint: string;
}

/** The transaction preflight is the same one used by the store at commit. */
export function inspectMutations(state: EditorState, available: GraphFeature[], keys: readonly string[], mutations: FeatureMutation[]): GeometryCommandPlan {
  const command = executeTransaction(state, mutations, 'Kiểm tra thao tác');
  const byKey = new Map(available.map(feature => [keyOf(feature), feature]));
  const sources = keys.flatMap(key => byKey.get(key) ? [byKey.get(key)!] : []);
  let expanded = sources;
  try { expanded = expandGeometrySelection(sources, available); } catch { /* Specific errors are reported by the geometry planner. */ }
  const selected = new Set([...keys, ...expanded.map(keyOf)]);
  const groups = new Set<string>();
  let foundGroup = true;
  while (foundGroup) {
    foundGroup = false;
    for (const feature of available) if (feature.properties.tags.type === 'collection' && !groups.has(keyOf(feature)) &&
      (selected.has(keyOf(feature)) || feature.properties.members?.length && feature.properties.members.every(member => selected.has(`${member.type}/${member.ref}`)))) {
      groups.add(keyOf(feature)); selected.add(keyOf(feature)); foundGroup = true;
    }
  }
  const effective = command.result.status === 'applied' ? new Set(command.result.changedKeys) : new Set<string>();
  const changedNodes = new Set([...effective].filter(key => key.startsWith('node/')));
  const projected = new Map(byKey);
  for (const item of mutations) { if (item.feature) projected.set(item.key, item.feature); else projected.delete(item.key); }
  const ways = available.filter(feature => feature.properties.entityType === 'way' && (effective.has(keyOf(feature)) || feature.properties.nodeIds?.some(id => changedNodes.has(`node/${id}`))));
  const affected = new Set([...effective, ...ways.map(keyOf)]);
  const relations = new Set<string>();
  // A changed member can affect a multipolygon or a nested relation transitively.
  let grew = true;
  while (grew) {
    grew = false;
    for (const feature of available) if (feature.properties.entityType === 'relation' && !relations.has(keyOf(feature)) && feature.properties.members?.some(member => affected.has(`${member.type}/${member.ref}`))) {
      relations.add(keyOf(feature)); affected.add(keyOf(feature)); grew = true;
    }
  }
  const visual = new Set([...selected, ...affected]);
  const impact: CommandImpact = {
    selected: keys.length, expanded: expanded.length, groups: groups.size,
    changedEntities: effective.size, changedNodes: changedNodes.size,
    externalWays: ways.map(keyOf).filter(key => !selected.has(key)),
    externalRelations: [...relations].filter(key => !selected.has(key)),
    created: mutations.filter(item => effective.has(item.key) && item.feature && !byKey.has(item.key)).length,
    deleted: mutations.filter(item => effective.has(item.key) && item.feature === null).length
  };
  const status = command.result.status === 'applied' ? 'ready' : command.result.status;
  let reason = command.result.status === 'blocked' ? command.result.message : status === 'noop' ? 'Không có thay đổi thực tế ở độ chính xác lưu E7; không tạo bước Undo.' : null;
  if (status === 'blocked') {
    const protectedKeys = protectedGeometry(available, state.lockedKeys, state.lockedLayers);
    const blockedKeys = mutations.filter(item => !samePersistedContent(byKey.get(item.key) ?? null, item.feature) && (protectedKeys.has(item.key) || item.feature && state.lockedLayers.includes(geometryLayer(item.feature)))).map(item => item.key);
    if (blockedKeys.length) reason += ` Đang khóa: ${blockedKeys.slice(0, 8).join(', ')}${blockedKeys.length > 8 ? ` và ${blockedKeys.length - 8} entity khác` : ''}.`;
  }
  return { status, reason,
    mutations, impact, before: available.filter(feature => visual.has(keyOf(feature))), after: [...projected].filter(([key]) => visual.has(key)).map(([, feature]) => feature), beforeSupport: available, support: [...projected.values()],
    fingerprint: JSON.stringify([keys, mutations, impact, available.filter(feature => visual.has(keyOf(feature))), state.lockedKeys, state.lockedLayers]) };
}

export function planGeometryCommand(state: EditorState, available: GraphFeature[], keys: readonly string[], options: GeometryOptions,
  ids: { node: number; way: number; relation: number }): GeometryCommandPlan {
  try {
    if (!keys.length) throw new Error('Chọn ít nhất 1 đối tượng trước khi mở công cụ.');
    const byKey = new Map(available.map(feature => [keyOf(feature), feature]));
    const sources = keys.map(key => { const feature = byKey.get(key); if (!feature) throw new Error(`Chưa tải đủ ${key}. Hãy chọn lại đối tượng.`); return feature; });
    const area = ['hole', 'union', 'intersection', 'difference'].includes(options.operation);
    // Preview allocators are local. They never consume the live editor's IDs.
    const next = { ...ids };
    const result = area ? booleanGeometry(sources, available, options, () => String(next.node--), () => String(next.way--), () => String(next.relation--)) : null;
    const plan = inspectMutations(state, available, keys, result?.mutations ?? transformGeometry(sources, available, options));
    return { ...plan, selected: result?.selected };
  } catch (error) {
    return { status: 'blocked', reason: error instanceof Error ? error.message : 'Không tính được kết quả geometry.', mutations: [], before: [], after: [], beforeSupport: [], support: [], fingerprint: '',
      impact: { selected: keys.length, expanded: 0, groups: 0, changedEntities: 0, changedNodes: 0, externalWays: [], externalRelations: [], created: 0, deleted: 0 } };
  }
}

export function reservePlannedIds(mutations: FeatureMutation[], ids: { node: number; way: number; relation: number }) {
  const next = { ...ids };
  for (const item of mutations) if (item.feature) {
    const { entityType, entityId } = item.feature.properties;
    const id = Number(entityId);
    if (Number.isSafeInteger(id) && id < 0) next[entityType] = Math.min(next[entityType], id - 1);
  }
  return next;
}
