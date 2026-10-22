import type { Coordinate, EntityType, GraphFeature, GraphGeometry, GraphResponse, Tags, WayNode } from '../types/osm';

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

function parseFeature(value: unknown): GraphFeature {
  if (!isRecord(value) || !isRecord(value.properties)) throw new Error('Graph response has an invalid feature.');
  const properties = value.properties;
  const nodeIds = parseNodeIds(properties.nodeIds);
  const nodes = parseWayNodes(properties.nodes);
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

export async function loadGraph(bbox: [number, number, number, number], signal?: AbortSignal): Promise<GraphResponse> {
  const parameters = new URLSearchParams({ dataset: DATASET_NAME, bbox: bbox.join(','), limit: '5000' });
  const response = await fetch(`/api/graph?${parameters}`, { signal });
  if (!response.ok) throw new Error(`Không thể tải graph (${response.status}).`);
  return parseGraphResponse(await response.json());
}
