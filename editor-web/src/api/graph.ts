import type { Coordinate, EntityType, GraphFeature, GraphGeometry, GraphResponse, RelationMember, RelationParent, Tags, WayNode } from '../types/osm';

export const DATASET_NAME = 'vietnam-260901';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Graph response has an invalid ${field}.`);
  return value;
}

function readOsmIdentifier(value: unknown, field: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new Error(`Graph response has an invalid ${field}.`);
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Graph response has an invalid ${field}.`);
  return value;
}

function parseCoordinate(value: unknown, field: string): Coordinate {
  if (!Array.isArray(value) || value.length < 2) throw new Error(`Graph response has an invalid ${field}.`);
  return [readNumber(value[0], `${field}[0]`), readNumber(value[1], `${field}[1]`)];
}

function parseCoordinates(value: unknown, field: string): Coordinate[] {
  if (!Array.isArray(value)) throw new Error(`Graph response has an invalid ${field}.`);
  return value.map((coordinate, index) => parseCoordinate(coordinate, `${field}[${index}]`));
}

function parseTags(value: unknown): Tags {
  if (!isRecord(value)) throw new Error('Graph response has invalid tags.');
  const tags: Tags = {};
  for (const [key, tagValue] of Object.entries(value)) tags[key] = readString(tagValue, `tag ${key}`);
  return tags;
}

function parseEntityType(value: unknown): EntityType {
  if (value === 'node' || value === 'way' || value === 'relation') return value;
  throw new Error('Graph response has an invalid entity type.');
}

function parseGeometry(value: unknown): GraphGeometry {
  if (!isRecord(value)) throw new Error('Graph response is missing geometry.');
  const type = readString(value.type, 'geometry type');
  if (type === 'Point') return { type, coordinates: parseCoordinate(value.coordinates, 'point coordinates') };
  if (type === 'LineString') return { type, coordinates: parseCoordinates(value.coordinates, 'line coordinates') };
  if (type === 'Polygon') {
    if (!Array.isArray(value.coordinates)) throw new Error('Graph response has invalid polygon coordinates.');
    return { type, coordinates: value.coordinates.map((ring, index) => parseCoordinates(ring, `polygon ring ${index}`)) };
  }
  throw new Error(`Graph response geometry ${type} is not supported.`);
}

function parseWayNodes(value: unknown): WayNode[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Graph response has invalid way nodes.');
  return value.map((node, index) => {
    if (!isRecord(node)) throw new Error(`Graph response has invalid way node ${index}.`);
    const version = node.version === undefined ? undefined : readNumber(node.version, `way node ${index} version`);
    const tags = node.tags === undefined ? undefined : parseTags(node.tags);
    return {
      id: readOsmIdentifier(node.id, `way node ${index} id`),
      coordinates: parseCoordinate(node.coordinates, `way node ${index} coordinates`),
      ...(version === undefined ? {} : { version }),
      ...(tags === undefined ? {} : { tags })
    };
  });
}

function parseNodeIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Graph response has invalid node references.');
  return value.map((nodeId, index) => readOsmIdentifier(nodeId, `node reference ${index}`));
}

function parseRelationMembers(value: unknown): RelationMember[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Graph response has invalid relation members.');
  return value.map((member, index) => {
    if (!isRecord(member)) throw new Error(`Graph response has an invalid relation member ${index}.`);
    return {
      type: parseEntityType(member.type),
      ref: readOsmIdentifier(member.ref, `relation member ${index} ref`),
      role: readString(member.role, `relation member ${index} role`),
      sequence: readNumber(member.sequence, `relation member ${index} sequence`)
    };
  });
}

function parseRelationParents(value: unknown): RelationParent[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Graph response has invalid relation parents.');
  return value.map((parent, index) => {
    if (!isRecord(parent)) throw new Error(`Graph response has an invalid relation parent ${index}.`);
    return {
      id: readOsmIdentifier(parent.id, `relation parent ${index} id`),
      version: readNumber(parent.version, `relation parent ${index} version`),
      tags: parseTags(parent.tags)
    };
  });
}

