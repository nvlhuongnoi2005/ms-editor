import { splitWayAtNode } from '../topology/graph';
import type { GraphFeature, RelationMember, Tags, WayNode } from '../../types/osm';
import type { FeatureMutation } from './EditorStore';

export type TopologyAction = 'split' | 'merge' | 'disconnect' | 'reverse' | 'remove-vertex';
export interface TopologyResult {
  mutations: FeatureMutation[];
  selected: GraphFeature;
  vertexId?: string;
}

const keyOf = (feature: GraphFeature) => `${feature.properties.entityType}/${feature.properties.entityId}`;
const mutation = (feature: GraphFeature): FeatureMutation => ({ key: keyOf(feature), feature });

export function wayVertices(way: GraphFeature): WayNode[] {
  if (way.properties.entityType !== 'way' || way.geometry.type === 'Point') throw new Error('Hãy chọn một way.');
  const coordinates = way.geometry.type === 'Polygon' ? way.geometry.coordinates[0] ?? [] : way.geometry.coordinates;
  const refs = way.properties.nodeIds ?? [];
  if (refs.length !== coordinates.length || refs.length < 2) throw new Error('Way thiếu dữ liệu node/hình học. Hãy tải lại vùng này.');
  const metadata = new Map(way.properties.nodes?.map(node => [node.id, node]));
  return refs.map((id, index) => ({ ...metadata.get(id), id, coordinates: coordinates[index] }));
}

export function isOpenWay(way: GraphFeature): boolean {
  return way.properties.entityType === 'way' && way.geometry.type === 'LineString'
    && Boolean(way.properties.nodeIds?.length) && way.properties.nodeIds![0] !== way.properties.nodeIds!.at(-1);
}

export function rebuildWay(way: GraphFeature, nodes: WayNode[], tags = way.properties.tags): GraphFeature {
  const coordinates = nodes.map(node => [...node.coordinates] as [number, number]);
  return {
    ...way,
    properties: { ...way.properties, tags: { ...tags }, name: tags.name ?? '', nodeIds: nodes.map(node => node.id), nodes },
    geometry: way.geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: [coordinates] } : { type: 'LineString', coordinates }
  };
}

function requireOpenWay(way: GraphFeature) {
  if (!isOpenWay(way)) throw new Error('Thao tác này cần way dạng đường mở.');
}

function parentsOf(ways: GraphFeature[], features: GraphFeature[]): GraphFeature[] {
  const byKey = new Map(features.map(feature => [keyOf(feature), feature]));
  for (const way of ways) {
    if (way.properties.version > 0 && way.properties.parents === undefined) throw new Error('Chưa có dữ liệu relation cha. Hãy tải lại graph bằng API mới.');
    for (const parent of way.properties.parents ?? []) {
      // A parent may have been removed locally; its current members below decide
      // whether it is still affected. Never proceed with an unloaded parent.
      if (!byKey.has(`relation/${parent.id}`)) throw new Error(`Cần tải quan hệ ${parent.id} trước khi sửa topology.`);
    }
  }
  const ids = new Set(ways.map(way => way.properties.entityId));
  return features.filter(feature => feature.properties.entityType === 'relation'
    && feature.properties.members?.some(member => member.type === 'way' && ids.has(member.ref)));
}

function requireSupportedParents(parents: GraphFeature[]) {
  for (const parent of parents) {
    if (!['route', 'multipolygon', 'boundary'].includes(parent.properties.tags.type ?? '')) {
      throw new Error(`Quan hệ ${parent.properties.entityId} (${parent.properties.tags.type ?? 'chưa có type'}) cần xử lý thủ công trước thao tác này.`);
    }
  }
}

function withMembers(relation: GraphFeature, members: RelationMember[]): FeatureMutation {
  return mutation({ ...relation, properties: { ...relation.properties, members: members.map((member, sequence) => ({ ...member, sequence })) } });
}

