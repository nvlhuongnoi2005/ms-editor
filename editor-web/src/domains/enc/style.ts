import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import { encSpriteLayers, encPatternLayers, safetyContour } from './sprites';

export type EncTheme = 'day' | 'dusk' | 'night';
// Njord palette tokens; style rules here are a deliberately limited ENC viewer
// profile, rather than a full implementation of the S-52 Presentation Library.
const palettes = {
  day: { background: '#93AEBB', land: '#BFBE8F', coast: '#4C5B63', deep: '#C9EDFF', medium: '#A7D9FB', shallow: '#82CAFF', veryShallow: '#61B7FF', tidal: '#58AF9C', ink: '#000000', magenta: '#C045D1' },
  dusk: { background: '#404D53', land: '#40402E', coast: '#6B7F89', deep: '#000000', medium: '#0F1B21', shallow: '#1D3246', veryShallow: '#1E4165', tidal: '#234C44', ink: '#B2C7D1', magenta: '#826CA1' },
  night: { background: '#171E21', land: '#17160E', coast: '#252D31', deep: '#000000', medium: '#03070A', shallow: '#050E16', veryShallow: '#071727', tidal: '#0B201C', ink: '#B8C3CC', magenta: '#411247' }
};

export function localEncStyle(dataset: string, cell: string, theme: EncTheme, catalogRevision = 0, basemapOnly = false): StyleSpecification {
  const p = palettes[theme];
  const source = { source: 'enc', 'source-layer': 'enc' };
  const classIn = (...classes: string[]): ExpressionSpecification => ['in', ['get', 'object_class'], ['literal', classes]];
  const depth: ExpressionSpecification = ['to-number', ['coalesce', ['get', 'DRVAL1'], 999999], 999999];
  const depthFill: ExpressionSpecification = ['case', ['<', depth, 0], p.tidal, ['<', depth, 3], p.veryShallow, ['<', depth, safetyContour], p.shallow, ['<', depth, 9], p.medium, p.deep];
  const params = new URLSearchParams({ ...(dataset ? { dataset } : {}), portrayal: '10', revision: String(catalogRevision), ...(cell ? { cell } : {}) });
  const style: StyleSpecification = {
    version: 8,
    glyphs: `${window.location.origin}/enc/assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${window.location.origin}/enc/assets/sprites/${theme}_simplified`,
    sources: { enc: { type: 'vector', tiles: [`${window.location.origin}/api/enc/tiles/{z}/{x}/{y}.pbf?${params}`], minzoom: 0, maxzoom: 22, promoteId: 'feature_id', attribution: 'NOAA ENC · Njord palette / sprites · local S-57 import' } },
    layers: [
      { id: 'enc-background', type: 'background', paint: { 'background-color': theme === 'day' ? p.deep : p.background } },
      { id: 'world-land', source: 'world', 'source-layer': 'HANHCHINH_THEGIOI', type: 'fill', paint: { 'fill-color': p.land } },
      { id: 'world-boundaries', source: 'world', 'source-layer': 'HANHCHINH_THEGIOI', type: 'line', paint: { 'line-color': p.coast, 'line-width': 0.7 } },
      { id: 'world-labels', source: 'world', 'source-layer': 'DIADANH_HANHCHINH_THEGIOI', type: 'symbol', minzoom: 9, maxzoom: 12, layout: { 'text-field': ['get', 'name'], 'text-font': ['Roboto Bold'], 'text-size': 11 }, paint: { 'text-color': p.ink, 'text-halo-color': p.land, 'text-halo-width': 1 } },
      { id: 'region-fill', source: 'regions', type: 'fill', maxzoom: 9, filter: ['==', ['get', 'kind'], 'region'], paint: { 'fill-color': '#607681', 'fill-opacity': 0.16 } },
      { id: 'region-outline', source: 'regions', type: 'line', maxzoom: 9, filter: ['==', ['get', 'kind'], 'region'], paint: { 'line-color': p.coast, 'line-width': 1 } },
      { id: 'enc-coverage-fill', source: 'enc', 'source-layer': 'coverage', type: 'fill', maxzoom: 9, paint: { 'fill-color': '#607681', 'fill-opacity': 0.16 } },
      { id: 'enc-coverage-area-fill', source: 'enc', 'source-layer': 'coverage_areas', type: 'fill', maxzoom: 9, paint: { 'fill-color': '#805025', 'fill-opacity': 0.16 } },
      { id: 'enc-coverage-area-outline', source: 'enc', 'source-layer': 'coverage_areas', type: 'line', maxzoom: 9, paint: { 'line-color': '#633918', 'line-width': 1 } },
      { id: 'enc-coverage', source: 'enc', 'source-layer': 'coverage', type: 'line', maxzoom: 14, paint: { 'line-color': '#f28b30', 'line-width': 1.2, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 10, 0.3, 14, 0] } },
      { id: 'region-labels', source: 'regions', type: 'symbol', minzoom: 1, maxzoom: 9, filter: ['==', ['get', 'kind'], 'label'], layout: {
        'text-field': ['format', ['get', 'description'], { 'font-scale': 1 }, '\n', {}, ['get', 'name'], { 'font-scale': 0.85 }],
        'text-font': ['Roboto Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 12, 9, 14], 'text-max-width': 18, 'text-padding': 16,
        'symbol-sort-key': ['to-number', ['get', 'compilationScale'], 99999999]
      }, paint: { 'text-color': p.ink, 'text-halo-color': theme === 'day' ? '#ffffff' : p.background, 'text-halo-width': 2 } },
      { ...source, id: 'enc-depth', type: 'fill', filter: classIn('DEPARE', 'DRGARE'), paint: { 'fill-color': depthFill } },
      { ...source, id: 'enc-land', type: 'fill', filter: classIn('LNDARE', 'SLCONS', 'BUAARE', 'PONTON'), paint: { 'fill-color': p.land } },
      { ...source, id: 'enc-structure-fill', type: 'fill', filter: classIn('BUISGL', 'LNDMRK', 'SILTNK', 'SMCFAC', 'FORSTC'), paint: { 'fill-color': p.land } },
      { ...source, id: 'enc-structure-outline', type: 'line', filter: classIn('BUISGL', 'LNDMRK', 'SILTNK', 'SMCFAC', 'FORSTC', 'BRIDGE'), paint: { 'line-color': ['case', ['==', ['to-number', ['get', 'sym_CONVIS'], -1], 1], p.ink, p.coast], 'line-width': 1 } },
      { ...source, id: 'enc-coast', type: 'line', filter: classIn('COALNE', 'SLCONS', 'LNDARE'), paint: { 'line-color': p.coast, 'line-width': 1.25 } },
      { ...source, id: 'enc-contours', type: 'line', filter: classIn('DEPCNT'), paint: { 'line-color': p.coast, 'line-width': 0.7 } },
      { ...source, id: 'enc-waterways', type: 'line', filter: classIn('NAVLNE', 'RECTRC', 'FAIRWY'), paint: { 'line-color': p.magenta, 'line-width': 1, 'line-dasharray': [4, 2] } },
      { ...source, id: 'enc-restrictions', type: 'line', filter: classIn('RESARE', 'ACHARE', 'CBLARE', 'PIPARE', 'TSSBND', 'TSSLPT', 'TSEZNE'), paint: { 'line-color': p.magenta, 'line-width': 1, 'line-dasharray': [3, 2] } },
      { ...source, id: 'enc-soundings', type: 'symbol', minzoom: 9, filter: ['all', classIn('SOUNDG'), ['has', 'DEPTH'], ['>=', ['to-number', ['get', 'DEPTH'], 0], 0]], layout: { 'text-field': ['to-string', ['/', ['round', ['*', ['to-number', ['get', 'DEPTH']], 10]], 10]], 'text-font': ['Roboto Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 13, 13, 14, 17, 15], 'text-padding': 4, 'text-allow-overlap': false, 'symbol-sort-key': ['to-number', ['get', 'DEPTH'], 99999] }, paint: { 'text-color': p.ink, 'text-halo-color': p.deep, 'text-halo-width': 1.5 } },
      { ...source, id: 'enc-soundings-drying', type: 'symbol', minzoom: 9, filter: ['all', classIn('SOUNDG'), ['<', ['to-number', ['get', 'DEPTH'], 0], 0]], layout: { 'text-field': ['to-string', ['abs', ['/', ['round', ['*', ['to-number', ['get', 'DEPTH']], 10]], 10]]], 'text-font': ['Roboto Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 13, 13, 14, 17, 15], 'text-padding': 4, 'icon-image': 'SOUNDSA1', 'icon-text-fit': 'both', 'symbol-sort-key': ['to-number', ['get', 'DEPTH'], 99999] }, paint: { 'text-color': p.ink, 'text-halo-color': p.tidal, 'text-halo-width': 1 } },
      { ...source, id: 'enc-contour-labels', type: 'symbol', minzoom: 10, filter: ['all', classIn('DEPCNT'), ['has', 'VALDCO']], layout: { 'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': ['concat', ['to-string', ['get', 'VALDCO']], ' m'], 'text-font': ['Roboto Bold'], 'text-size': 11, 'text-padding': 12 }, paint: { 'text-color': p.coast, 'text-halo-color': p.deep, 'text-halo-width': 1.5 } },
      { ...source, id: 'enc-names', type: 'symbol', minzoom: 10, filter: ['all', ['has', 'OBJNAM'], ['!=', ['get', 'OBJNAM'], ''], classIn('LNDARE', 'LNDRGN', 'BOYLAT', 'BOYCAR', 'BOYISD', 'BOYSAW', 'BOYSPP', 'BCNLAT', 'BCNCAR', 'BCNSPP', 'LIGHTS', 'BUAARE')], layout: { 'text-field': ['get', 'OBJNAM'], 'text-font': ['Roboto Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 13], 'text-variable-anchor': ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'text-radial-offset': 1.1, 'text-padding': 6, 'text-max-width': 12, 'text-justify': 'auto', 'symbol-sort-key': ['case', classIn('LIGHTS','BOYLAT','BOYCAR','BOYISD','BOYSAW','BOYSPP','BCNLAT','BCNCAR','BCNSPP'), 0, 1] }, paint: { 'text-color': p.ink, 'text-halo-color': p.deep, 'text-halo-width': 1.5 } }
    ]
  };
  style.sources.world = { type: 'vector', tiles: [`${window.location.origin}/enc/basemap/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 7, attribution: 'World baselayer · Viettel HighTech' };
  style.sources.regions = { type: 'geojson', data: `${window.location.origin}/api/enc/regions?${new URLSearchParams({ ...(dataset ? { dataset } : {}), revision: String(catalogRevision), portrayal: 'local-coverage' })}` };
  const patterns = encPatternLayers();
  const landIndex = style.layers.findIndex(layer => layer.id === 'enc-land');
  style.layers.splice(landIndex + 1, 0, ...patterns.filter(layer => layer.type === 'fill'));
  style.layers.push(...patterns.filter(layer => layer.type !== 'fill'));
  // The last symbol layer reserves collision space first.
  const symbolOrder = ['enc-names', 'enc-contour-labels', 'enc-soundings', 'enc-soundings-drying'];
  const symbols = symbolOrder.flatMap(id => style.layers.filter(layer => layer.id === id));
  const spriteLayers = encSpriteLayers(p.ink, p.deep, theme);
  const supplementary = (id: string) => id.startsWith('enc-objects') || id.startsWith('enc-natural-labels') || id === 'enc-unmapped-points';
  style.layers = [...style.layers.filter(layer => !symbolOrder.includes(layer.id)),
    ...spriteLayers.filter(layer => supplementary(layer.id)), ...symbols,
    ...spriteLayers.filter(layer => !supplementary(layer.id))];
  for (const layer of style.layers) {
    if ('source-layer' in layer && layer['source-layer'] === 'enc') {
      layer.minzoom = Math.max(layer.minzoom ?? 0, 9);
    }
  }
  if (basemapOnly) {
    delete style.sources.enc;
    style.layers = style.layers.filter(layer => !('source' in layer) || layer.source !== 'enc');
  }
  return style;
}
