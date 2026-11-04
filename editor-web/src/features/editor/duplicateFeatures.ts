import type { Coordinate, GraphFeature, Tags, WayNode } from '../../types/osm';
import type { FeatureMutation } from './EditorStore';
import { makeNodeFeature, makeWayFeature } from './drawing';

export interface DuplicateFeaturesResult {
  features: GraphFeature[];
  copies: Map<string, GraphFeature>;
  mutations: FeatureMutation[];
}

function keyOf(feature: Pick<GraphFeature, 'properties'>): string {
  return `${feature.properties.entityType}/${feature.properties.entityId}`;
}

function translate(coordinate: Coordinate, offset: Coordinate): Coordinate {
  return [coordinate[0] + offset[0], coordinate[1] + offset[1]];
}

function copiedNode(id: string, coordinate: Coordinate, tags: Tags): GraphFeature {
  const node = makeNodeFeature(id, coordinate);
  node.properties = { ...node.properties, name: tags.name || '', tags: { ...tags }, topologyNode: true };
  return node;
}

function coordinatesOfWay(feature: GraphFeature): Coordinate[] {
  if (feature.geometry.type === 'LineString') return feature.geometry.coordinates;
  if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates[0] ?? [];
  throw new Error('Chỉ có thể nhân bản node hoặc way.');
}

/** Duplicates a set while retaining shared topology inside the copied set. */
export function duplicateFeatures(
  sources: GraphFeature[],
  availableFeatures: GraphFeature[],
  allocateNodeId: () => string,
  allocateWayId: () => string,
  offset: Coordinate = [0, 0]
): DuplicateFeaturesResult {
  if (!sources.length) throw new Error('Không có đối tượng để nhân bản.');

  const sourceNodes = new Map<string, WayNode>();
  for (const feature of availableFeatures) {
    if (feature.properties.entityType === 'node' && feature.geometry.type === 'Point') {
      sourceNodes.set(feature.properties.entityId, { id: feature.properties.entityId, coordinates: feature.geometry.coordinates, version: feature.properties.version, tags: feature.properties.tags });
    }
  }
  for (const feature of availableFeatures) {
    for (const node of feature.properties.nodes ?? []) if (!sourceNodes.has(node.id)) sourceNodes.set(node.id, node);
  }

  const copiedNodes = new Map<string, GraphFeature>();
  const copies = new Map<string, GraphFeature>();
  const mutations: FeatureMutation[] = [];
  const copyNode = (sourceNodeId: string, coordinate: Coordinate, fallbackTags: Tags): GraphFeature => {
    const existing = copiedNodes.get(sourceNodeId);
    if (existing) return existing;
    const id = allocateNodeId();
    const node = copiedNode(id, translate(coordinate, offset), sourceNodes.get(sourceNodeId)?.tags ?? fallbackTags);
    copiedNodes.set(sourceNodeId, node);
    mutations.push({ key: `node/${id}`, feature: node });
    return node;
  };

  for (const source of sources) {
    const sourceKey = keyOf(source);
    if (copies.has(sourceKey)) continue;
    if (source.properties.entityType === 'node') {
      if (source.geometry.type !== 'Point') throw new Error('Node phải có geometry điểm.');
      copies.set(sourceKey, copyNode(source.properties.entityId, source.geometry.coordinates, source.properties.tags));
      continue;
    }
    if (source.properties.entityType !== 'way') throw new Error('Chỉ hỗ trợ nhân bản node hoặc way trong nhóm.');

    const nodeIds = source.properties.nodeIds;
    const coordinates = coordinatesOfWay(source);
    const isArea = source.geometry.type === 'Polygon';
    if (!nodeIds || nodeIds.length !== coordinates.length) throw new Error('Way có node và geometry không đồng nhất; không thể nhân bản an toàn.');
    if (isArea && (nodeIds.length < 4 || nodeIds[0] !== nodeIds.at(-1))) throw new Error('Vùng chưa khép kín; không thể nhân bản an toàn.');

    const vertexCount = isArea ? nodeIds.length - 1 : nodeIds.length;
    const vertices = Array.from({ length: vertexCount }, (_, index) => {
      const node = copyNode(nodeIds[index], coordinates[index], {});
      if (node.geometry.type !== 'Point') throw new Error('Node bản sao không hợp lệ.');
      return { nodeId: node.properties.entityId, coordinate: node.geometry.coordinates };
    });
    const id = allocateWayId();
    const feature = makeWayFeature(id, vertices, isArea ? 'area' : 'line');
    feature.properties = {
      ...feature.properties,
      name: source.properties.tags.name || '',
      tags: { ...source.properties.tags },
      nodes: feature.properties.nodes?.map((node, index) => ({ ...node, tags: { ...sourceNodes.get(nodeIds[index])?.tags } }))
    };
    copies.set(sourceKey, feature);
    mutations.push({ key: `way/${id}`, feature });
  }
  return { features: sources.flatMap(source => copies.get(keyOf(source)) ? [copies.get(keyOf(source))!] : []), copies, mutations };
}
