import type { Feature, FeatureCollection } from 'geojson';
import type { FilterSpecification } from 'maplibre-gl';
import type { GraphFeature } from '../../types/osm';
import { resolveFeatureStyle, resolvePointIcon } from './styleRules';

// Topology/tags stay in EditorStore. Sending duplicate node metadata and full
// relation members into the map worker increases serialization and tile costs.
export function renderFeature(feature: GraphFeature): Feature {
  const { entityType, entityId, name, topologyNode } = feature.properties;
  const style = resolveFeatureStyle(feature);
  return {
    type: 'Feature', id: `${entityType}/${entityId}`, geometry: feature.geometry,
    properties: {
      entityType, entityId, ...(name ? { name } : {}), ...(topologyNode ? { topologyNode } : {}),
      editorColor: style.color, editorWidth: style.width,
      ...(entityType === 'node' && feature.geometry.type === 'Point' ? { pointIcon: resolvePointIcon(feature.properties.tags) } : {})
    }
  };
}

export function renderCollection(features: GraphFeature[]): FeatureCollection {
  return { type: 'FeatureCollection', features: features.map(renderFeature) };
}

interface TileMap {
  getLayer: (id: string) => unknown;
  setFilter: (id: string, filter: FilterSpecification) => unknown;
}

// Keep the previous tile coverage until the latest GeoJSON source's visible
// tiles are ready. Dirty/deleted entities must always suppress stale MVT data.
export class GraphTileHandoff {
  private revision = 0;
  private ready: GraphFeature[] = [];
  private pending: GraphFeature[] | null = null;
  private changedKeys: ReadonlySet<string> = new Set();
  private filters = new Map<string, string>();

  constructor(private map: TileMap) {}

  get waiting() { return this.pending !== null; }

  begin(changedKeys: ReadonlySet<string>) {
    this.pending = null;
    this.changedKeys = changedKeys;
    this.sync();
    return ++this.revision;
  }

  settled(revision: number, features: GraphFeature[]) {
    if (revision === this.revision) this.pending = features;
  }

  rendered(sourceLoaded: boolean) {
    if (!sourceLoaded || !this.pending) return;
    this.ready = this.pending;
    this.pending = null;
    this.sync();
  }

  sync() {
    const ids = { way: new Set<string>(), node: new Set<string>() };
    for (const feature of this.ready) {
      const { entityType, entityId } = feature.properties;
      if (entityType !== 'relation') ids[entityType].add(entityId);
    }
    for (const key of this.changedKeys) {
      const [type, id] = key.split('/');
      if (type === 'way' || type === 'node') ids[type].add(id);
    }
    for (const [type, layer] of [['way', 'mvt-way-line'], ['way', 'mvt-label'], ['node', 'mvt-point']] as const) {
      if (!this.map.getLayer(layer)) continue;
      // MVT implementations can encode OSM IDs as either numbers or strings.
      const excluded = [...ids[type]].sort();
      const signature = JSON.stringify(excluded);
      if (this.filters.get(layer) === signature) continue;
      const filter: FilterSpecification = ['!', ['in', ['to-string', ['get', 'entity_id']], ['literal', excluded]]];
      this.map.setFilter(layer, layer === 'mvt-label' ? ['all', ['has', 'name'], filter] : filter);
      this.filters.set(layer, signature);
    }
  }
}
