// Read-only audit of every active ENC revision against the actual style filters.
// Run from editor-web: node scripts/enc-dataset-audit.mjs [report.md]
// Layer eligibility is NOT proof of on-screen placement or full S-52 compliance.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { loadSource } from './test-source.mjs';

const sectorURL = await loadSource('../src/domains/enc/lightSectors.ts');
const specsURL = await loadSource('../src/domains/enc/spriteSpecs.generated.ts');
const spriteURL = await loadSource('../src/domains/enc/sprites.ts', {'./lightSectors':sectorURL,'./spriteSpecs.generated':specsURL});
const infrastructureURL = await loadSource('../src/domains/enc/infrastructure.ts', {'./spriteSpecs.generated':specsURL});
const { localEncStyle } = await import(await loadSource('../src/domains/enc/style.ts', {'./sprites':spriteURL,'./infrastructure':infrastructureURL}));
const { isSectorLight } = await import(sectorURL);
globalThis.window = {location:{origin:'http://localhost'}};
const style = localEncStyle('','','day',0,false,6,6,'other');
const atlas = JSON.parse(await readFile(new URL('../../ENC/sprites/day_simplified@2x.json',import.meta.url),'utf8'));
const invalidSprites = new Map();
for (const theme of ['day','dusk','night']) {
  const entries = JSON.parse(await readFile(new URL(`../../ENC/sprites/${theme}_simplified@2x.json`,import.meta.url),'utf8'));
  const png = await readFile(new URL(`../../ENC/sprites/${theme}_simplified@2x.png`,import.meta.url));
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  for (const [name,r] of Object.entries(entries)) if (r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>width||r.y+r.height>height) {
    invalidSprites.set(name,[...(invalidSprites.get(name)??[]),theme]);
  }
}
const sources = await Promise.all(['sprites.ts','style.ts','lightSectors.ts','infrastructure.ts'].map(file =>
  readFile(new URL('../src/domains/enc/'+file,import.meta.url),'utf8')));
const fields = [...new Set(sources.join('\n').match(/'([A-Z][A-Z_0-9]+)'/g).map(value => value.slice(1,-1)))];
// Group by portrayal attributes to avoid transferring repeated source metadata.
// OBJNAM's content is immaterial here; only the presence of a name affects rules.
const sql = `WITH active AS (
 SELECT f.*,r.id AS revision_id FROM enc.feature f
 JOIN enc.cell_revision r ON r.storage_dataset_id=f.dataset_id AND r.cell_name=f.cell_name
 JOIN enc.active_cell a ON a.revision_id=r.id
), projected AS (
 SELECT object_class,ST_Dimension(geometry) AS dimension,cell_name,source_id,
 COALESCE((SELECT jsonb_object_agg(key,CASE WHEN key='OBJNAM' AND value#>>'{}'<>'' THEN '"name"'::jsonb ELSE value END)
 FROM jsonb_each(attributes) WHERE key IN (${fields.map(field => "'"+field+"'").join(',')})),'{}'::jsonb) AS attrs
 FROM active WHERE object_class NOT LIKE 'M\\_%' ESCAPE '\\'
 AND object_class NOT IN ('IsolatedNode','ConnectedNode','Edge','Face')
) SELECT jsonb_build_object('class',object_class,'dimension',dimension,'attrs',attrs,'count',count(*),
 'example',min(cell_name||':'||source_id)) FROM projected GROUP BY object_class,dimension,attrs;`;
const output = execFileSync('docker',['exec',process.env.ENC_DB_CONTAINER??'map-service-postgres-1',
  'psql','-U','enc_owner','-d','enc_canonical','-X','-At','-v','ON_ERROR_STOP=1','-c',sql],
  {encoding:'utf8',maxBuffer:256*1024*1024,windowsHide:true});
const rows = output.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));

function expression(value) {
  if (!Array.isArray(value)) return () => value;
  // Image resolution needs MapLibre's image manager. For coverage, evaluate the
  // requested image name and check it against all three atlases separately.
  function unwrap(item) {
    if (!Array.isArray(item)) return item;
    if (item[0]==='image') return unwrap(item[1]);
    if (item[0]==='literal') return item;
    return item.map(unwrap);
  }
  const result = createExpression(unwrap(value),'enc-audit.expression');
  if (result.result!=='success') throw Error(JSON.stringify(result.value));
  return feature => result.value.evaluate({zoom:17},feature);
}
const candidates = style.layers.filter(layer => layer.source==='enc' && ['enc','enc_lines','enc_symbols'].includes(layer['source-layer'])
  && !layer.id.startsWith('enc-position-quality'))
  .map(layer => ({layer,filter:expression(layer.filter??true),
    icon:expression(layer.layout?.['icon-image']??''),text:expression(layer.layout?.['text-field']??''),
    pattern:expression(layer.paint?.['fill-pattern']??layer.paint?.['line-pattern']??'')}));
