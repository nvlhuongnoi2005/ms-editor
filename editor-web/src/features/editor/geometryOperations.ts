import clipping, { type MultiPolygon, type Polygon, type Pair } from 'polygon-clipping';
import type { Coordinate, GraphFeature, WayNode } from '../../types/osm';
import type { FeatureMutation } from './EditorStore';
import { rebuildWay, wayVertices } from './topologyOperations';

const keyOf = (feature: GraphFeature) => `${feature.properties.entityType}/${feature.properties.entityId}`;
const R = 6371008.8;
const radians = Math.PI / 180;
export type GeometryOperation = 'circle' | 'rotate' | 'scale' | 'align' | 'distribute' | 'hole' | 'union' | 'intersection' | 'difference';
export interface GeometryOptions {
  operation: GeometryOperation;
  value?: number;
  center?: Coordinate;
  radius?: number;
  axis?: 'east' | 'north';
  primary?: string;
}

export function expandGeometrySelection(sources: GraphFeature[], available: GraphFeature[]): GraphFeature[] {
  const byKey = new Map(available.map(feature => [keyOf(feature), feature]));
  const result = new Map<string, GraphFeature>();
  const visiting = new Set<string>();
  function visit(feature: GraphFeature) {
    const key = keyOf(feature);
    if (visiting.has(key)) throw new Error('Quan hệ có vòng lặp.');
    if (result.has(key)) return;
    if (feature.properties.entityType !== 'relation') { result.set(key, feature); return; }
    visiting.add(key);
    if (!feature.properties.members?.length) throw new Error('Quan hệ thiếu thành viên.');
    for (const member of feature.properties.members) {
      const child = byKey.get(`${member.type}/${member.ref}`);
      if (!child) throw new Error(`Chưa tải đủ thành viên ${member.type}/${member.ref}. Hãy tải đầy đủ trước khi biến đổi.`);
      visit(child);
    }
    visiting.delete(key);
  }
  sources.forEach(visit);
  return [...result.values()];
}

function validCoordinate(point: Coordinate): Coordinate {
  if (!point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('Tọa độ kết quả vượt giới hạn bản đồ.');
  // Canonical API uses E7. Validate and preview the same precision that is saved.
  return [Math.round(point[0] * 1e7) / 1e7, Math.round(point[1] * 1e7) / 1e7];
}

const orient = (a: Coordinate, b: Coordinate, c: Coordinate) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segmentsIntersect(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) return false;
  const on = (p: Coordinate, q: Coordinate, r: Coordinate) => Math.abs(orient(p, q, r)) < 1e-18 && r[0] >= Math.min(p[0], q[0]) && r[0] <= Math.max(p[0], q[0]) && r[1] >= Math.min(p[1], q[1]) && r[1] <= Math.max(p[1], q[1]);
  return on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b) || (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0);
}
const ringsTouch = (a: Coordinate[], b: Coordinate[]) => a.some((p, i) => i > 0 && b.some((q, j) => j > 0 && segmentsIntersect(a[i - 1], p, b[j - 1], q)));

function nodesOf(feature: GraphFeature): WayNode[] {
  if (feature.properties.entityType === 'node' && feature.geometry.type === 'Point') return [{ id: feature.properties.entityId, coordinates: feature.geometry.coordinates, version: feature.properties.version, tags: feature.properties.tags }];
  if (feature.geometry.type === 'Polygon' && feature.geometry.coordinates.length !== 1) throw new Error('Way không thể chứa inner ring. Hãy dùng relation multipolygon.');
  return wayVertices(feature);
}

/** A local metric tangent frame, not degrees or screen pixels. Large/polar selections are rejected. */
function metricFrame(points: Coordinate[], explicitCenter?: Coordinate) {
  if (!points.length) throw new Error('Chưa chọn geometry.');
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const point of points) { validCoordinate(point); west = Math.min(west, point[0]); east = Math.max(east, point[0]); south = Math.min(south, point[1]); north = Math.max(north, point[1]); }
  const center: Coordinate = explicitCenter ?? [(west + east) / 2, (south + north) / 2];
  validCoordinate(center);
  if (Math.abs(center[1]) > 85 || east - west > 1 || north - south > 1 || points.some(point => Math.abs(point[0] - center[0]) > 1 || Math.abs(point[1] - center[1]) > 1)) throw new Error('Biến đổi cục bộ chỉ hỗ trợ phạm vi tối đa 1° và ngoài vùng cực. Hãy chia nhỏ lựa chọn.');
  const xScale = R * radians * Math.cos(center[1] * radians), yScale = R * radians;
  return {
    project: ([x, y]: Coordinate): Coordinate => [(x - center[0]) * xScale, (y - center[1]) * yScale],
    unproject: ([x, y]: Coordinate): Coordinate => validCoordinate([center[0] + x / xScale, center[1] + y / yScale])
  };
}