export function splitFeature(way: GraphFeature, nodeId: string, newId: string, features: GraphFeature[]): TopologyResult {
  requireOpenWay(way);
  const vertices = wayVertices(way);
  if (vertices.filter(node => node.id === nodeId).length !== 1) throw new Error('Node tách phải xuất hiện đúng một lần trong way.');
  const [first, second] = splitWayAtNode({ id: way.properties.entityId, nodeRefs: vertices.map(node => node.id), tags: way.properties.tags }, nodeId, way.properties.entityId, newId);
  const index = first.nodeRefs.length - 1;
  const kept = rebuildWay(way, vertices.slice(0, index + 1));
  const created = rebuildWay({ ...way, id: `way-${newId}`, properties: { ...way.properties, entityId: second.id, version: 0 } }, vertices.slice(index));
  const parents = parentsOf([way], features);
  requireSupportedParents(parents);
  const relations = parents.map(parent => withMembers(parent, parent.properties.members!.flatMap(member => {
    if (member.type !== 'way' || member.ref !== way.properties.entityId) return [member];
    const pair = [member, { ...member, ref: newId }];
    if (member.role === 'backward') pair.reverse();
    else if (parent.properties.tags.type === 'route' && member.role !== 'forward') {
      // An empty route role needs an unambiguous traversal direction. Avoid
      // silently breaking a route when only a subset of its ways is downloaded.
      throw new Error(`Hãy đặt role forward/backward cho way trong route ${parent.properties.entityId} trước khi tách.`);
    }
    return pair;
  })));
  return { mutations: [mutation(kept), mutation(created), ...relations], selected: kept, vertexId: nodeId };
}

/** Reverse digitized direction while preserving the physical meaning of tags. */
export function reverseWayTags(tags: Tags): Tags {
  if (tags.waterway || ['coastline', 'cliff'].includes(tags.natural ?? '') || tags.man_made === 'embankment' || tags.barrier === 'retaining_wall') {
    throw new Error('Way có hướng hình học mang ý nghĩa tự nhiên/công trình; cần xử lý thủ công trước khi đảo chiều.');
  }
  if (['motorway', 'motorway_link'].includes(tags.highway ?? '') && tags.oneway === undefined) {
    throw new Error('Hãy khai báo oneway trước khi đảo chiều đường cao tốc.');
  }
  const result: Tags = {};
  for (const [key, value] of Object.entries(tags)) {
    if (['turn:lanes', 'change:lanes', 'destination', 'destination:lanes', 'placement'].includes(key)) {
      throw new Error(`Tag hướng ${key} cần xử lý thủ công trước khi đảo chiều.`);
    }
    if (/^(oneway|incline|direction):/.test(key) && !/(forward|backward|left|right)/.test(key)) {
      throw new Error(`Tag hướng ${key} cần xử lý thủ công trước khi đảo chiều.`);
    }
    const swappedKey = key.split(':').map(part => ({ forward: 'backward', backward: 'forward', left: 'right', right: 'left' })[part] ?? part).join(':');
    let next = value;
    if (key === 'oneway') {
      if (['yes', 'true', '1'].includes(value)) next = '-1';
      else if (value === '-1') next = 'yes';
      else if (!['no', 'false', '0'].includes(value)) throw new Error(`Không thể tự đảo oneway=${value}.`);
    }
    if (key === 'incline') {
      if (value === 'up') next = 'down';
      else if (value === 'down') next = 'up';
      else if (/^[+-]?\d+(\.\d+)?(%|°)?$/.test(value)) next = value.startsWith('-') ? value.slice(1) : `-${value.replace(/^\+/, '')}`;
      else throw new Error(`Không thể tự đảo incline=${value}.`);
    }
    if (key === 'direction') {
      const opposite = { forward: 'backward', backward: 'forward', clockwise: 'anticlockwise', anticlockwise: 'clockwise' };
      next = opposite[value as keyof typeof opposite] ?? value;
    }
    result[swappedKey] = next;
  }
  // Reversing geometry would change the implicit one-way direction of a roundabout.
  if (tags.junction === 'roundabout' && tags.oneway === undefined) result.oneway = '-1';
  return result;
}

