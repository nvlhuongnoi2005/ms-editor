import type { ExpressionSpecification as Expression, Map as EncMap } from 'maplibre-gl';

// S-57 SECTR1/2 are bearings from seaward towards the light. Draw the reciprocal
// bearings around its charted position. Values crossing north remain one sector.
export function sectorAngles(start: number, end: number) {
  const sweep = ((end - start) % 360 + 360) % 360 || 360;
  return { start: (start + 180 - 90) * Math.PI / 180, sweep: sweep * Math.PI / 180, fullCircle: sweep === 360 };
}

const validBearing = (key: string): Expression => ['all', ['has', key], ['!=', ['get', key], null],
  ['!=', ['get', key], ''], ['>=', ['to-number', ['get', key], -1], 0], ['<=', ['to-number', ['get', key], 361], 360]];
export const hasLightSectors: Expression = ['all',validBearing('SECTR1'),validBearing('SECTR2')];
export const isSectorLight: Expression = ['all', ['any',hasLightSectors,
  ['>=',['to-number',['coalesce',['get','VALNMR'],-1],-1],10]],
  ['!', ['any', ...[8,9,11].map(value => ['in', `|${value}|`, ['coalesce', ['get','list_CATLIT'], '']] as Expression)]]];

export function sectorImage(theme: string): Expression {
  return ['concat', 's52-sector:', theme, ':', ['to-string', ['case',hasLightSectors,['to-number',['get','SECTR1']],0]], ':',
    ['to-string', ['case',hasLightSectors,['to-number',['get','SECTR2']],360]], ':', ['to-string', ['coalesce', ['get', 'sym_COLOUR'], 0]]];
}

const colors = {
  day: { ink:'#000000', red:'#F06464', green:'#00B050', yellow:'#FFFF00' },
  dusk: { ink:'#B2C7D1', red:'#B04040', green:'#008050', yellow:'#C0A040' },
  night: { ink:'#B8C3CC', red:'#702020', green:'#004020', yellow:'#806020' },
};

export function parseSectorImage(id: string) {
  const match = /^s52-sector:(day|dusk|night):([^:]+):([^:]+):(\d+)$/.exec(id);
  if (!match) return null;
  const start = Number(match[2]), end = Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0 || start > 360 || end > 360) return null;
  return { theme:match[1] as keyof typeof colors, start, end, colour:Number(match[4]) };
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
    const color = sector.colour === 3 ? palette.red : sector.colour === 4 ? palette.green : palette.yellow;
    const angles = sectorAngles(sector.start, sector.end);
    if (!angles.fullCircle) {
      ctx.strokeStyle = palette.ink; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
      for (const bearing of [angles.start, angles.start + angles.sweep]) {
        ctx.beginPath(); ctx.moveTo(center,center);
        ctx.lineTo(center + radius * Math.cos(bearing),center + radius * Math.sin(bearing)); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    for (const [width,stroke] of [[5,palette.ink],[3,color]] as const) {
      ctx.beginPath(); ctx.strokeStyle = stroke; ctx.lineWidth = width;
      ctx.arc(center,center,radius,angles.start,angles.start + angles.sweep); ctx.stroke();
    }
    map.addImage(id,ctx.getImageData(0,0,canvas.width,canvas.height),{ pixelRatio });
  };
  map.setMissingStyleImageResolver(resolve);
  return () => { map.setMissingStyleImageResolver(null); };
}
