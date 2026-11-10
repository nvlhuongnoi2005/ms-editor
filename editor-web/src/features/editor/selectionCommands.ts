import type { GraphFeature } from '../../types/osm';
import type { FeatureMutation } from './EditorStore';
import { captureGeometry } from './geometryClipboard';

const keyOf = (feature: GraphFeature) => `${feature.properties.entityType}/${feature.properties.entityId}`;

/** Selection is explicit: never expand a single member merely because it has a group. */
export function planDeleteSelection(keys: readonly string[], available: GraphFeature[]): FeatureMutation[] {
  const byKey = new Map(available.map(feature => [keyOf(feature), feature]));
  const removed = new Set<string>(), visiting = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) throw new Error('Nhóm có liên kết vòng. Không thể xóa an toàn.');
    if (removed.has(key)) return;
    const feature = byKey.get(key);
    if (!feature) throw new Error(`Chưa tải đủ ${key}. Không thể xóa một phần lựa chọn.`);
    removed.add(key);
    if (feature.properties.entityType === 'relation' && feature.properties.tags.type === 'collection') {
      visiting.add(key);
      for (const member of feature.properties.members ?? []) visit(`${member.type}/${member.ref}`);
      visiting.delete(key);
    }
  };
  keys.forEach(visit);
  // Selecting every member is equivalent to selecting the collection. Remove
  // its wrapper too, but never delete a partially selected group's other members.
  if (keys.length > 1) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const feature of available) if (feature.properties.entityType === 'relation' && feature.properties.tags.type === 'collection'
        && !removed.has(keyOf(feature)) && feature.properties.members?.length
        && feature.properties.members.every(member => removed.has(`${member.type}/${member.ref}`))) {
        removed.add(keyOf(feature)); changed = true;
      }
    }
  }
  for (const key of removed) {
    const feature = byKey.get(key)!;
    if (feature.properties.parents?.some(parent => {
      if (removed.has(`relation/${parent.id}`)) return false;
      const relation = byKey.get(`relation/${parent.id}`);
      return !relation || !relation.properties.members || relation.properties.members.some(member => `${member.type}/${member.ref}` === key);
    })) throw new Error('Đối tượng còn thuộc quan hệ ngoài tập xóa. Hãy bỏ liên kết hoặc chọn đủ nhóm.');
  }
  for (const feature of available) if (!removed.has(keyOf(feature)) && (feature.properties.nodeIds?.some(id => removed.has(`node/${id}`))
    || feature.properties.members?.some(member => removed.has(`${member.type}/${member.ref}`)))) throw new Error('Đối tượng còn được đường/quan hệ khác sử dụng. Không tự xóa dây chuyền.');
  return [...removed].map(key => ({ key, feature: null }));
}

/** Loaded membership must be complete before presenting a whole-group selection. */
export function groupSelectionFeatures(feature: GraphFeature, available: GraphFeature[]): GraphFeature[] {
  const roots = new Map<string, GraphFeature>();
  let frontier = [keyOf(feature)];
  const seen = new Set(frontier);
  while (frontier.length) {
    const next: string[] = [];
    for (const group of available) if (group.properties.entityType === 'relation' && group.properties.tags.type === 'collection'
      && group.properties.members?.some(member => frontier.includes(`${member.type}/${member.ref}`))) {
      roots.set(keyOf(group), group);
      if (!seen.has(keyOf(group))) { seen.add(keyOf(group)); next.push(keyOf(group)); }
    }
    frontier = next;
  }
  if (feature.properties.entityType === 'relation' && feature.properties.tags.type === 'collection') roots.set(keyOf(feature), feature);
  if (!roots.size) return [];
  return captureGeometry([...roots.keys()], available, false).sources;
}
