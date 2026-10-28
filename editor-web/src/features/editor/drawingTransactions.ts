import { findNearestSegment } from '../topology/graph';
import type { GraphFeature, WayNode } from '../../types/osm';
import type { FeatureMutation } from './EditorStore';
import { buildTopologyGraph, insertNodeIntoFeature, makeNodeFeature, makeWayFeature, type DrawMode, type SnappedVertex } from './drawing';
import { extendFeature } from './topologyOperations';

export interface WayExtension { key: string; endpoint: string }

/** Build one atomic drawing transaction, including nodes snapped into other ways. */
export function planDrawing(
  features: GraphFeature[],
  draft: SnappedVertex[],
  mode: Exclude<DrawMode, 'point' | 'select'>,
  allocateWayId: () => string,
  extension: WayExtension | null = null
): { way: GraphFeature; mutations: FeatureMutation[] } {
  const vertices = draft.map(vertex => {
    if (!vertex.nodeId) throw new Error('Đỉnh bản vẽ chưa có node ID.');
    return { ...vertex, nodeId: vertex.nodeId };
  });
  if (vertices.length < (mode === 'area' ? 3 : 2)) throw new Error('Bản vẽ chưa đủ đỉnh.');
  const byKey = new Map(features.map(feature => [`${feature.properties.entityType}/${feature.properties.entityId}`, feature]));
  const known = new Map<string, WayNode>();
  for (const feature of features) {
    for (const node of feature.properties.nodes ?? []) known.set(node.id, node);
    if (feature.properties.entityType === 'node' && feature.geometry.type === 'Point') known.set(feature.properties.entityId, {
      id: feature.properties.entityId, coordinates: feature.geometry.coordinates, version: feature.properties.version, tags: feature.properties.tags
    });
  }
  const mutations: FeatureMutation[] = [];
  const updates = new Map<string, GraphFeature>();
  const created = new Set<string>();
  for (const vertex of vertices) {
    if (!known.has(vertex.nodeId) && !created.has(vertex.nodeId)) {
      if (!vertex.nodeId.startsWith('-')) throw new Error(`Thiếu dữ liệu node ${vertex.nodeId}. Hãy tải lại way.`);
      created.add(vertex.nodeId);
      const node = makeNodeFeature(vertex.nodeId, vertex.coordinate);
      node.properties.topologyNode = true;
      mutations.push({ key: `node/${vertex.nodeId}`, feature: node });
    }
    if (!vertex.segment) continue;
    const key = `way/${vertex.segment.wayId}`;
    const current = updates.get(key) ?? byKey.get(key);
    if (!current) throw new Error('Way dùng để snap không còn trong graph.');
    if (current.properties.nodeIds?.includes(vertex.nodeId)) continue;
    // Recompute after each insertion: offsets are incorrect when drawing back
    // and forth across different segments of the same way.
    const segment = findNearestSegment(buildTopologyGraph([current]), vertex.coordinate, Infinity);
    if (!segment) throw new Error('Không xác định được đoạn snap.');
    updates.set(key, insertNodeIntoFeature(current, vertex.nodeId, vertex.coordinate, segment.segmentIndex));
  }
  const existing = extension ? updates.get(extension.key) ?? byKey.get(extension.key) : undefined;
  if (extension && !existing) throw new Error('Way đang tiếp tục không còn trong graph.');
  const way = extension && existing
    ? extendFeature(existing, vertices.map(vertex => ({ ...known.get(vertex.nodeId), id: vertex.nodeId, coordinates: vertex.coordinate })), extension.endpoint)
    : makeWayFeature(allocateWayId(), vertices.map(vertex => ({ nodeId: vertex.nodeId, coordinate: vertex.coordinate })), mode);
  // Carry versions/tags for reused nodes; future vertex edits must not fabricate
  // baseline version 1 or erase a POI when it is also part of a way.
  way.properties.nodes = way.properties.nodes?.map(node => ({ ...known.get(node.id), ...node, ...(known.has(node.id) ? { version: known.get(node.id)!.version, tags: known.get(node.id)!.tags } : {}) }));
  const key = `way/${way.properties.entityId}`;
  for (const [otherKey, feature] of updates) if (otherKey !== key) mutations.push({ key: otherKey, feature });
  mutations.push({ key, feature: way });
  return { way, mutations };
}
