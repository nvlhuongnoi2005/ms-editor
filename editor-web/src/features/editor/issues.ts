import type { Coordinate, GraphFeature } from '../../types/osm';

export type IssueSeverity = 'error' | 'warning';

export interface EditorIssue {
  id: string;
  severity: IssueSeverity;
  entityKey: string;
  coordinate: Coordinate;
  title: string;
  detail: string;
}

function keyOf(feature: GraphFeature) {
  return `${feature.properties.entityType}/${feature.properties.entityId}`;
}

function coordinateOf(feature: GraphFeature): Coordinate {
  if (feature.geometry.type === 'Point') return feature.geometry.coordinates;
  if (feature.geometry.type === 'LineString') return feature.geometry.coordinates[Math.floor(feature.geometry.coordinates.length / 2)] ?? [0, 0];
  const ring = feature.geometry.coordinates[0] ?? [];
  return ring[Math.floor(ring.length / 2)] ?? [0, 0];
}

function labelOf(feature: GraphFeature) {
  const { entityType, entityId, tags } = feature.properties;
  const kind = entityType === 'node' ? 'Điểm' : entityType === 'way' ? 'Đường/vùng' : 'Quan hệ';
  return tags.name?.trim() ? `${kind} “${tags.name.trim()}”` : `${kind} #${entityId}`;
}

function issue(feature: GraphFeature, suffix: string, severity: IssueSeverity, title: string, detail: string): EditorIssue {
  return { id: `${keyOf(feature)}:${suffix}`, severity, entityKey: keyOf(feature), coordinate: coordinateOf(feature), title, detail };
}

/**
 * Fast, deterministic checks intended for interactive feedback. Server-side
 * validation remains authoritative because it can inspect the complete dataset.
 */
export function findEditorIssues(features: GraphFeature[], changedKeys: ReadonlySet<string>): EditorIssue[] {
  const issues: EditorIssue[] = [];
  for (const feature of features) {
    if (!changedKeys.has(keyOf(feature))) continue;
    const { entityType, entityId, tags, nodeIds, members, topologyNode } = feature.properties;
    const label = labelOf(feature);

    for (const [tagKey, value] of Object.entries(tags)) {
      if (!tagKey.trim() || /[=\s]/.test(tagKey)) issues.push(issue(feature, `tag-key-${tagKey}`, 'error', 'Khóa tag không hợp lệ', `${label} có khóa tag “${tagKey || '(trống)'}”.`));
      if (/\r|\n|\0/.test(value)) issues.push(issue(feature, `tag-value-${tagKey}`, 'error', 'Giá trị tag không hợp lệ', `${label} có giá trị chứa ký tự không được phép.`));
    }

    if (entityType === 'node' && !topologyNode && feature.properties.version === 0 && Object.keys(tags).length === 0) {
      issues.push(issue(feature, 'untagged-new-node', 'warning', 'Điểm mới chưa có thuộc tính', `${label} sẽ khó nhận biết trong dữ liệu. Hãy chọn loại đối tượng hoặc thêm tag.`));
    }
    if (entityType === 'node' && (tags.amenity || tags.shop || tags.tourism) && !tags.name?.trim()) {
      issues.push(issue(feature, 'poi-without-name', 'warning', 'POI chưa có tên', `${label} có tag POI nhưng chưa có name=*.`));
    }

    if (entityType === 'way') {
      const coordinates = feature.geometry.type === 'Polygon'
        ? feature.geometry.coordinates[0] ?? []
        : feature.geometry.type === 'LineString' ? feature.geometry.coordinates : [];
      if (!nodeIds || nodeIds.length !== coordinates.length) {
        issues.push(issue(feature, 'node-geometry-mismatch', 'error', 'Topology way không khớp hình học', `${label} có node references và số đỉnh hình học không khớp.`));
        continue;
      }
      if (nodeIds.length < 2) issues.push(issue(feature, 'too-few-nodes', 'error', 'Way có quá ít đỉnh', `${label} cần ít nhất hai node.`));
      nodeIds.slice(1).forEach((nodeId, index) => {
        if (nodeId === nodeIds[index]) issues.push(issue(feature, `duplicate-node-${index}`, 'error', 'Hai đỉnh liền kề trùng nhau', `${label} có node ${nodeId} lặp liền kề.`));
      });
      if (feature.geometry.type === 'Polygon' && nodeIds.length >= 2 && nodeIds[0] !== nodeIds.at(-1)) {
        issues.push(issue(feature, 'unclosed-area', 'error', 'Vùng chưa khép kín', `${label} phải kết thúc bằng node đầu tiên.`));
      }
    }

    if (entityType === 'relation') {
      const seen = new Set<string>();
      for (const member of members ?? []) {
        const memberKey = `${member.type}/${member.ref}/${member.role}`;
        if (seen.has(memberKey)) issues.push(issue(feature, `duplicate-member-${memberKey}`, 'warning', 'Thành viên quan hệ bị lặp', `${label} chứa member ${member.type}/${member.ref} với cùng role nhiều lần.`));
        seen.add(memberKey);
        if (tags.type === 'multipolygon' && member.type !== 'way') issues.push(issue(feature, `multipolygon-member-${memberKey}`, 'error', 'Multipolygon chỉ nhận way', `${label} có member không phải way.`));
        if (tags.type === 'multipolygon' && member.role !== '' && member.role !== 'outer' && member.role !== 'inner') issues.push(issue(feature, `multipolygon-role-${memberKey}`, 'error', 'Role multipolygon không hợp lệ', `${label} chỉ cho phép outer hoặc inner.`));
      }
      if (tags.type === 'multipolygon' && !(members ?? []).some(member => member.type === 'way' && member.role !== 'inner')) {
        issues.push(issue(feature, 'multipolygon-without-outer', 'error', 'Multipolygon thiếu outer', `${label} cần ít nhất một way outer.`));
      }
    }
  }
  return issues;
}