export function reverseFeature(way: GraphFeature, features: GraphFeature[]): TopologyResult {
  const parents = parentsOf([way], features);
  requireSupportedParents(parents);
  const reversed = rebuildWay(way, wayVertices(way).reverse(), reverseWayTags(way.properties.tags));
  const relations = parents.map(parent => withMembers(parent, parent.properties.members!.map(member => {
    if (member.type !== 'way' || member.ref !== way.properties.entityId) return member;
    return { ...member, role: member.role === 'forward' ? 'backward' : member.role === 'backward' ? 'forward' : member.role };
  })));
  return { mutations: [mutation(reversed), ...relations], selected: reversed };
}

export function removeVertex(way: GraphFeature, nodeId: string): TopologyResult {
  const vertices = wayVertices(way);
  const closed = vertices[0].id === vertices.at(-1)!.id;
  const uniqueRing = closed ? vertices.slice(0, -1) : vertices;
  if (uniqueRing.filter(node => node.id === nodeId).length !== 1) throw new Error('Hãy chọn một đỉnh không lặp trong way.');
  const remaining = uniqueRing.filter(node => node.id !== nodeId);
  if (remaining.length < (closed ? 3 : 2)) throw new Error('Không thể xóa: way sẽ không còn đủ đỉnh.');
  if (closed) remaining.push(remaining[0]);
  const updated = rebuildWay(way, remaining);
  // Leave the node entity intact: unloaded ways/relations may still reference it.
  return { mutations: [mutation(updated)], selected: updated };
}

export function disconnectVertex(way: GraphFeature, nodeId: string, newId: string): TopologyResult {
  const vertices = wayVertices(way);
  const source = vertices.find(node => node.id === nodeId);
  if (!source) throw new Error('Node không nằm trong way đang chọn.');
  // Keep POI tags and relation memberships on the original node. The clone is a
  // geometry-only node belonging to this way, including both ends of a closed ring.
  const clone: WayNode = { id: newId, coordinates: [...source.coordinates], version: 0, tags: {} };
  const updated = rebuildWay(way, vertices.map(node => node.id === nodeId ? clone : node));
  const node: GraphFeature = { type: 'Feature', id: `node-${newId}`, properties: { entityType: 'node', entityId: newId, version: 0, tags: {}, topologyNode: true }, geometry: { type: 'Point', coordinates: clone.coordinates } };
  return { mutations: [mutation(node), mutation(updated)], selected: updated, vertexId: newId };
}

export function mergeCandidates(way: GraphFeature, features: GraphFeature[]): GraphFeature[] {
  if (!isOpenWay(way)) return [];
  const endpoints = [way.properties.nodeIds![0], way.properties.nodeIds!.at(-1)];
  return features.filter(other => other.properties.entityId !== way.properties.entityId && isOpenWay(other)
    && [other.properties.nodeIds![0], other.properties.nodeIds!.at(-1)].some(id => endpoints.includes(id)));
}

function equivalentTag(key: string, a: string, b: string) {
  const normalize = (v: string) => key === 'oneway' ? ({ '1': 'yes', true: 'yes', '0': 'no', false: 'no' }[v] ?? v) : v;
  return normalize(a) === normalize(b);
}