function centerOf(points: Coordinate[]): Coordinate {
  return [(Math.min(...points.map(p => p[0])) + Math.max(...points.map(p => p[0]))) / 2,
    (Math.min(...points.map(p => p[1])) + Math.max(...points.map(p => p[1]))) / 2];
}

export function transformGeometry(sources: GraphFeature[], available: GraphFeature[], options: GeometryOptions): FeatureMutation[] {
  if (!['circle', 'rotate', 'scale', 'align', 'distribute'].includes(options.operation)) throw new Error('Công cụ biến đổi không hợp lệ.');
  if (options.center) validCoordinate(options.center);
  const expanded = expandGeometrySelection(sources, available);
  if (!expanded.length) throw new Error('Chưa chọn geometry.');
  if ((options.operation === 'rotate' && Number.isFinite(options.value) && options.value! % 360 === 0)
    || (options.operation === 'scale' && options.value === 100)) return [];
  const allNodes = expanded.flatMap(nodesOf);
  const frame = metricFrame(allNodes.map(node => node.coordinates), options.center);
  const moves = new Map<string, Coordinate>();
  const setMove = (node: WayNode, point: Coordinate) => {
    const next = frame.unproject(point);
    const existing = moves.get(node.id);
    if (existing && (existing[0] !== next[0] || existing[1] !== next[1])) throw new Error('Các đối tượng dùng chung node nhưng yêu cầu vị trí khác nhau. Hãy tách node trước khi căn chỉnh.');
    moves.set(node.id, next);
  };
  if (options.operation === 'align' || options.operation === 'distribute') {
    if (sources.length < (options.operation === 'align' ? 2 : 3)) throw new Error('Chưa đủ đối tượng để căn chỉnh/phân bố.');
    // Each top-level selection is one object (a collection keeps its internal layout).
    const objects = sources.map(source => {
      const nodes = expandGeometrySelection([source], available).flatMap(nodesOf);
      return { nodes, center: centerOf(nodes.map(node => frame.project(node.coordinates))) };
    });
    const axis = options.axis === 'north' ? 1 : 0;
    if (options.operation === 'align') {
      const fixed = axis === 0 ? 1 : 0;
      const target = centerOf(objects.map(object => object.center))[fixed];
      for (const object of objects) for (const node of object.nodes) { const p = frame.project(node.coordinates); p[fixed] += target - object.center[fixed]; setMove(node, p); }
    } else {
      objects.sort((a, b) => a.center[axis] - b.center[axis]);
      const start = objects[0].center[axis], step = (objects.at(-1)!.center[axis] - start) / (objects.length - 1);
      objects.forEach((object, index) => object.nodes.forEach(node => { const p = frame.project(node.coordinates); p[axis] += start + index * step - object.center[axis]; setMove(node, p); }));
    }
  } else if (options.operation === 'circle') {
    if (expanded.length !== 1 || expanded[0].properties.entityType !== 'way') throw new Error('Circularize cần một way khép kín.');
    const nodes = wayVertices(expanded[0]);
    if (nodes.length < 4 || nodes[0].id !== nodes.at(-1)!.id || new Set(nodes.slice(0, -1).map(node => node.id)).size !== nodes.length - 1) throw new Error('Vòng đỉnh phải khép kín với ít nhất 3 đỉnh phân biệt.');
    const points = nodes.slice(0, -1).map(node => frame.project(node.coordinates));
    const radius = options.radius ?? points.reduce((sum, p) => sum + Math.hypot(...p), 0) / points.length;
    if (!Number.isFinite(radius) || radius <= 0) throw new Error('Bán kính phải lớn hơn 0.');
    // Equal angular steps preserve ring order even for off-centre/concave input.
    const signedArea = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    if (Math.abs(signedArea) < 1e-8) throw new Error('Vòng đỉnh có diện tích bằng 0.');
    const start = Math.atan2(points[0][1], points[0][0]), direction = Math.sign(signedArea);
    nodes.slice(0, -1).forEach((node, index) => { const angle = start + direction * index * 2 * Math.PI / points.length; setMove(node, [radius * Math.cos(angle), radius * Math.sin(angle)]); });
  } else {
    const value = options.value;
    if (value === undefined || !Number.isFinite(value) || (options.operation === 'scale' && value <= 0)) throw new Error('Góc xoay/tỷ lệ không hợp lệ.');
    const angle = value * radians, factor = value / 100;
    for (const node of allNodes) {
      const [x, y] = frame.project(node.coordinates);
      setMove(node, options.operation === 'rotate' ? [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)] : [x * factor, y * factor]);
    }
  }
  const mutations: FeatureMutation[] = [];
  const metadata = new Map(allNodes.map(node => [node.id, node]));
  const known = new Map(available.map(feature => [keyOf(feature), feature]));
  for (const [id, coordinate] of moves) {
    const existing = known.get(`node/${id}`), node = metadata.get(id)!;
    const feature: GraphFeature = existing ? { ...existing, properties: { ...existing.properties, coordinates: coordinate }, geometry: { type: 'Point', coordinates: coordinate } }
      : { type: 'Feature', properties: { entityType: 'node', entityId: id, version: node.version ?? 1, tags: node.tags ?? {}, coordinates: coordinate, topologyNode: true }, geometry: { type: 'Point', coordinates: coordinate } };
    mutations.push({ key: `node/${id}`, feature });
  }
  // Updating shared nodes also updates every loaded referencing way, in one undo entry.
  for (const way of available) if (way.properties.entityType === 'way' && way.properties.nodeIds?.some(id => moves.has(id))) {
    const next = rebuildWay(way, wayVertices(way).map(node => ({ ...node, coordinates: moves.get(node.id) ?? node.coordinates })));
    const coordinates = next.geometry.type === 'Polygon' ? next.geometry.coordinates[0] : next.geometry.type === 'LineString' ? next.geometry.coordinates : [];
    if (coordinates.some((point, i) => i > 0 && point[0] === coordinates[i - 1][0] && point[1] === coordinates[i - 1][1])) throw new Error('Biến đổi làm hai đỉnh liền kề trùng tọa độ E7.');
    validateRing(next);
    mutations.push({ key: keyOf(way), feature: next });
  }
  return mutations;
}