export function parseFeature(value: unknown): GraphFeature {
  if (!isRecord(value) || !isRecord(value.properties)) throw new Error('Graph response has an invalid feature.');
  const properties = value.properties;
  const nodeIds = parseNodeIds(properties.nodeIds);
  const nodes = parseWayNodes(properties.nodes);
  const members = parseRelationMembers(properties.members);
  const parents = parseRelationParents(properties.parents);
  const coordinates = properties.coordinates === undefined ? undefined : parseCoordinate(properties.coordinates, 'feature coordinates');
  return {
    type: 'Feature',
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    properties: {
      entityId: readOsmIdentifier(properties.entityId, 'entity id'),
      entityType: parseEntityType(properties.entityType),
      version: readNumber(properties.version, 'entity version'),
      tags: parseTags(properties.tags),
      ...(typeof properties.name === 'string' ? { name: properties.name } : {}),
      ...(nodeIds === undefined ? {} : { nodeIds }),
      ...(nodes === undefined ? {} : { nodes }),
      ...(members === undefined ? {} : { members }),
      ...(parents === undefined ? {} : { parents }),
      ...(coordinates === undefined ? {} : { coordinates }),
      ...(typeof properties.editorColor === 'string' ? { editorColor: properties.editorColor } : {}),
      ...(typeof properties.editorWidth === 'number' ? { editorWidth: properties.editorWidth } : {}),
      ...(typeof properties.topologyNode === 'boolean' ? { topologyNode: properties.topologyNode } : {})
    },
    geometry: parseGeometry(value.geometry)
  };
}

function parseGraphResponse(value: unknown): GraphResponse {
  if (!isRecord(value) || !Array.isArray(value.features)) throw new Error('Graph response has an invalid format.');
  return {
    canonicalRevision: readNumber(value.canonicalRevision, 'canonical revision'),
    features: value.features.map(parseFeature)
  };
}

export type GraphPart = 'all' | 'geometry' | 'relations';

export async function loadGraph(bbox: [number, number, number, number], signal?: AbortSignal, part: GraphPart = 'all'): Promise<GraphResponse> {
  const parameters = new URLSearchParams({ dataset: DATASET_NAME, bbox: bbox.join(','), limit: '1200', part });
  const response = await fetch(`/api/graph?${parameters}`, { signal });
  if (!response.ok) throw new Error(`Không thể tải graph (${response.status}).`);
  const graph = parseGraphResponse(await response.json());
  // An API process still running the previous build ignores `part`. Keep its
  // full response from duplicating entities during a rolling/local restart.
  if (part !== 'all') graph.features = graph.features.filter(feature =>
    part === 'relations' ? feature.properties.entityType === 'relation' : feature.properties.entityType !== 'relation');
  return graph;
}

export async function loadWayParents(ids: string[]): Promise<{ wayParents: Record<string, RelationParent[]>; relations: GraphFeature[] }> {
  const parameters = new URLSearchParams({ dataset: DATASET_NAME, ids: ids.join(',') });
  const response = await fetch(`/api/topology/way-parents?${parameters}`);
  if (!response.ok) throw new Error(`Không thể tải relation cha (${response.status}). Hãy kiểm tra Editor API đã được khởi động lại.`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !isRecord(payload.wayParents) || !Array.isArray(payload.relations)) throw new Error('Dữ liệu relation cha không hợp lệ.');
  const wayParents: Record<string, RelationParent[]> = {};
  for (const id of ids) {
    if (!Array.isArray(payload.wayParents[id])) throw new Error(`Thiếu dữ liệu relation cha của way ${id}.`);
    wayParents[id] = parseRelationParents(payload.wayParents[id])!;
  }
  return { wayParents, relations: payload.relations.map(parseFeature) };
}