export function mergeFeatures(kept: GraphFeature, removed: GraphFeature, features: GraphFeature[]): TopologyResult {
  requireOpenWay(kept);
  requireOpenWay(removed);
  if (keyOf(kept) === keyOf(removed)) throw new Error('Cần chọn hai way khác nhau.');
  const first = wayVertices(kept);
  let second = wayVertices(removed);
  const secondIds = new Set(second.map(node => node.id));
  const shared = first.filter(node => secondIds.has(node.id));
  if (shared.length !== 1) throw new Error('Chỉ nối hai way chung đúng một endpoint; không tạo vòng hoặc nhánh.');
  const joint = shared[0].id;
  if (![first[0].id, first.at(-1)!.id].includes(joint) || ![second[0].id, second.at(-1)!.id].includes(joint)) throw new Error('Điểm nối phải là endpoint của cả hai way.');
  const prepend = first[0].id === joint;
  const reverseSecond = prepend ? second.at(-1)!.id !== joint : second[0].id !== joint;
  const otherTags = reverseSecond ? reverseWayTags(removed.properties.tags) : removed.properties.tags;
  // Direction defaults have meaning too: missing oneway must not absorb a one-way.
  for (const key of ['oneway', 'junction']) {
    if (!equivalentTag(key, kept.properties.tags[key] ?? (key === 'oneway' ? 'no' : ''), otherTags[key] ?? (key === 'oneway' ? 'no' : ''))) throw new Error(`Hai way khác ${key}; hãy thống nhất thuộc tính trước khi nối.`);
  }
  const tags = { ...kept.properties.tags };
  for (const key of new Set([...Object.keys(tags), ...Object.keys(otherTags)])) {
    if (key !== 'oneway' && (tags[key] === undefined || otherTags[key] === undefined)) throw new Error(`Tag ${key} chỉ có trên một way. Hãy thống nhất thuộc tính trước khi nối.`);
  }
  for (const [key, value] of Object.entries(otherTags)) {
    if (tags[key] !== undefined && !equivalentTag(key, tags[key], value)) throw new Error(`Xung đột tag ${key}: “${tags[key]}” / “${value}”. Hãy sửa trước khi nối.`);
    tags[key] = value;
  }
  if (reverseSecond) second = [...second].reverse();
  const vertices = prepend ? [...second.slice(0, -1), ...first] : [...first, ...second.slice(1)];
  const parents = parentsOf([kept, removed], features);
  requireSupportedParents(parents);
  const relations = parents.map(parent => {
    const members = parent.properties.members!;
    const positions = members.flatMap((member, index) => member.type === 'way' && [kept.properties.entityId, removed.properties.entityId].includes(member.ref) ? [index] : []);
    if (positions.length !== 2 || positions[1] !== positions[0] + 1) throw new Error(`Quan hệ ${parent.properties.entityId} phải chứa đúng hai way liền kề để nối an toàn.`);
    const a = members[positions[0]], b = members[positions[1]];
    const adjustedRole = (member: RelationMember) => member.ref === removed.properties.entityId && reverseSecond
      ? member.role === 'forward' ? 'backward' : member.role === 'backward' ? 'forward' : member.role : member.role;
    const role = adjustedRole(a);
    if (role !== adjustedRole(b)) throw new Error(`Role trong quan hệ ${parent.properties.entityId} không khớp sau khi nối.`);
    if (parent.properties.tags.type === 'route') {
      const expectedFirst = role === 'backward' ? (prepend ? kept : removed) : (prepend ? removed : kept);
      if (!['forward', 'backward'].includes(role) || a.ref !== expectedFirst.properties.entityId) throw new Error(`Route ${parent.properties.entityId} cần role forward/backward và thứ tự liên thông trước khi nối.`);
    }
    return withMembers(parent, members.flatMap((member, index) => index === positions[0] ? [{ ...member, ref: kept.properties.entityId, role }] : index === positions[1] ? [] : [member]));
  });
  const merged = rebuildWay({ ...kept, properties: { ...kept.properties, parents: [...new Map([...(kept.properties.parents ?? []), ...(removed.properties.parents ?? [])].map(parent => [parent.id, parent])).values()] } }, vertices, tags);
  return { mutations: [mutation(merged), { key: keyOf(removed), feature: null }, ...relations], selected: merged };
}

export function extendFeature(way: GraphFeature, vertices: WayNode[], endpoint: string): GraphFeature {
  requireOpenWay(way);
  const existing = wayVertices(way);
  if (vertices.length < 2 || vertices[0].id !== endpoint) throw new Error('Cần thêm ít nhất một đỉnh từ endpoint đang chọn.');
  if (existing[0].id === endpoint) return rebuildWay(way, [...vertices.slice(1).reverse(), ...existing]);
  if (existing.at(-1)!.id === endpoint) return rebuildWay(way, [...existing, ...vertices.slice(1)]);
  throw new Error('Way đã thay đổi: điểm tiếp tục không còn là endpoint.');
}
