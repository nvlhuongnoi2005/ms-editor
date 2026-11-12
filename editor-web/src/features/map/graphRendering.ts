import type { Feature, FeatureCollection } from 'geojson';
import type { FilterSpecification, GeoJSONSourceDiff } from 'maplibre-gl';
import type { GraphFeature, SelectedEntity } from '../../types/osm';
import { resolveFeatureStyle, resolvePointIcon } from './styleRules';
import { areaGeometry } from '../editor/geometryOperations';

export const GRAPH_MIN_ZOOM = 14;

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

export function renderCollection(features: GraphFeature[], support = features): FeatureCollection {
  const areas = new Map<string, Feature['geometry']>();
  const memberWays = new Set<string>();
  for (const feature of features) if (feature.properties.entityType === 'relation' && feature.properties.tags.type === 'multipolygon') {
    try {
      areas.set(feature.properties.entityId, { type: 'MultiPolygon', coordinates: areaGeometry(feature, support, false) });
      for (const member of feature.properties.members ?? []) if (member.type === 'way') memberWays.add(member.ref);
    } catch { /* Incomplete relations retain their anchor until support is loaded. */ }
  }
  return { type: 'FeatureCollection', features: features.map(feature => {
    const rendered = renderFeature(feature);
    const area = feature.properties.entityType === 'relation' ? areas.get(feature.properties.entityId) : undefined;
    if (area) rendered.geometry = area;
    // Untagged ring ways are topology, not filled standalone areas. In particular
    // an inner member must never paint over the hole of its owning relation.
    if (feature.properties.entityType === 'way' && memberWays.has(feature.properties.entityId) && !Object.keys(feature.properties.tags).length && feature.geometry.type === 'Polygon') rendered.geometry = { type: 'LineString', coordinates: feature.geometry.coordinates[0] };
    return rendered;
  }) };
}

// Reuse simple feature renders by immutable source identity. Multipolygon
// support can change outside the relation itself, so that path recomputes the
// collection before diffing; holes and previously suppressed rings stay correct.
export class GraphRenderDiff {
  private sources = new Map<string, GraphFeature>();
  private rendered = new Map<string, Feature>();
  private signatures = new Map<string, string>();
  private initialized = false;
  private hadMultipolygons = false;
  reset() { this.sources.clear(); this.rendered.clear(); this.signatures.clear(); this.initialized = false; this.hadMultipolygons = false; }
  next(features: GraphFeature[]): { full?: FeatureCollection; diff?: GeoJSONSourceDiff } {
    const multipolygons = features.some(item => item.properties.entityType === 'relation' && item.properties.tags.type === 'multipolygon');
    const complex = multipolygons || this.hadMultipolygons;
    const collection = complex ? renderCollection(features) : { type: 'FeatureCollection' as const, features: features.map(item => {
      const key = `${item.properties.entityType}/${item.properties.entityId}`;
      return this.sources.get(key) === item ? this.rendered.get(key)! : renderFeature(item);
    }) };
    const next = new Map<string, Feature>(), sources = new Map<string, GraphFeature>(), signatures = new Map<string, string>();
    const remove: string[] = [], add: Feature[] = [];
    collection.features.forEach((item, index) => {
      const key = String(item.id);
      const signature = this.rendered.get(key) === item ? this.signatures.get(key)! : JSON.stringify(item);
      next.set(key, item); sources.set(key, features[index]); signatures.set(key, signature);
      if (this.signatures.get(key) !== signature) {
        if (this.rendered.has(key)) remove.push(key);
        add.push(item);
      }
    });
    for (const key of this.rendered.keys()) if (!next.has(key)) remove.push(key);
    const full = !this.initialized || add.length + remove.length > Math.max(32, features.length * 0.6);
    this.sources = sources; this.rendered = next; this.signatures = signatures; this.initialized = true; this.hadMultipolygons = multipolygons;
    if (full) return { full: collection };
    return add.length || remove.length ? { diff: { remove, add } } : {};
  }
}

// Selection is independent of viewport coverage and the graph's zoom threshold.
// EditorStore owns the latest geometry, including unsaved edits.
export function selectedFeatureCollection(selected: SelectedEntity | readonly SelectedEntity[] | null, support: GraphFeature[] = []): FeatureCollection {
  const selections = Array.isArray(selected) ? selected : selected ? [selected] : [];
  return renderCollection(selections.map(feature => ({
    type: 'Feature',
    properties: {
      entityType: feature.type, entityId: feature.id, version: feature.version,
      tags: feature.tags, name: feature.tags.name, members: feature.members
    },
    geometry: feature.geometry
  })), support);
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
