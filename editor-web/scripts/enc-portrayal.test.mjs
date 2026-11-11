import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExpression, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { loadSource } from './test-source.mjs';

const sectorsURL = await loadSource('../src/domains/enc/lightSectors.ts');
const spriteURL = await loadSource('../src/domains/enc/sprites.ts', { './lightSectors':sectorsURL });
const sprites = await import(spriteURL);
const sectors = await import(sectorsURL);
const { localEncStyle } = await import(await loadSource('../src/domains/enc/style.ts', { './sprites':spriteURL }));

function properties(object_class, attributes = {}, dimension = 0) {
  const result = { object_class, s52_geometry:dimension, ...attributes };
  // Match tile.sql's scalar/list contract, including GDAL lists of numeric strings.
  for (const [key,value] of Object.entries(attributes)) {
    const values = Array.isArray(value) ? value : [value];
    result['sym_'+key] = values[0]; result['list_'+key] = '|'+values.join('|')+'|';
  }
  return result;
}
function compile(expression, type = 'string') {
  const result = createExpression(expression, {type,default:type==='boolean'?false:''});
  assert.equal(result.result,'success',JSON.stringify(result.value));
  return result.value;
}
const selection = compile(sprites.selectedSprite);
const symbol = (cls,attributes,dimension) => selection.evaluate({zoom:14},{type:1,properties:properties(cls,attributes,dimension)});

test('all three themes produce a valid complete MapLibre style', () => {
  globalThis.window = { location:{origin:'http://localhost:5173'} };
  for (const theme of ['day','dusk','night']) {
    const errors = validateStyleMin(localEncStyle('','',theme));
    assert.deepEqual(errors.map(error => error.message),[]);
  }
});

test('catalogue pp.461–462: submerged rocks and drying/awash rocks are distinct', () => {
  assert.equal(symbol('UWTROC',{WATLEV:3}),'UWTROC03');
  for (const WATLEV of [4,5]) assert.equal(symbol('UWTROC',{WATLEV}),'UWTROC04');
  assert.equal(symbol('UWTROC',{WATLEV:3,VALSOU:8}),'DANGER01');
  assert.equal(symbol('UWTROC',{WATLEV:4,VALSOU:-0.7}),'DANGER03');
});

test('catalogue p.96: DANGER02 threshold is 20 m, not the viewer safety depth', () => {
  for (const cls of ['UWTROC','WRECKS','OBSTRN']) {
    assert.equal(symbol(cls,{VALSOU:20,WATLEV:3}),'DANGER01');
    assert.equal(symbol(cls,{VALSOU:20.1,WATLEV:3}),'DANGER02');
    for (const VALSOU of [null,undefined,'','invalid']) assert.ok(!symbol(cls,{VALSOU,WATLEV:3}).startsWith('DANGER'));
  }
});

test('isolated danger requires both shallow object depth and safe surrounding water', () => {
  for (const cls of ['UWTROC','WRECKS','OBSTRN']) {
    assert.equal(symbol(cls,{VALSOU:2,WATLEV:3,s52_surrounding_depth:12}),'ISODGR01');
    assert.equal(symbol(cls,{VALSOU:2,WATLEV:3,s52_surrounding_depth:3}),'DANGER01');
    assert.equal(symbol(cls,{VALSOU:2,WATLEV:3,s52_surrounding_depth:null}),'DANGER01');
    assert.equal(symbol(cls,{VALSOU:8,WATLEV:3,s52_surrounding_depth:12,s52_safety_contour:10}),'ISODGR01');
  }
});

test('catalogue p.450: water tower conspicuity is not reversed', () => {
  assert.equal(symbol('SILTNK',{CATSIL:4,CONVIS:1}),'TOWERS12');
  assert.equal(symbol('SILTNK',{CATSIL:4,CONVIS:2}),'TOWERS02');
  assert.equal(symbol('LNDMRK',{CATLMK:17,CONVIS:1}),'TOWERS03');
  assert.equal(symbol('LNDMRK',{CATLMK:17,CONVIS:2}),'TOWERS01');
});

test('catalogue pp.158–159: strip and flood lights override ordinary color flares', () => {
  assert.equal(symbol('LIGHTS',{CATLIT:['9'],COLOUR:['3']}),'LIGHTS81');
  assert.equal(symbol('LIGHTS',{CATLIT:['8'],COLOUR:['4']}),'LIGHTS82');
  assert.equal(symbol('LIGHTS',{COLOUR:['3']}),'LIGHTS11');
  assert.equal(symbol('LIGHTS',{COLOUR:['4']}),'LIGHTS12');
});

test('catalogue pp.206–207: radio calling points distinguish one and two way traffic', () => {
  assert.equal(symbol('RDOCAL',{ORIENT:90,TRAFIC:3}),'RDOCAL02');
  assert.equal(symbol('RDOCAL',{ORIENT:90,TRAFIC:4}),'RDOCAL03');
  for (const ORIENT of [null,'',undefined,'invalid']) assert.equal(symbol('RDOCAL',{ORIENT,TRAFIC:4}),'RCLDEF01');
});

