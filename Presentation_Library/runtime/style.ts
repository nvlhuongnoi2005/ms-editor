import type { ExpressionSpecification, FilterSpecification, Map, StyleSpecification } from 'maplibre-gl';
import { encSpriteLayers, encPatternLayers, safetyContour } from './sprites';
import { encInfrastructureLayers } from './infrastructure';

export type EncTheme = 'day' | 'dusk' | 'night';
export type EncDisplayCategory = 'base' | 'standard' | 'other';
// Njord palette tokens; style rules here are a deliberately limited ENC viewer
// profile, rather than a full implementation of the S-52 Presentation Library.
import palettes from './palettes.json';
import { presentationLibrary, defaultPresentationSettings, type PresentationSettings } from './profile';

function categoryFilter(base: FilterSpecification | null, category: EncDisplayCategory): FilterSpecification | null {
  if (category === 'other') return base;
  const categoryRule: ExpressionSpecification = category === 'base'
    ? ['==', ['get', 's52_display_category'], 'BASE']
    : ['in', ['get', 's52_display_category'], ['literal', ['BASE', 'STANDARD']]];
  return ['all', ...(base ? [base as ExpressionSpecification] : []), categoryRule];
}

function soundingColor(theme: EncTheme, depth: number): ExpressionSpecification {
  return ['case', ['<=', ['to-number', ['coalesce', ['get', 'DEPTH'], 999999], 999999], depth], palettes[theme].ink, palettes[theme].grey];
}

// These settings affect presentation only. Preserve sources, loaded tiles and
// the inspection panel instead of replacing the whole style on every click.
export function updateEncPresentation(map: Map, theme: EncTheme, depth: number, category: EncDisplayCategory) {
  for (const layer of map.getStyle()?.layers ?? []) {
    const metadata = layer.metadata as Record<string, unknown> | undefined;
    if (!metadata || !Object.hasOwn(metadata, 'enc:baseFilter')) continue;
    const next = categoryFilter(metadata['enc:baseFilter'] as FilterSpecification | null, category);
    if (JSON.stringify('filter' in layer ? layer.filter ?? null : null) !== JSON.stringify(next)) map.setFilter(layer.id, next);
  }
  if (map.getLayer('enc-soundings')) map.setPaintProperty('enc-soundings', 'text-color', soundingColor(theme, depth));
}