function validateRing(feature: GraphFeature) {
  if (feature.geometry.type !== 'Polygon') return;
  const ring = feature.geometry.coordinates[0];
  if (!ring || ring.length < 4 || ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1] || new Set(ring.slice(0, -1).map(p => p.join(','))).size < 3) throw new Error('Vùng chưa khép kín hoặc suy biến ở độ chính xác E7.');
  if (ring.length > 2001) throw new Error('Vòng vượt 2.000 đỉnh; hãy chia nhỏ trước khi dùng công cụ geometry.');
  let signedArea = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = validCoordinate(ring[i]), b = validCoordinate(ring[i + 1]);
    if (a[0] === b[0] && a[1] === b[1]) throw new Error('Hai đỉnh liền kề trùng tọa độ ở độ chính xác E7.');
    signedArea += orient(ring[0], a, b);
    for (let j = i + 2; j < ring.length - 1; j++) {
      if (i === 0 && j === ring.length - 2) continue;
      const c = ring[j], d = ring[j + 1];
      if (segmentsIntersect(a, b, c, d)) throw new Error('Vùng tự giao cắt hoặc tự chạm.');
    }
  }
  if (Math.abs(signedArea) < 1e-18) throw new Error('Vùng có diện tích bằng 0.');
  const area = clipping.union([ring]);
  if (area.length !== 1 || area[0].length !== 1) throw new Error('Phép biến đổi làm vùng tự giao cắt.');
}

/** Assemble OSM multipolygon member ways, including reversed/open segments. No guessed closure. */
export function areaGeometry(source: GraphFeature, available: GraphFeature[], validate = true): MultiPolygon {
  if (source.properties.entityType === 'way' && source.geometry.type === 'Polygon') {
    if (validate) validateRing(source);
    if (source.geometry.coordinates.length !== 1) throw new Error('Way có inner ring phải chuyển thành relation multipolygon.');
    return [source.geometry.coordinates];
  }
  if (source.properties.entityType !== 'relation' || source.properties.tags.type !== 'multipolygon') throw new Error('Chỉ hỗ trợ vùng hoặc relation multipolygon.');
  const byKey = new Map(available.map(feature => [keyOf(feature), feature]));
  const outer: Polygon[] = [], inner: Polygon[] = [];
  for (const role of ['outer', 'inner']) {
    const segments = (source.properties.members ?? []).filter(member => (member.role || 'outer') === role).map(member => {
      const way = byKey.get(`${member.type}/${member.ref}`);
      if (!way || member.type !== 'way') throw new Error(`Thiếu member way ${member.ref} của multipolygon.`);
      return [...wayVertices(way)];
    });
    while (segments.length) {
      const ring = segments.shift()!;
      while (ring[0].id !== ring.at(-1)!.id) {
        const last = ring.at(-1)!.id;
        const candidates = segments.map((segment, i) => ({ segment, i })).filter(({ segment }) => segment[0].id === last || segment.at(-1)!.id === last);
        if (candidates.length !== 1) throw new Error('Vòng multipolygon hở hoặc có nhánh không rõ ràng.');
        const { segment, i } = candidates[0]; segments.splice(i, 1);
        if (segment[0].id !== last) segment.reverse();
        ring.push(...segment.slice(1));
      }
      if (ring.length < 4) throw new Error('Vòng multipolygon không hợp lệ.');
      const coordinates = ring.map(node => validCoordinate(node.coordinates));
      if (validate) validateRing({ ...source, geometry: { type: 'Polygon', coordinates: [coordinates] } });
      (role === 'outer' ? outer : inner).push([coordinates]);
    }
  }
  if (!outer.length || source.properties.members?.some(member => member.role && !['outer', 'inner'].includes(member.role))) throw new Error('Multipolygon thiếu outer hoặc có vai trò không được hỗ trợ.');
  if (validate) {
    const rings = [...outer, ...inner].flat();
    if (rings.some((ring, index) => rings.slice(index + 1).some(other => ringsTouch(ring, other)))) throw new Error('Các vòng multipolygon giao cắt hoặc chạm nhau.');
  }
  const shells = clipping.union(outer[0], ...outer.slice(1));
  if (inner.some(hole => clipping.difference(hole, shells).length > 0)) throw new Error('Inner ring nằm ngoài outer.');
  return inner.length ? clipping.difference(shells, ...inner) : shells;
}

