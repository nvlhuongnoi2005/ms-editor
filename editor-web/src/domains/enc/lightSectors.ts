import type { ExpressionSpecification as Expression, Map as EncMap } from 'maplibre-gl';

// S-57 SECTR1/2 are bearings from seaward towards the light. Draw the reciprocal
// bearings around its charted position. Values crossing north remain one sector.
export function sectorAngles(start: number, end: number) {
  const sweep = ((end - start) % 360 + 360) % 360 || 360;
  return { start: (start + 180 - 90) * Math.PI / 180, sweep: sweep * Math.PI / 180, fullCircle: sweep === 360 };
}

const validBearing = (key: string): Expression => ['all', ['has', key], ['!=', ['get', key], null],
  ['!=', ['get', key], ''], ['>=', ['to-number', ['get', key], -1], 0], ['<=', ['to-number', ['get', key], 361], 360]];
const lightList = (key: string, ...values: number[]): Expression => ['any', ...values.map(value =>
  ['in', `|${value}|`, ['coalesce', ['get', `list_${key}`], '']] as Expression)];
// LIGHTS06: equal limits and 0..360 describe a NO SECTOR light. A short-range
// all-round light must retain its flare instead of becoming a large circle.
export const hasLightSectors: Expression = ['all',validBearing('SECTR1'),validBearing('SECTR2'),
  ['!=', ['to-number',['get','SECTR1']], ['to-number',['get','SECTR2']]],
  ['!', ['all', ['==',['to-number',['get','SECTR1']],0], ['==',['to-number',['get','SECTR2']],360]]]];
export const isSectorLight: Expression = ['all', ['any',hasLightSectors,
  ['all', ['>=',['to-number',['coalesce',['get','VALNMR'],-1],-1],10],
    ['!',lightList('CATLIT',5,6)], ['!=',['to-number',['coalesce',['get','LITCHR'],-1],-1],12]]],
  ['!',lightList('CATLIT',8,9,11)]];

// Colour combinations are significant: white/red selects red, white/green
// selects green. Unknown colours remain magenta, never silently yellow.
export const lightColour: Expression = ['match', ['coalesce',['get','list_COLOUR'],''],
  ['|3|','|1|3|','|3|1|'],3, ['|4|','|1|4|','|4|1|'],4,
  ['|1|','|6|','|11|','|5|6|','|6|5|'],6,12];

export const lightFlareRotation: Expression = ['case',lightList('CATLIT',8,9,11),0,
  ['all',lightList('CATLIT',1,16),validBearing('ORIENT')],
  ['%', ['+', ['to-number',['get','ORIENT']],180],360],
  lightList('COLOUR',1,6,11),45,135];

export function sectorImage(theme: string): Expression {
  return ['concat', 's52-sector:', theme, ':', ['to-string', ['case',hasLightSectors,['to-number',['get','SECTR1']],0]], ':',
    ['to-string', ['case',hasLightSectors,['to-number',['get','SECTR2']],360]], ':', ['to-string',lightColour],
    ['case',['all',hasLightSectors,lightList('LITVIS',3,7,8)],':obscured','']];
}

const colors = {
  day: { ink:'#000000', red:'#F06464', green:'#00B050', yellow:'#FFFF00', magenta:'#C045D1' },
  dusk: { ink:'#B2C7D1', red:'#B04040', green:'#008050', yellow:'#C0A040', magenta:'#826CA1' },
  night: { ink:'#B8C3CC', red:'#702020', green:'#004020', yellow:'#806020', magenta:'#411247' },
};

export function parseSectorImage(id: string) {
  const match = /^s52-sector:(day|dusk|night):([^:]+):([^:]+):(\d+)(:obscured)?$/.exec(id);
  if (!match) return null;
  const start = Number(match[2]), end = Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0 || start > 360 || end > 360) return null;
  return { theme:match[1] as keyof typeof colors, start, end, colour:Number(match[4]), obscured:!!match[5] };
}

// Draw chart geometry directly; these images supplement the supplied sprite atlas.
// MapLibre 6 awaits this resolver before replying to the tile worker. Its
// styleimagemissing event is a notification after that reply; adding images in
// that event can leave newly encountered sectors absent from the first layout.
export function installSectorImages(map: EncMap) {
  const resolve = (id: string) => {
    const sector = parseSectorImage(id);
    if (!sector || map.hasImage(id)) return;
    const pixelRatio = 2, size = 184, center = size / 2, radius = 80;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size * pixelRatio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(pixelRatio, pixelRatio);
    const palette = colors[sector.theme];
    const color = sector.colour === 3 ? palette.red : sector.colour === 4 ? palette.green
      : sector.colour === 6 || sector.colour === 1 || sector.colour === 11 ? palette.yellow : palette.magenta;
    const angles = sectorAngles(sector.start, sector.end);
    if (!angles.fullCircle) {
      ctx.strokeStyle = palette.ink; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
      for (const bearing of [angles.start, angles.start + angles.sweep]) {
        ctx.beginPath(); ctx.moveTo(center,center);
        ctx.lineTo(center + radius * Math.cos(bearing),center + radius * Math.sin(bearing)); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    // Obscured/faint sectors use a thin dashed black arc (LIGHTS06 continuation).
    const strokes: ReadonlyArray<readonly [number,string]> = sector.obscured ? [[1,palette.ink]] : [[5,palette.ink],[3,color]];
    if (sector.obscured) ctx.setLineDash([3,3]);
    for (const [width,stroke] of strokes) {
      ctx.beginPath(); ctx.strokeStyle = stroke; ctx.lineWidth = width;
      ctx.arc(center,center,radius,angles.start,angles.start + angles.sweep); ctx.stroke();
    }
    map.addImage(id,ctx.getImageData(0,0,canvas.width,canvas.height),{ pixelRatio });
  };
  map.setMissingStyleImageResolver(resolve);
  return () => { map.setMissingStyleImageResolver(null); };
}