export function localEncStyle(
  dataset: string, cell: string, theme: EncTheme, catalogRevision = 0, basemapOnly = false,
  safetyContourValue = safetyContour, safetyDepthValue = 6, displayCategory: EncDisplayCategory = 'other',
  settings?: PresentationSettings,
): StyleSpecification {
  const options = { ...defaultPresentationSettings, safetyDepth: safetyDepthValue, safetyContour: safetyContourValue, category: displayCategory, ...settings };
  safetyContourValue = options.safetyContour; safetyDepthValue = options.safetyDepth; displayCategory = options.category;
  const p = palettes[theme];
  const source = { source: 'enc', 'source-layer': 'enc' };
  const classIn = (...classes: string[]): ExpressionSpecification => ['in', ['get', 'object_class'], ['literal', classes]];
  const depth: ExpressionSpecification = ['to-number', ['coalesce', ['get', 'DRVAL1'], 999999], 999999];
  const effectiveContour: ExpressionSpecification = ['to-number', ['coalesce', ['get', 's52_safety_contour'], safetyContourValue], safetyContourValue];
  const soundingTextSize = 2.5 * 96 / 25.4;
  const depthFill: ExpressionSpecification = options.shades === 2
    ? ['case', ['<', depth, 0], p.tidal, ['<', depth, effectiveContour], p.shallow, p.deep]
    : ['case', ['<', depth, 0], p.tidal, ['<', depth, options.shallowContour], p.veryShallow, ['<', depth, effectiveContour], p.shallow, ['<', depth, options.deepContour], p.medium, p.deep];
  const params = new URLSearchParams({ ...(dataset ? { dataset } : {}), portrayal: String(presentationLibrary.rendererVersion), revision: String(catalogRevision),
    safetyContour: String(safetyContourValue), safetyDepth: String(safetyDepthValue), ...(cell ? { cell } : {}) });
  const style: StyleSpecification = {
    version: 8,
    metadata: { 'presentation:library': presentationLibrary.id, 'presentation:target': presentationLibrary.target.edition, 'presentation:status': presentationLibrary.status },
    glyphs: `${window.location.origin}/enc/assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${window.location.origin}/enc/assets/sprites/${theme}_simplified?v=${presentationLibrary.assetVersion}`,
    sources: { enc: { type: 'vector', tiles: [`${window.location.origin}/api/enc/tiles/{z}/{x}/{y}.pbf?${params}`], minzoom: 0, maxzoom: 22, promoteId: 'feature_id', attribution: 'NOAA ENC · Njord palette / sprites · local S-57 import' } },
    layers: [
      { id: 'enc-background', type: 'background', paint: { 'background-color': theme === 'day' ? p.deep : p.background } },
      { id: 'world-land', source: 'world', 'source-layer': 'HANHCHINH_THEGIOI', type: 'fill', paint: { 'fill-color': p.land } },
      { id: 'world-boundaries', source: 'world', 'source-layer': 'HANHCHINH_THEGIOI', type: 'line', paint: { 'line-color': p.coast, 'line-width': 0.7 } },
      { id: 'world-labels', source: 'world', 'source-layer': 'DIADANH_HANHCHINH_THEGIOI', type: 'symbol', minzoom: 9, maxzoom: 12, layout: { 'text-field': ['get', 'name'], 'text-font': ['Roboto Bold'], 'text-size': 11 }, paint: { 'text-color': p.ink, 'text-halo-color': p.land, 'text-halo-width': 1 } },
      { id: 'region-fill', source: 'regions', type: 'fill', maxzoom: 9, filter: ['==', ['get', 'kind'], 'region'], paint: { 'fill-color': '#607681', 'fill-opacity': 0.16 } },
      { id: 'region-outline', source: 'regions', type: 'line', maxzoom: 9, filter: ['==', ['get', 'kind'], 'outline'], paint: { 'line-color': p.coast, 'line-width': 1 } },
      { id: 'enc-coverage-fill', source: 'enc', 'source-layer': 'coverage', type: 'fill', maxzoom: 9, paint: { 'fill-color': '#607681', 'fill-opacity': 0.16 } },
      { id: 'enc-coverage-area-fill', source: 'enc', 'source-layer': 'coverage_areas', type: 'fill', maxzoom: 9, paint: { 'fill-color': '#805025', 'fill-opacity': 0.16 } },
      { id: 'enc-coverage-area-outline', source: 'enc', 'source-layer': 'coverage_area_lines', type: 'line', maxzoom: 9, paint: { 'line-color': '#633918', 'line-width': 1 } },
      { id: 'enc-coverage', source: 'enc', 'source-layer': 'coverage', type: 'line', maxzoom: 14, paint: { 'line-color': '#f28b30', 'line-width': 1.2, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 10, 0.3, 14, 0] } },
      { id: 'region-labels', source: 'regions', type: 'symbol', minzoom: 1, maxzoom: 9, filter: ['==', ['get', 'kind'], 'label'], layout: {
        'text-field': ['format', ['get', 'description'], { 'font-scale': 1 }, '\n', {}, ['get', 'name'], { 'font-scale': 0.85 }],
        'text-font': ['Roboto Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 12, 9, 14], 'text-max-width': 18, 'text-padding': 16,
        'symbol-sort-key': ['to-number', ['get', 'compilationScale'], 99999999]
      }, paint: { 'text-color': p.ink, 'text-halo-color': theme === 'day' ? '#ffffff' : p.background, 'text-halo-width': 2 } },
      { ...source, id: 'enc-depth', type: 'fill', filter: classIn('DEPARE', 'DRGARE'), paint: { 'fill-color': depthFill } },
      { ...source, id: 'enc-land', type: 'fill', filter: classIn('LNDARE', 'BUAARE'), paint: { 'fill-color': p.land } },
      { ...source, id: 'enc-structure-fill', type: 'fill', filter: classIn('BUISGL', 'LNDMRK', 'SILTNK', 'SMCFAC', 'FORSTC'), paint: { 'fill-color': p.land } },
      { ...source, id: 'enc-structure-outline', type: 'line', filter: classIn('BUISGL', 'LNDMRK', 'SILTNK', 'SMCFAC', 'FORSTC', 'BRIDGE'), paint: { 'line-color': ['case', ['==', ['to-number', ['get', 'sym_CONVIS'], -1], 1], p.ink, p.coast], 'line-width': 0.3 * 96 / 25.4 } },
      { ...source, id: 'enc-coast', type: 'line', filter: classIn('COALNE', 'LNDARE'), paint: { 'line-color': p.coast, 'line-width': 0.3 * 96 / 25.4 } },
      { ...source, id: 'enc-contours', type: 'line', filter: classIn('DEPCNT'), paint: { 'line-color': p.coast, 'line-width': 0.3 * 96 / 25.4 } },
      { ...source, id: 'enc-safety-contour', type: 'line', filter: ['all', classIn('DEPCNT'), ['==', ['to-number', ['get', 'VALDCO'], -999999], effectiveContour]], paint: { 'line-color': p.ink, 'line-width': 0.6 * 96 / 25.4 } },
      { ...source, id: 'enc-waterways', type: 'line', filter: classIn('NAVLNE', 'RECTRC', 'FAIRWY'), paint: { 'line-color': p.magenta, 'line-width': 0.3 * 96 / 25.4, 'line-dasharray': [4, 2] } },
      { ...source, id: 'enc-restrictions', type: 'line', filter: classIn('RESARE', 'ACHARE', 'CBLARE', 'PIPARE', 'TSSBND', 'TSSLPT', 'TSEZNE'), paint: { 'line-color': p.magenta, 'line-width': 0.3 * 96 / 25.4, 'line-dasharray': [3, 2] } },
      { ...source, id: 'enc-soundings', type: 'symbol', minzoom: 9, filter: ['all', classIn('SOUNDG'), ['has', 'DEPTH'], ['>=', ['to-number', ['get', 'DEPTH'], 0], 0]], layout: { 'text-field': ['to-string', ['/', ['round', ['*', ['to-number', ['get', 'DEPTH']], 10]], 10]], 'text-font': ['Roboto Bold'], 'text-size': soundingTextSize, 'text-padding': 4, 'text-allow-overlap': false, 'symbol-sort-key': ['to-number', ['get', 'DEPTH'], 99999] }, paint: { 'text-color': soundingColor(theme, safetyDepthValue), 'text-halo-color': p.deep, 'text-halo-width': 1.5 } },
      { ...source, id: 'enc-soundings-drying', type: 'symbol', minzoom: 9, filter: ['all', classIn('SOUNDG'), ['<', ['to-number', ['get', 'DEPTH'], 0], 0]], layout: { 'text-field': ['to-string', ['abs', ['/', ['round', ['*', ['to-number', ['get', 'DEPTH']], 10]], 10]]], 'text-font': ['Roboto Bold'], 'text-size': soundingTextSize, 'text-padding': 4, 'icon-image': 'SOUNDSA1', 'icon-text-fit': 'both', 'symbol-sort-key': ['to-number', ['get', 'DEPTH'], 99999] }, paint: { 'text-color': p.ink, 'text-halo-color': p.tidal, 'text-halo-width': 1 } },
      { ...source, id: 'enc-contour-labels', type: 'symbol', minzoom: 10, filter: ['all', classIn('DEPCNT'), ['has', 'VALDCO']], layout: { 'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': ['concat', ['to-string', ['get', 'VALDCO']], ' m'], 'text-font': ['Roboto Bold'], 'text-size': 11, 'text-padding': 12 }, paint: { 'text-color': p.ink, 'text-halo-color': p.deep, 'text-halo-width': 1.5 } },
      { ...source, id: 'enc-names', type: 'symbol', minzoom: 10, filter: ['all', ['has', 'OBJNAM'], ['!=', ['get', 'OBJNAM'], ''], classIn('LNDARE', 'LNDRGN', 'BOYLAT', 'BOYCAR', 'BOYISD', 'BOYSAW', 'BOYSPP', 'BCNLAT', 'BCNCAR', 'BCNSPP', 'LIGHTS', 'BUAARE')], layout: { 'text-field': ['get', 'OBJNAM'], 'text-font': ['Roboto Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 13], 'text-variable-anchor': ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'text-radial-offset': 1.1, 'text-padding': 6, 'text-max-width': 12, 'text-justify': 'auto', 'symbol-sort-key': ['case', classIn('LIGHTS','BOYLAT','BOYCAR','BOYISD','BOYSAW','BOYSPP','BCNLAT','BCNCAR','BCNSPP'), 0, 1] }, paint: { 'text-color': p.ink, 'text-halo-color': p.deep, 'text-halo-width': 1.5 } }
    ]
  };
  style.sources.world = { type: 'vector', tiles: [`${window.location.origin}/enc/basemap/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 7, attribution: 'World baselayer · Viettel HighTech' };
  style.sources.regions = { type: 'geojson', data: `${window.location.origin}/api/enc/regions?${new URLSearchParams({ ...(dataset ? { dataset } : {}), revision: String(catalogRevision), portrayal: 'local-coverage' })}` };
  const patterns = encPatternLayers();
  const infrastructure = encInfrastructureLayers(p);
  const landIndex = style.layers.findIndex(layer => layer.id === 'enc-land');
  style.layers.splice(landIndex + 1, 0, ...infrastructure.filter(layer=>layer.type==='fill'), ...patterns.filter(layer => layer.type === 'fill'));
  style.layers.push(...infrastructure.filter(layer=>layer.type!=='fill'));
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
    if ((!options.names && ['enc-names','enc-light-characteristics','enc-natural-labels-enc','enc-natural-labels-enc_symbols','enc-inland-water-names','enc-inland-water-area-names'].includes(layer.id))
      || (!options.soundings && ['enc-soundings','enc-soundings-drying'].includes(layer.id))
      || (!options.quality && layer.id.startsWith('enc-position-quality-'))) {
      layer.layout = { ...layer.layout, visibility: 'none' };
    }
    if ('source-layer' in layer && layer['source-layer'] === 'enc' && layer.type === 'line') {
      layer['source-layer'] = 'enc_lines';
    }
    if ('source-layer' in layer && ['enc', 'enc_lines'].includes(layer['source-layer'] as string)) {
      layer.minzoom = Math.max(layer.minzoom ?? 0, 9);
    }
  }
  for (const layer of style.layers) {
    if (!('source' in layer) || layer.source !== 'enc' || !('source-layer' in layer) ||
        !['enc', 'enc_lines', 'enc_symbols'].includes(layer['source-layer'] as string)) continue;
    const current = 'filter' in layer ? layer.filter ?? null : null;
    layer.metadata = { ...layer.metadata as Record<string, unknown>, 'enc:baseFilter': current };
    layer.filter = categoryFilter(current, displayCategory) ?? undefined;
  }
  if (basemapOnly) {
    delete style.sources.enc;
    style.layers = style.layers.filter(layer => !('source' in layer) || layer.source !== 'enc');
  }
  return style;
}
