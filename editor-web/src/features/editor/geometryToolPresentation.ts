import type { GraphFeature } from '../../types/osm';

export function summarizeGeometryImpact(keys: readonly string[], features: GraphFeature[]) {
  const byKey = new Map(features.map(feature => [`${feature.properties.entityType}/${feature.properties.entityId}`, feature]));
  const expanded = new Set<string>(), nodes = new Set<string>(), visiting = new Set<string>();
  let complete = true;
  const visit = (key: string) => {
    if (visiting.has(key)) { complete = false; return; }
    if (expanded.has(key)) return;
    const feature = byKey.get(key);
    if (!feature) { complete = false; return; }
    expanded.add(key); visiting.add(key);
    if (feature.properties.entityType === 'node') nodes.add(feature.properties.entityId);
    if (feature.properties.entityType === 'way') {
      if (!feature.properties.nodeIds?.length) complete = false;
      for (const id of feature.properties.nodeIds ?? []) nodes.add(id);
    }
    if (feature.properties.entityType === 'relation') {
      if (!feature.properties.members?.length) complete = false;
      for (const member of feature.properties.members ?? []) visit(`${member.type}/${member.ref}`);
    }
    visiting.delete(key);
  };
  keys.forEach(visit);
  const relatedWays = features.filter(feature => feature.properties.entityType === 'way'
    && !expanded.has(`way/${feature.properties.entityId}`) && feature.properties.nodeIds?.some(id => nodes.has(id))).length;
  return { nodes: nodes.size, relatedWays, complete };
}

export interface ToolFormState {
  group: string; operation: string; count: number; polygonCount: number; circularizable: boolean;
  primary: string; center: string; longitude: string; latitude: string; angle: string; scale: string; radius: string;
}

/** UI-only validation. Geometry/topology validation remains authoritative at apply. */
export function toolBlockReason(state: ToolFormState): string | null {
  if (!state.count) return 'Chọn đối tượng trên bản đồ trước khi mở công cụ.';
  if (state.group === 'area') {
    if (state.polygonCount !== state.count) return 'Lựa chọn có đối tượng không phải vùng. Chỉ chọn vùng hoặc multipolygon.';
    if (state.count < 2) return 'Cần thêm ít nhất 1 vùng. Giữ Ctrl/Cmd và click để chọn thêm.';
    if (!state.primary) return 'Chọn vùng chính để xác định thuộc tính và thứ tự phép toán.';
  }
  if (state.group === 'align') {
    const minimum = state.operation === 'distribute' ? 3 : 2;
    if (state.count < minimum) return `Cần thêm ${minimum - state.count} đối tượng để ${state.operation === 'distribute' ? 'phân bố đều' : 'căn hàng'}.`;
  }
  if (state.group === 'transform') {
    if (state.operation === 'circle' && !state.circularizable) return 'Chọn đúng 1 đường khép kín hoặc vùng có ít nhất 3 đỉnh phân biệt.';
    const value = state.operation === 'rotate' ? state.angle : state.scale;
    if (state.operation !== 'circle' && (!value.trim() || !Number.isFinite(Number(value)))) return 'Nhập một giá trị số hợp lệ.';
    if (state.operation === 'scale' && Number(state.scale) <= 0) return 'Tỷ lệ phải lớn hơn 0%.';
    if (state.operation === 'circle' && state.radius.trim() && (!Number.isFinite(Number(state.radius)) || Number(state.radius) <= 0)) return 'Bán kính phải lớn hơn 0 m hoặc để trống để tự tính.';
    if (state.center === 'custom') {
      if (!state.longitude.trim() || !state.latitude.trim()) return 'Nhập đủ kinh độ và vĩ độ của tâm biến đổi.';
      const lon = Number(state.longitude), lat = Number(state.latitude);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return 'Tâm phải có kinh độ từ −180° đến 180°, vĩ độ từ −90° đến 90°.';
    }
  }
  return null;
}
