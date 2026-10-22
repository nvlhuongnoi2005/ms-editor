import { findNearestNode, findNearestSegment, insertNodeIntoWay } from '../topology/graph';
import type { SegmentHit, TopologyGraph, TopologyNode, TopologyWay } from '../topology/graph';
import type { Coordinate, GraphFeature, WayNode } from '../../types/osm';

export type DrawMode = 'select' | 'point' | 'line' | 'area';

export interface SnappedVertex {
  coordinate: Coordinate;
  nodeId?: string;
  segment?: SegmentHit;
}

function coordinatesOf(feature: GraphFeature): Coordinate[] {
  if (feature.geometry.type === 'Point') return [feature.geometry.coordinates];
  if (feature.geometry.type === 'LineString') return feature.geometry.coordinates;
  if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates[0] ?? [];
  return [];
}

export function buildTopologyGraph(features: GraphFeature[]): TopologyGraph {
  const nodes = new Map<string, TopologyNode>();
  const ways = new Map<string, TopologyWay>();
  for (const feature of features) {
    const { entityId, entityType } = feature.properties;
    if (entityType === 'node' && feature.geometry.type === 'Point') nodes.set(entityId, { id: entityId, coordinate: feature.geometry.coordinates });
    if (entityType !== 'way') continue;
    const coordinates = coordinatesOf(feature);
    const nodeIds = feature.properties.nodeIds;
    if (!nodeIds || nodeIds.length !== coordinates.length || nodeIds.length < 2) continue;
    ways.set(entityId, { id: entityId, nodeRefs: [...nodeIds], tags: { ...feature.properties.tags } });
    nodeIds.forEach((nodeId, index) => nodes.set(nodeId, { id: nodeId, coordinate: coordinates[index] }));
  }
  return { nodes, ways };
}

export function snapCoordinate(graph: TopologyGraph, coordinate: Coordinate, maxDistance: number): SnappedVertex {
  const nearestNode = findNearestNode(graph, coordinate, maxDistance);
  if (nearestNode) return { coordinate: [nearestNode.coordinate[0], nearestNode.coordinate[1]], nodeId: nearestNode.id };
  const segment = findNearestSegment(graph, coordinate, maxDistance);
  return segment ? { coordinate: [segment.coordinate[0], segment.coordinate[1]], segment } : { coordinate };
}

export function makeNodeFeature(id: string, coordinate: Coordinate): GraphFeature {
  return {
    type: 'Feature',
    id: `node-${id}`,
    properties: { entityType: 'node', entityId: id, version: 0, name: '', tags: {}, coordinates: coordinate },
    geometry: { type: 'Point', coordinates: coordinate }
  };
}

export function makeWayFeature(id: string, vertices: Array<Required<Pick<SnappedVertex, 'nodeId' | 'coordinate'>>>, mode: Extract<DrawMode, 'line' | 'area'>): GraphFeature {
  const closed = mode === 'area';
  const nodeIds = vertices.map(vertex => vertex.nodeId);
  const nodes: WayNode[] = vertices.map(vertex => ({ id: vertex.nodeId, coordinates: vertex.coordinate }));
  const coordinates = vertices.map(vertex => vertex.coordinate);
  if (closed) {
    nodeIds.push(nodeIds[0]);
    nodes.push({ id: nodes[0].id, coordinates: nodes[0].coordinates });
    coordinates.push(coordinates[0]);
  }
  return {
    type: 'Feature',
    id: `way-${id}`,
    properties: {
      entityType: 'way', entityId: id, version: 0, name: '',
      tags: closed ? { area: 'yes' } : { highway: 'unclassified' },
      nodeIds,
      nodes
    },
    geometry: closed ? { type: 'Polygon', coordinates: [coordinates] } : { type: 'LineString', coordinates }
  };
}

export function insertNodeIntoFeature(wayFeature: GraphFeature, nodeId: string, coordinate: Coordinate, segmentIndex: number): GraphFeature {
  if (wayFeature.properties.entityType !== 'way') throw new Error('Only ways can accept a topology node.');
  const refs = wayFeature.properties.nodeIds;
  const coordinates = coordinatesOf(wayFeature);
  if (!refs || refs.length !== coordinates.length) throw new Error('Way geometry and node references are inconsistent.');
  const updatedWay = insertNodeIntoWay({ id: wayFeature.properties.entityId, nodeRefs: refs, tags: wayFeature.properties.tags }, nodeId, segmentIndex);
  const nextCoordinates = [...coordinates];
  nextCoordinates.splice(segmentIndex + 1, 0, coordinate);
  const nextNodes = [...(wayFeature.properties.nodes ?? refs.map((id, index) => ({ id, coordinates: coordinates[index] })))];
  nextNodes.splice(segmentIndex + 1, 0, { id: nodeId, coordinates: coordinate });
  const properties = { ...wayFeature.properties, nodeIds: updatedWay.nodeRefs, nodes: nextNodes };
  const geometry: GraphFeature['geometry'] = wayFeature.geometry.type === 'Polygon'
    ? { type: 'Polygon', coordinates: [nextCoordinates] }
    : { type: 'LineString', coordinates: nextCoordinates };
  return { ...wayFeature, properties, geometry };
}