export function booleanGeometry(sources: GraphFeature[], available: GraphFeature[], options: GeometryOptions,
  allocateNode: () => string, allocateWay: () => string, allocateRelation: () => string): { mutations: FeatureMutation[]; selected: GraphFeature } {
  if (!['hole', 'union', 'intersection', 'difference'].includes(options.operation)) throw new Error('Phép toán vùng không hợp lệ.');
  if (sources.length < 2) throw new Error('Chọn ít nhất hai vùng.');
  const primary = sources.find(source => keyOf(source) === options.primary);
  if (!primary) throw new Error('Hãy chọn vùng chính tường minh.');
  const subject = areaGeometry(primary, available), clips = sources.filter(source => source !== primary).map(source => areaGeometry(source, available));
  if (options.operation === 'hole') {
    if (clips.some(clip => clipping.difference(clip, subject).length)) throw new Error('Vùng tạo lỗ phải nằm hoàn toàn trong vùng chính.');
    // A valid hole must not touch the exterior boundary: all cutter vertices must be strictly inside.
    if (clips.flat(2).some(ring => subject.some(poly => poly.some(boundary => ringsTouch(ring, boundary))))) throw new Error('Vùng tạo lỗ không được chạm biên vùng chính.');
  }
  const output = options.operation === 'union' ? clipping.union(subject, ...clips)
    : options.operation === 'intersection' ? clipping.intersection(subject, ...clips) : clipping.difference(subject, ...clips);
  if (!output.length) throw new Error('Kết quả rỗng; không tạo hoặc xóa dữ liệu.');
  const mutations: FeatureMutation[] = [], members: NonNullable<GraphFeature['properties']['members']> = [];
  const nodes = new Map<string, GraphFeature>();
  const nodeFor = (point: Pair) => {
    const coordinate = validCoordinate(point), key = coordinate.join(',');
    let node = nodes.get(key);
    if (!node) { const id = allocateNode(); node = { type: 'Feature', properties: { entityType: 'node', entityId: id, version: 0, tags: {}, coordinates: coordinate, topologyNode: true }, geometry: { type: 'Point', coordinates: coordinate } }; nodes.set(key, node); mutations.push({ key: keyOf(node), feature: node }); }
    return { id: node.properties.entityId, coordinates: coordinate, version: 0, tags: {} };
  };
  const tags = { ...primary.properties.tags }; delete tags.type;
  for (const polygon of output) for (const [index, ring] of polygon.entries()) {
    const vertices = ring.map(nodeFor), id = allocateWay();
    const simple = output.length === 1 && polygon.length === 1;
    const way: GraphFeature = { type: 'Feature', properties: { entityType: 'way', entityId: id, version: 0, tags: simple ? { ...tags, area: 'yes' } : {}, name: simple ? tags.name : undefined, nodeIds: vertices.map(node => node.id), nodes: vertices, parents: [] }, geometry: { type: 'Polygon', coordinates: [vertices.map(node => node.coordinates)] } };
    validateRing(way);
    mutations.push({ key: keyOf(way), feature: way });
    members.push({ type: 'way', ref: id, role: index === 0 ? 'outer' : 'inner', sequence: members.length });
  }
  if (output.length === 1 && output[0].length === 1) return { mutations, selected: mutations.at(-1)!.feature! };
  const id = allocateRelation();
  const relation: GraphFeature = { type: 'Feature', properties: { entityType: 'relation', entityId: id, version: 0, tags: { ...tags, type: 'multipolygon' }, name: tags.name, members }, geometry: { type: 'Point', coordinates: output[0][0][0] } };
  areaGeometry(relation, mutations.flatMap(item => item.feature ? [item.feature] : []));
  mutations.push({ key: keyOf(relation), feature: relation });
  return { mutations, selected: relation };
}
