export type EntityId = string;
export type Coordinate = readonly [number, number];

export interface TopologyNode {
  id: EntityId;
  coordinate: Coordinate;
}

export interface TopologyWay {
  id: EntityId;
  nodeRefs: EntityId[];
  tags: Record<string, string>;
}

export interface SegmentHit {
  wayId: EntityId;
  segmentIndex: number;
  coordinate: Coordinate;
  distanceSquared: number;
}

export interface TopologyGraph {
  nodes: ReadonlyMap<EntityId, TopologyNode>;
  ways: ReadonlyMap<EntityId, TopologyWay>;
}

export function projectToSegment(point: Coordinate, start: Coordinate, end: Coordinate): Coordinate {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return start;
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return [start[0] + ratio * dx, start[1] + ratio * dy];
}

export function squaredDistance(a: Coordinate, b: Coordinate): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

export function findNearestNode(graph: TopologyGraph, point: Coordinate, maxDistance: number): TopologyNode | undefined {
  const maximum = maxDistance ** 2;
  let nearest: TopologyNode | undefined;
  let nearestDistance = maximum;
  for (const node of graph.nodes.values()) {
    const distance = squaredDistance(point, node.coordinate);
    if (distance >= nearestDistance) continue;
    nearest = node;
    nearestDistance = distance;
  }
  return nearest;
}

export function findNearestSegment(graph: TopologyGraph, point: Coordinate, maxDistance: number): SegmentHit | undefined {
  const maximum = maxDistance ** 2;
  let nearest: SegmentHit | undefined;
  for (const way of graph.ways.values()) {
    for (let index = 0; index < way.nodeRefs.length - 1; index += 1) {
      const start = graph.nodes.get(way.nodeRefs[index])?.coordinate;
      const end = graph.nodes.get(way.nodeRefs[index + 1])?.coordinate;
      if (!start || !end) continue;
      const coordinate = projectToSegment(point, start, end);
      const distanceSquared = squaredDistance(point, coordinate);
      if (distanceSquared > maximum || (nearest && distanceSquared >= nearest.distanceSquared)) continue;
      nearest = { wayId: way.id, segmentIndex: index, coordinate, distanceSquared };
    }
  }
  return nearest;
}

export function insertNodeIntoWay(way: TopologyWay, nodeId: EntityId, segmentIndex: number): TopologyWay {
  if (segmentIndex < 0 || segmentIndex >= way.nodeRefs.length - 1) throw new Error('Segment index is outside the way.');
  if (way.nodeRefs[segmentIndex] === nodeId || way.nodeRefs[segmentIndex + 1] === nodeId) return way;
  const nodeRefs = [...way.nodeRefs];
  nodeRefs.splice(segmentIndex + 1, 0, nodeId);
  return { ...way, nodeRefs };
}

export function splitWayAtNode(way: TopologyWay, nodeId: EntityId, firstWayId: EntityId, secondWayId: EntityId): [TopologyWay, TopologyWay] {
  const splitIndex = way.nodeRefs.indexOf(nodeId);
  if (splitIndex <= 0 || splitIndex >= way.nodeRefs.length - 1) throw new Error('A way can only split at an interior node.');
  return [
    { ...way, id: firstWayId, nodeRefs: way.nodeRefs.slice(0, splitIndex + 1), tags: { ...way.tags } },
    { ...way, id: secondWayId, nodeRefs: way.nodeRefs.slice(splitIndex), tags: { ...way.tags } }
  ];
}
