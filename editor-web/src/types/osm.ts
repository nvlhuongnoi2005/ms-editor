export type EntityType = 'node' | 'way' | 'relation';
export type Tags = Record<string, string>;
export type Coordinate = [number, number];

export interface PointGeometry {
  type: 'Point';
  coordinates: Coordinate;
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: Coordinate[];
}

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Coordinate[][];
}

export type GraphGeometry = PointGeometry | LineStringGeometry | PolygonGeometry;

export interface WayNode {
  id: string;
  coordinates: Coordinate;
  version?: number;
  tags?: Tags;
}

export interface GraphFeature {
  type: 'Feature';
  id?: string;
  properties: {
    entityId: string;
    entityType: EntityType;
    version: number;
    tags: Tags;
    name?: string;
    nodeIds?: string[];
    nodes?: WayNode[];
    coordinates?: Coordinate;
    editorColor?: string;
    editorWidth?: number;
    topologyNode?: boolean;
  };
  geometry: GraphGeometry;
}

export interface GraphResponse {
  canonicalRevision: number;
  features: GraphFeature[];
}

export interface SelectedEntity {
  id: string;
  type: EntityType;
  version: number;
  tags: Tags;
  geometry: GraphGeometry;
}