test('harbour category is respected; other harbours never become fishing harbours', () => {
  assert.equal(symbol('HRBFAC',{CATHAF:['1']}),'ROLROL01');
  assert.equal(symbol('HRBFAC',{CATHAF:['4']}),'HRBFAC09');
  assert.equal(symbol('HRBFAC',{CATHAF:['5']}),'SMCFAC02');
  assert.equal(symbol('HRBFAC',{CATHAF:['10']}),'CHINFO07');
});

test('geometry affects anchor symbols and footprints do not become point towers/buildings', () => {
  assert.equal(symbol('ACHARE',{},0),'ACHARE02');
  assert.equal(symbol('ACHARE',{},2),'ACHARE51');
  assert.equal(symbol('BUISGL',{FUNCTN:[20]},2),'');
  assert.equal(symbol('SILTNK',{CATSIL:4},2),'');
  assert.equal(symbol('BRIDGE',{CATBRG:[1]},1),'');
  assert.equal(symbol('BRIDGE',{CATBRG:[2]},1),'BRIDGE01');
  assert.equal(symbol('PRDARE',{CATPRA:5,CONVIS:1},0),'FLASTK11');
  assert.equal(symbol('PRDARE',{CATPRA:5,CONVIS:1},2),'RFNERY11');
});

test('full attribute lists participate without confusing code 1 and 11', () => {
  assert.equal(symbol('LNDMRK',{CATLMK:['2','3'],CONVIS:1}),'CHIMNY11');
  assert.equal(symbol('BUISGL',{FUNCTN:['11','26'],CONVIS:1}),'BUIREL15');
  assert.equal(symbol('BOYSPP',{CATSPM:['15'],BOYSHP:3}),'BOYSUP02');
  assert.equal(symbol('BOYSPP',{CATSPM:['11'],BOYSHP:3}),'BOYSPP11');
});

test('new atlas branches include customs, rescue, special buoy shapes and tidal streams', () => {
  assert.equal(symbol('CHKPNT',{CATCHP:1}),'CHKPNT01');
  assert.equal(symbol('RSCSTA',{}),'RSCSTA02');
  assert.equal(symbol('BOYSPP',{BOYSHP:8}),'BOYSPP35');
  assert.equal(symbol('TS_FEB',{CAT_TS:1,ORIENT:120}),'FLDSTR01');
  assert.equal(symbol('TS_FEB',{CAT_TS:2,ORIENT:120}),'EBBSTR01');
  assert.equal(symbol('TS_FEB',{CAT_TS:1}),'CURDEF01');
});

test('positional uncertainty supplements the hazard instead of replacing it', () => {
  assert.equal(symbol('OBSTRN',{VALSOU:8,WATLEV:3,QUASOU:[3],s52_quapos:4}),'DANGER01');
  const layer = sprites.encSpriteLayers('#000','#fff').find(layer => layer.id==='enc-position-quality-enc');
  const filter = compile(layer.filter,'boolean');
  assert.equal(filter.evaluate({zoom:14},{type:1,properties:{s52_quapos:4}}),true);
  assert.equal(filter.evaluate({zoom:14},{type:1,properties:{s52_quapos:null}}),false);
});

test('sector arcs wrap north and use reciprocal bearings', () => {
  const arc = sectors.sectorAngles(350,10);
  assert.ok(Math.abs(arc.sweep - Math.PI/9)<1e-10);
  assert.ok(Math.abs(arc.start - 440*Math.PI/180)<1e-10);
  assert.equal(sectors.sectorAngles(0,360).fullCircle,true);
  assert.equal(sectors.parseSectorImage('s52-sector:day:350:10:3').colour,3);
  assert.equal(sectors.parseSectorImage('s52-sector:day:361:10:3'),null);
  assert.equal(sectors.parseSectorImage('arbitrary-image'),null);
  const filter = compile(sectors.isSectorLight,'boolean');
  assert.equal(filter.evaluate({zoom:14},{type:1,properties:properties('LIGHTS',{SECTR1:350,SECTR2:10})}),true);
  assert.equal(filter.evaluate({zoom:14},{type:1,properties:properties('LIGHTS',{SECTR1:null,SECTR2:10})}),false);
  assert.equal(filter.evaluate({zoom:14},{type:1,properties:properties('LIGHTS',{SECTR1:350,SECTR2:10,CATLIT:[9]})}),false);
});

test('every possible symbol output exists in each shipped theme', async () => {
  function outputs(value) {
    if (typeof value==='string') return value ? [value] : [];
    assert.ok(Array.isArray(value));
    const result = outputs(value.at(-1));
    const start = value[0]==='case' ? 2 : 3;
    assert.ok(['case','match'].includes(value[0]),`unexpected selector ${value[0]}`);
    for (let i=start;i<value.length-1;i+=2) result.push(...outputs(value[i]));
    return result;
  }
  const names = [...new Set([sprites.pointSprites,sprites.areaSprites,sprites.linePointSprites,sprites.patternSprites,sprites.lineSprites]
    .flatMap(registry => Object.values(registry).flatMap(outputs)))];
  for (const theme of ['day','dusk','night']) {
    const atlas = JSON.parse(await readFile(new URL(`../../ENC/sprites/${theme}_simplified@2x.json`,import.meta.url),'utf8'));
    assert.equal(Object.keys(atlas).length,232);
    for (const name of names) assert.ok(atlas[name],`${theme}: ${name}`);
  }
});
