import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { selectedSprite, spritePivotOffsets, spriteRotation } from './sprites';
import { spriteSpecs } from './spriteSpecs.generated';
import { encSymbols, normalizeSymbolSearch } from './symbolCatalog';
import day from '../../../../Presentation_Library/assets/sprites/day_simplified@2x.json';
import dusk from '../../../../Presentation_Library/assets/sprites/dusk_simplified@2x.json';
import night from '../../../../Presentation_Library/assets/sprites/night_simplified@2x.json';
import { atlasAssets } from './atlasAssets';
import type { EncTheme } from './style';
import atlasMetadata from '../../../../Presentation_Library/assets/sprites/additions.json';

const compiled = createExpression(selectedSprite,'enc-editing-symbol',{type:'string',default:'','property-type':'data-driven',transition:false});
if (compiled.result !== 'success') throw new Error('Invalid ENC point portrayal expression');
const selector = compiled.value;
const rotationExpression = createExpression(spriteRotation,'enc-editing-rotation',{type:'number',default:0,'property-type':'data-driven',transition:false});
if (rotationExpression.result !== 'success') throw new Error('Invalid point rotation expression');
const rotationSelector = rotationExpression.value;
const descriptions = new Map(encSymbols.map(symbol => [symbol.code, symbol.description]));
export function pointProperties(objectClass: string, attributes: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...attributes, object_class: objectClass, s52_geometry: 0 };
  for (const [key, value] of Object.entries(attributes)) {
    const values = Array.isArray(value) ? value : [value];
    result['sym_' + key] = values[0]; result['list_' + key] = '|' + values.join('|') + '|';
  }
  return result;
}
export function pointSymbol(objectClass: string, attributes: Record<string, unknown> = {}): string {
  const value = selector.evaluate({ zoom: 15 }, { type: 1, properties: pointProperties(objectClass, attributes) });
  return typeof value === 'string' && value in day ? value : 'QUESMRK1';
}
/** Primary SY selection from the same normalized MVT attributes as the map. */
export function featureSymbol(properties: Record<string, unknown>): string | undefined {
  const value = selector.evaluate({ zoom:15 }, { type:1, properties });
  return typeof value === 'string' && value in day ? value : undefined;
}
export type PointChoice = { id: string; objectClass: string; attributes: Record<string, unknown>; symbol: string; description: string };
export function pointChoices(classes: string[]): PointChoice[] {
  const result: PointChoice[] = [], seen = new Set<string>();
  for (const objectClass of classes) {
    const candidates: Record<string, unknown>[] = [{}];
    if (objectClass.startsWith('BOY')) for (const BOYSHP of [1,2,3,4,5,6,7,8]) for (const COLOUR of [[3],[4],[6],[2]]) candidates.push({ BOYSHP, COLOUR });
    if (objectClass.startsWith('BCN')) for (const BCNSHP of [1,2,3,4,5,6,7]) for (const COLOUR of [[3],[4],[6]]) candidates.push({ BCNSHP, COLOUR });
    if (objectClass.endsWith('CAR')) for (const CATCAM of [1,2,3,4]) candidates.push({ CATCAM, COLOUR:[2,6] });
    if (objectClass === 'LNDMRK') for (const CATLMK of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21]) for (const CONVIS of [1,2]) candidates.push({ CATLMK:[CATLMK], CONVIS });
    if (objectClass === 'LIGHTS') {
      for (const colour of [1,3,4,6]) candidates.push({ COLOUR:[colour] });
      for (const CATLIT of [8,9]) candidates.push({ CATLIT:[CATLIT] });
    }
    if (['OBSTRN','UWTROC','WRECKS'].includes(objectClass)) {
      for (const WATLEV of [1,2,3,4,5]) candidates.push({ WATLEV });
      for (const VALSOU of [-1,5,25]) candidates.push({ VALSOU, WATLEV:3 });
    }
    for (const attributes of candidates) {
      const symbol = pointSymbol(objectClass, attributes), id = objectClass + ':' + symbol;
      if (seen.has(id)) continue;
      seen.add(id); result.push({ id, objectClass, attributes, symbol, description: descriptions.get(symbol) ?? objectClass });
    }
  }
  return result;
}
export { normalizeSymbolSearch };
export function spriteStyle(symbol: string, theme: EncTheme, limit = 32) {
  const atlases = { day, dusk, night }, atlas = atlases[theme];
  const rect = atlas[symbol as keyof typeof atlas] ?? atlas.QUESMRK1;
  const ratio = Math.min(1 / rect.pixelRatio, limit / rect.width, limit / rect.height);
  const { width, height } = atlasMetadata;
  return { rect, ratio, width, height, url: atlasAssets[theme].png };
}
export function markerElement(objectClass: string, attributes: Record<string, unknown>, theme: EncTheme, scale=1) {
  const symbol = pointSymbol(objectClass, attributes), info = spriteStyle(symbol, theme, 64);
  const wrapper = document.createElement('div'); wrapper.className = 'enc-edit-symbol-marker';
  wrapper.setAttribute('aria-label', `Di chuyển ${objectClass} · ${symbol}`);
  const image = document.createElement('span'); image.dataset.symbol = symbol;
  const spec = spriteSpecs[symbol];
  const ratio = (spec?.widthMm ? spec.widthMm * 96 / 25.4 / info.rect.width : 1 / info.rect.pixelRatio)*scale;
  const pivot = spritePivotOffsets[symbol] ?? [0,0];
  const bottom = !(symbol in spritePivotOffsets) && /^(BOY|BCN|LIGHTS)/.test(objectClass);
  Object.assign(image.style, { display:'block', position:'absolute', width:`${info.rect.width*ratio}px`, height:`${info.rect.height*ratio}px`, left:`${22-info.rect.width*ratio/2 + pivot[0]*info.rect.pixelRatio*ratio}px`, top:`${22-info.rect.height*ratio/(bottom?1:2) + pivot[1]*info.rect.pixelRatio*ratio}px`, backgroundImage:`url("${info.url}")`, backgroundPosition:`${-info.rect.x*ratio}px ${-info.rect.y*ratio}px`, backgroundSize:`${info.width*ratio}px ${info.height*ratio}px` });
  wrapper.append(image); return wrapper;
}
export function pointRotation(objectClass: string, attributes: Record<string, unknown>) {
  return Number(rotationSelector.evaluate({ zoom:15 }, { type:1, properties: pointProperties(objectClass,attributes) })) || 0;
}
