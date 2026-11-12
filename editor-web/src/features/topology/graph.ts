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

interface Box<T> { west: number; south: number; east: number; north: number; value: T; order: number }
interface Tree<T> { west: number; south: number; east: number; north: number; items?: Box<T>[]; left?: Tree<T>; right?: Tree<T> }
interface Segment { wayId: string; segmentIndex: number; start: Coordinate; end: Coordinate }
function tree<T>(items: Box<T>[], depth = 0): Tree<T> | undefined {
  if (!items.length) return;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const item of items) { west = Math.min(west, item.west); south = Math.min(south, item.south); east = Math.max(east, item.east); north = Math.max(north, item.north); }
  if (items.length <= 16) return { west, south, east, north, items };
  items.sort(depth % 2 ? (a, b) => a.south + a.north - b.south - b.north : (a, b) => a.west + a.east - b.west - b.east);
  const middle = items.length >> 1;
  return { west, south, east, north, left: tree(items.slice(0, middle), depth + 1), right: tree(items.slice(middle), depth + 1) };
}
function nearby<T>(root: Tree<T> | undefined, point: Coordinate, radius: number, visit: (item: Box<T>) => void) {
  if (!root || root.east < point[0] - radius || root.west > point[0] + radius || root.north < point[1] - radius || root.south > point[1] + radius) return;
  if (root.items) for (const item of root.items) {
    if (item.east >= point[0] - radius && item.west <= point[0] + radius && item.north >= point[1] - radius && item.south <= point[1] + radius) visit(item);
  } else { nearby(root.left, point, radius, visit); nearby(root.right, point, radius, visit); }
}
const indexes = new WeakMap<TopologyGraph, { nodes?: Tree<TopologyNode>; segments?: Tree<Segment> }>();
// Topology graphs are immutable snapshots. Build once, release with the graph.
export function prepareTopologyGraph(graph: TopologyGraph): TopologyGraph {
  if (indexes.has(graph)) return graph;
  const nodes = [...graph.nodes.values()].map((node, order) => ({ west: node.coordinate[0], south: node.coordinate[1], east: node.coordinate[0], north: node.coordinate[1], value: node, order }));
  const segments: Box<Segment>[] = [];
  for (const way of graph.ways.values()) for (let index = 0; index < way.nodeRefs.length - 1; index++) {
    const start = graph.nodes.get(way.nodeRefs[index])?.coordinate, end = graph.nodes.get(way.nodeRefs[index + 1])?.coordinate;
    if (start && end) segments.push({ west: Math.min(start[0], end[0]), south: Math.min(start[1], end[1]), east: Math.max(start[0], end[0]), north: Math.max(start[1], end[1]), value: { wayId: way.id, segmentIndex: index, start, end }, order: segments.length });
  }
  indexes.set(graph, { nodes: tree(nodes), segments: tree(segments) });
  return graph;
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
  if (maxDistance < 0 || Number.isNaN(maxDistance)) return;
  prepareTopologyGraph(graph);
  const maximum = maxDistance ** 2;
  let nearest: TopologyNode | undefined;
  let nearestDistance = maximum;
  let nearestOrder = Infinity;
  nearby(indexes.get(graph)!.nodes, point, maxDistance, item => {
    const node = item.value;
    const distance = squaredDistance(point, node.coordinate);
    if (distance >= maximum || distance > nearestDistance || (distance === nearestDistance && item.order >= nearestOrder)) return;
    nearest = node;
    nearestDistance = distance;
    nearestOrder = item.order;
  });
  return nearest;
}

export function findNearestSegment(graph: TopologyGraph, point: Coordinate, maxDistance: number): SegmentHit | undefined {
  if (maxDistance < 0 || Number.isNaN(maxDistance)) return;
  prepareTopologyGraph(graph);
  const maximum = maxDistance ** 2;
  let nearest: SegmentHit | undefined;
  let nearestOrder = Infinity;
  nearby(indexes.get(graph)!.segments, point, maxDistance, item => {
      const { start, end, wayId, segmentIndex } = item.value;
      const coordinate = projectToSegment(point, start, end);
      const distanceSquared = squaredDistance(point, coordinate);
      if (distanceSquared > maximum || (nearest && (distanceSquared > nearest.distanceSquared || distanceSquared === nearest.distanceSquared && item.order >= nearestOrder))) return;
      nearest = { wayId, segmentIndex, coordinate, distanceSquared };
      nearestOrder = item.order;
  });
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
