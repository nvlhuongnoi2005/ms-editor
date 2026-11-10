import type { Coordinate, GraphFeature } from '../../types/osm';
import type { FeatureMutation } from './EditorStore';
import { duplicateFeatures } from './duplicateFeatures';

const keyOf = (feature: GraphFeature) => `${feature.properties.entityType}/${feature.properties.entityId}`;

export interface GeometryClipboard {
  sources: GraphFeature[];
  support: GraphFeature[];
  groups: GraphFeature[];
}

/** Capture an isolated snapshot; subsequent edits never change the clipboard. */
export function captureGeometry(keys: readonly string[], available: GraphFeature[], preserveContainedGroups = true): GeometryClipboard {
  const byKey = new Map(available.map(feature => [keyOf(feature), feature]));
  const sources = new Map<string, GraphFeature>();
  const groups = new Map<string, GraphFeature>();
  const visiting = new Set<string>();
  const visit = (key: string) => {
    const feature = byKey.get(key);
    if (!feature) throw new Error('Có đối tượng chưa được tải đầy đủ. Hãy tải lại khu vực trước khi sao chép.');
    if (feature.properties.entityType !== 'relation') { sources.set(key, feature); return; }
    if (feature.properties.tags.type !== 'collection') throw new Error('Hiện chỉ hỗ trợ sao chép điểm, đường, vùng và nhóm collection.');
    if (visiting.has(key)) throw new Error('Nhóm có liên kết vòng, không thể sao chép.');
    if (groups.has(key)) return;
    visiting.add(key);
    for (const member of feature.properties.members ?? []) visit(`${member.type}/${member.ref}`);
    visiting.delete(key);
    groups.set(key, feature);
  };
  for (const key of keys) visit(key);
  if (!sources.size) throw new Error('Chọn ít nhất một đối tượng để sao chép.');
  // Preserve collections completely contained in a multi-selection.
  let added = preserveContainedGroups && keys.length > 1;
  while (added) {
    added = false;
    for (const feature of available) {
      const members = feature.properties.members ?? [];
      if (feature.properties.entityType === 'relation' && feature.properties.tags.type === 'collection' && !groups.has(keyOf(feature))
        && members.length && members.every(member => sources.has(`${member.type}/${member.ref}`) || groups.has(`${member.type}/${member.ref}`))) {
        visit(keyOf(feature)); added = true;
      }
    }
  }
  const nodeIds = new Set([...sources.values()].flatMap(feature => feature.properties.nodeIds ?? []));
  const support = available.filter(feature => sources.has(keyOf(feature))
    || (feature.properties.entityType === 'node' && nodeIds.has(feature.properties.entityId)));
  return structuredClone({ sources: [...sources.values()], support, groups: [...groups.values()] });
}

/** Refuse cuts that would leave known references dangling. The API validates the full dataset on Save. */
export function cutGeometry(clipboard: GeometryClipboard, available: GraphFeature[]): FeatureMutation[] {
  const removed = new Set([...clipboard.sources, ...clipboard.groups].map(keyOf));
  const byKey = new Map(available.map(feature => [keyOf(feature), feature]));
  for (const feature of [...clipboard.sources, ...clipboard.groups]) {
    if (feature.properties.parents?.some(parent => {
      if (removed.has(`relation/${parent.id}`)) return false;
      const relation = byKey.get(`relation/${parent.id}`);
      return !relation || !relation.properties.members || relation.properties.members.some(member => `${member.type}/${member.ref}` === keyOf(feature));
    })) {
      throw new Error('Đối tượng còn thuộc quan hệ bên ngoài vùng chọn. Hãy bỏ liên kết hoặc chọn cả nhóm trước khi cắt.');
    }
  }
  for (const feature of available) {
    if (removed.has(keyOf(feature))) continue;
    if (feature.properties.entityType === 'way' && feature.properties.nodeIds?.some(id => removed.has(`node/${id}`))) {
      throw new Error('Node đang được đường khác sử dụng. Hãy tách node khỏi đường trước khi cắt.');
    }
    if (feature.properties.members?.some(member => removed.has(`${member.type}/${member.ref}`))) {
      throw new Error('Đối tượng còn được quan hệ khác sử dụng. Hãy bỏ liên kết trước khi cắt.');
    }
  }
  return [...removed].map(key => ({ key, feature: null }));
}

export function pasteGeometry(clipboard: GeometryClipboard, allocateNode: () => string, allocateWay: () => string,
  allocateRelation: () => string, offset: Coordinate) {
  const result = duplicateFeatures(clipboard.sources, clipboard.support, allocateNode, allocateWay, offset);
  const pending = new Map(clipboard.groups.map(group => [keyOf(group), group]));
  while (pending.size) {
    const group = [...pending.values()].find(group => (group.properties.members ?? []).every(member => result.copies.has(`${member.type}/${member.ref}`)));
    if (!group) throw new Error('Nhóm thiếu thành viên hoặc có liên kết vòng.');
    pending.delete(keyOf(group));
    const id = allocateRelation();
    const anchor = result.features[0].geometry;
    const coordinate = anchor.type === 'Point' ? anchor.coordinates : anchor.type === 'Polygon' ? anchor.coordinates[0][0] : anchor.coordinates[0];
    const feature: GraphFeature = {
      type: 'Feature', id: `relation-${id}`,
      properties: { entityType: 'relation', entityId: id, version: 0, tags: { ...group.properties.tags },
        members: (group.properties.members ?? []).map((member, sequence) => {
          const copy = result.copies.get(`${member.type}/${member.ref}`);
          if (!copy) throw new Error('Không thể khôi phục đầy đủ thành viên nhóm.');
          return { ...member, ref: copy.properties.entityId, sequence };
        }) },
      geometry: { type: 'Point', coordinates: [...coordinate] }
    };
    result.copies.set(keyOf(group), feature);
    result.mutations.push({ key: keyOf(feature), feature });
  }
  return result;
}
