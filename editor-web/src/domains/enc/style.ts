import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';

export type EncTheme = 'day' | 'dusk' | 'night';
// Njord palette tokens; style rules here are a deliberately limited ENC viewer
// profile, rather than a full implementation of the S-52 Presentation Library.
const palettes = {
  day: { background: '#93AEBB', land: '#BFBE8F', coast: '#4C5B63', deep: '#C9EDFF', medium: '#A7D9FB', shallow: '#82CAFF', veryShallow: '#61B7FF', tidal: '#58AF9C', ink: '#000000', magenta: '#C045D1' },
  dusk: { background: '#404D53', land: '#40402E', coast: '#6B7F89', deep: '#000000', medium: '#0F1B21', shallow: '#1D3246', veryShallow: '#1E4165', tidal: '#234C44', ink: '#8CA6B3', magenta: '#826CA1' },
  night: { background: '#171E21', land: '#17160E', coast: '#252D31', deep: '#000000', medium: '#03070A', shallow: '#050E16', veryShallow: '#071727', tidal: '#0B201C', ink: '#364147', magenta: '#411247' }
};

export function localEncStyle(dataset: string, cell: string, theme: EncTheme): StyleSpecification {
  const p = palettes[theme];
  const source = { source: 'enc', 'source-layer': 'enc' };
  const classIn = (...classes: string[]): ExpressionSpecification => ['in', ['get', 'object_class'], ['literal', classes]];
  const depth: ExpressionSpecification = ['to-number', ['get', 'DRVAL1'], -1];
  const depthFill: ExpressionSpecification = ['case', ['<', depth, 0], p.tidal, ['<', depth, 3], p.veryShallow, ['<', depth, 6], p.shallow, ['<', depth, 9], p.medium, p.deep];
  const params = new URLSearchParams({ dataset, portrayal: '3', ...(cell ? { cell } : {}) });
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
      { id: 'enc-coverage-fill', source: 'enc', 'source-layer': 'coverage', type: 'fill', maxzoom: 9, paint: { 'fill-color': '#607681', 'fill-opacity': 0.35 } },
      { id: 'enc-coverage-area-fill', source: 'enc', 'source-layer': 'coverage_areas', type: 'fill', maxzoom: 9, paint: { 'fill-color': '#805025', 'fill-opacity': 0.35 } },
      { id: 'enc-coverage-area-outline', source: 'enc', 'source-layer': 'coverage_areas', type: 'line', maxzoom: 9, paint: { 'line-color': '#633918', 'line-width': 1 } },
      { id: 'enc-coverage', source: 'enc', 'source-layer': 'coverage', type: 'line', maxzoom: 9, paint: { 'line-color': '#f28b30', 'line-width': 1.2 } },
      { ...source, id: 'enc-depth', type: 'fill', filter: classIn('DEPARE', 'DRGARE'), paint: { 'fill-color': depthFill } },
      { ...source, id: 'enc-land', type: 'fill', filter: classIn('LNDARE', 'SLCONS', 'BUAARE', 'PONTON'), paint: { 'fill-color': p.land } },
      { ...source, id: 'enc-coast', type: 'line', filter: classIn('COALNE', 'SLCONS', 'LNDARE'), paint: { 'line-color': p.coast, 'line-width': 1.25 } },
      { ...source, id: 'enc-contours', type: 'line', filter: classIn('DEPCNT'), paint: { 'line-color': p.coast, 'line-width': 0.7 } },
      { ...source, id: 'enc-waterways', type: 'line', filter: classIn('NAVLNE', 'RECTRC', 'FAIRWY'), paint: { 'line-color': p.magenta, 'line-width': 1, 'line-dasharray': [4, 2] } },
      { ...source, id: 'enc-restrictions', type: 'line', filter: classIn('RESARE', 'ACHARE', 'CBLARE', 'PIPARE', 'TSSBND', 'TSSLPT', 'TSEZNE'), paint: { 'line-color': p.magenta, 'line-width': 1, 'line-dasharray': [3, 2] } },
      { ...source, id: 'enc-hazards', type: 'circle', filter: ['all', ['==', ['geometry-type'], 'Point'], classIn('OBSTRN', 'WRECKS', 'UWTROC')], paint: { 'circle-color': p.ink, 'circle-radius': 2.5, 'circle-stroke-color': p.deep, 'circle-stroke-width': 1 } },
      { ...source, id: 'enc-aids', type: 'symbol', filter: classIn('BOYLAT', 'BOYCAR', 'BOYISD', 'BOYSAW', 'BOYSPP', 'BCNLAT', 'BCNCAR', 'BCNSPP', 'LIGHTS'), layout: {
        'icon-image': ['match', ['get', 'object_class'], 'BOYLAT', ['case', ['==', ['get', 'colour_code'], '3'], 'BOYLAT14', 'BOYLAT13'], 'BOYCAR', 'BOYCAR01', 'BOYISD', 'BOYISD12', 'BOYSAW', 'BOYSAW12', 'BOYSPP', 'BOYSPP11', 'BCNLAT', 'BCNLAT15', 'BCNCAR', 'BCNCAR01', 'BCNSPP', 'BCNSPP13', 'LIGHTS', 'LIGHTS13', 'BOYDEF03'],
        'icon-allow-overlap': true, 'icon-anchor': 'bottom', 'icon-size': 0.9
      } },
      { ...source, id: 'enc-soundings', type: 'symbol', minzoom: 13, filter: classIn('SOUNDG'), layout: { 'text-field': ['to-string', ['get', 'DEPTH']], 'text-font': ['Roboto Bold'], 'text-size': 11, 'text-padding': 8 }, paint: { 'text-color': p.ink, 'text-halo-color': p.deep, 'text-halo-width': 1 } },
      { ...source, id: 'enc-names', type: 'symbol', minzoom: 12, filter: ['all', ['has', 'OBJNAM'], classIn('LNDARE', 'LNDRGN', 'BOYLAT', 'BOYSPP', 'BCNLAT', 'LIGHTS', 'BUAARE')], layout: { 'text-field': ['get', 'OBJNAM'], 'text-font': ['Roboto Bold'], 'text-size': 12, 'text-anchor': 'top-left', 'text-offset': [0.7, 0.7], 'text-max-width': 10 }, paint: { 'text-color': p.ink, 'text-halo-color': p.deep, 'text-halo-width': 1.5 } }
    ]
  };
  style.sources.world = { type: 'vector', tiles: [`${window.location.origin}/enc/basemap/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 7, attribution: 'World baselayer · Viettel HighTech' };
  for (const layer of style.layers) {
    if ('source-layer' in layer && layer['source-layer'] === 'enc') {
      layer.minzoom = Math.max(layer.minzoom ?? 0, layer.id === 'enc-aids' ? 12 : 9);
    }
  }
  if (!dataset) {
    delete style.sources.enc;
    style.layers = style.layers.filter(layer => !('source' in layer) || layer.source !== 'enc');
  }
  return style;
}
