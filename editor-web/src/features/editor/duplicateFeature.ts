import type { Coordinate, GraphFeature, Tags, WayNode } from '../../types/osm';
import type { FeatureMutation } from './EditorStore';
import { makeNodeFeature, makeWayFeature } from './drawing';

export interface DuplicateFeatureResult {
  feature: GraphFeature;
  mutations: FeatureMutation[];
}

function copiedNode(id: string, coordinate: Coordinate, tags: Tags): GraphFeature {
  const node = makeNodeFeature(id, [...coordinate] as Coordinate);
  node.properties = {
    ...node.properties,
    name: tags.name || '',
    tags: { ...tags },
    topologyNode: true
  };
  return node;
}

function wayCoordinates(feature: GraphFeature): Coordinate[] {
  if (feature.geometry.type === 'LineString') return feature.geometry.coordinates;
  if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates[0] ?? [];
  throw new Error('Chỉ có thể nhân bản node hoặc way.');
}

/**
 * Duplicate editable geometry without sharing topology with its source.
 * A copied way gets fresh node entities, including a shared closing node for
 * polygons, so moving its vertices cannot alter the original way.
 */
export function duplicateFeature(
  source: GraphFeature,
  features: GraphFeature[],
  allocateNodeId: () => string,
  allocateWayId: () => string
): DuplicateFeatureResult {
  if (source.properties.entityType === 'node') {
    if (source.geometry.type !== 'Point') throw new Error('Node phải có geometry điểm.');
    const id = allocateNodeId();
    const feature = copiedNode(id, source.geometry.coordinates, source.properties.tags);
    return { feature, mutations: [{ key: `node/${id}`, feature }] };
  }

  if (source.properties.entityType !== 'way') throw new Error('Chưa hỗ trợ nhân bản quan hệ.');

  const nodeIds = source.properties.nodeIds;
  const coordinates = wayCoordinates(source);
  const isArea = source.geometry.type === 'Polygon';
  if (!nodeIds || nodeIds.length !== coordinates.length) {
    throw new Error('Way có node và geometry không đồng nhất; không thể nhân bản an toàn.');
  }
  if (isArea && (nodeIds.length < 4 || nodeIds[0] !== nodeIds.at(-1))) {
    throw new Error('Vùng chưa khép kín; không thể nhân bản an toàn.');
  }

  const sourceNodes = new Map<string, WayNode>();
  for (const feature of features) {
    if (feature.properties.entityType === 'node' && feature.geometry.type === 'Point') {
      sourceNodes.set(feature.properties.entityId, {
        id: feature.properties.entityId,
        coordinates: feature.geometry.coordinates,
        version: feature.properties.version,
        tags: feature.properties.tags
      });
    }
  }
  for (const node of source.properties.nodes ?? []) sourceNodes.set(node.id, node);

  const vertexCount = isArea ? nodeIds.length - 1 : nodeIds.length;
  const copiedNodeIds = new Map<string, string>();
  const mutations: FeatureMutation[] = [];
  const vertices = Array.from({ length: vertexCount }, (_, index) => {
    const sourceNodeId = nodeIds[index];
    const existingCopyId = copiedNodeIds.get(sourceNodeId);
    if (existingCopyId) return { nodeId: existingCopyId, coordinate: [...coordinates[index]] as Coordinate };

    const id = allocateNodeId();
    const sourceNode = sourceNodes.get(sourceNodeId);
    const coordinate = [...coordinates[index]] as Coordinate;
    const node = copiedNode(id, coordinate, sourceNode?.tags ?? {});
    copiedNodeIds.set(sourceNodeId, id);
    mutations.push({ key: `node/${id}`, feature: node });
    return { nodeId: id, coordinate };
  });

  const id = allocateWayId();
  const feature = makeWayFeature(id, vertices, isArea ? 'area' : 'line');
  feature.properties = {
    ...feature.properties,
    name: source.properties.tags.name || '',
    tags: { ...source.properties.tags },
    nodes: feature.properties.nodes?.map((node, index) => ({ ...node, tags: { ...sourceNodes.get(nodeIds[index])?.tags } }))
  };
  mutations.push({ key: `way/${id}`, feature });
  return { feature, mutations };
}