const sectors = expression(isSectorLight);
const summary = new Map(), missingImages = new Set();
const lights = {total:0,arcs:0,flares:0,special:0};
for (const row of rows) {
  const properties = {object_class:row.class,s52_geometry:row.dimension,...row.attrs};
  for (const [key,value] of Object.entries(row.attrs)) {
    const values = Array.isArray(value)?value:[value];
    properties['sym_'+key] = values[0];
    properties['list_'+key] = '|'+values.join('|')+'|';
  }
  const key = row.class+':'+row.dimension;
  const group = summary.get(key)??{cls:row.class,dim:row.dimension,total:0,missing:0,fallback:0,layers:new Set(),examples:[]};
  group.total += row.count;
  let portrayal = false, fallback = false;
  for (const candidate of candidates) {
    const {layer} = candidate;
    if (layer['source-layer']==='enc_symbols' && row.dimension===0) continue;
    if (layer['source-layer']==='enc_lines' && row.dimension===0) continue;
    const dimension = layer['source-layer']==='enc_symbols'?0:layer['source-layer']==='enc_lines'?1:row.dimension;
    if (layer.type==='fill' && dimension!==2 || layer.type==='line' && dimension===0) continue;
    const feature = {type:dimension+1,properties};
    if (!candidate.filter(feature)) continue;
    if (layer.id==='enc-unmapped-points') { fallback = true; continue; }
    let visible = layer.type!=='symbol';
    const image = layer.type==='symbol'?candidate.icon(feature):candidate.pattern(feature);
    if (image) {
      if (!/^s52-(sector|line):/.test(image) && (!atlas[image]||invalidSprites.has(image))) missingImages.add(image);
      else visible = true;
    }
    if (layer.type==='symbol' && String(candidate.text(feature)??'').length) visible = true;
    if (visible) { portrayal = true; group.layers.add(layer.id); }
  }
  if (!portrayal) {
    if (fallback) group.fallback += row.count; else group.missing += row.count;
    if (group.examples.length<3) group.examples.push(row.example);
  }
  if (row.class==='LIGHTS') {
    lights.total += row.count;
    if (sectors({type:1,properties})) lights.arcs += row.count;
    else if ((row.attrs.CATLIT??[]).some(value=>[8,9,11].includes(Number(value)))) lights.special += row.count;
    else lights.flares += row.count;
  }
  summary.set(key,group);
}
const groups = [...summary.values()].sort((a,b)=>a.cls.localeCompare(b.cls)||a.dim-b.dim);
const totals = groups.reduce((s,g)=>({total:s.total+g.total,missing:s.missing+g.missing,fallback:s.fallback+g.fallback}),{total:0,missing:0,fallback:0});
const report = `# Active ENC portrayal coverage audit\n\n`+
  `Read-only snapshot of active revisions. Geographical objects: ${totals.total}; classes: ${new Set(groups.map(g=>g.cls)).size}.\n\n`+
  `No eligible portrayal: ${totals.missing}. Question-mark fallback only: ${totals.fallback}. Missing requested atlas images: ${[...missingImages].join(', ')||'none'}.\n\n`+
  `Invalid atlas rectangles (including unused dataset branches): ${[...invalidSprites].map(([name,themes])=>name+' ('+themes.join(', ')+')').join('; ')||'none'}.\n\n`+
  `LIGHTS: ${JSON.stringify(lights)}. Arc counts include true sectors and qualifying major all-round lights.\n\n`+
  `This evaluates actual style filters at z17 before scale selection, clipping, collisions and tile quantization. `+
  `It does not assert that every object is drawn simultaneously or that any matching layer is a complete/correct S-52 portrayal. `+
  `Depth/position context is not reconstructed; contextual hazard and topmark variants require the SQL/browser checks. `+
  `Metadata classes M_* and spatial primitives are excluded intentionally.\n\n`+
  `| Class | Source geometry | Objects | No portrayal | Fallback only | Eligible layers | Gap examples |\n|---|---|---:|---:|---:|---|---|\n`+
  groups.map(g=>`| ${g.cls} | ${['Point','Line','Area'][g.dim]} | ${g.total} | ${g.missing} | ${g.fallback} | ${[...g.layers].join(', ')} | ${g.examples.join('; ')} |`).join('\n')+'\n';
if (process.argv[2]) await writeFile(process.argv[2],report,'utf8');
console.log(JSON.stringify({classes:new Set(groups.map(g=>g.cls)).size,...totals,lights,missingImages:[...missingImages],invalidSprites:Object.fromEntries(invalidSprites)},null,2));
console.log('Classes with gaps:',groups.filter(g=>g.missing||g.fallback).map(g=>`${g.cls}/${g.dim}: ${g.missing} absent, ${g.fallback} fallback`).join('; '));
if (missingImages.size) process.exitCode = 1;
