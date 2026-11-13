import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { loadSource } from './test-source.mjs';

const {symbolOutputs,symbolClasses,symbolRegistries} = await import(await loadSource('../../Presentation_Library/runtime/symbolMappings.ts'));
const {encSymbols,searchEncSymbols} = await import(await loadSource('../src/domains/enc/symbolCatalog.ts'));
const {featureSymbol,pointSymbol,pointProperties} = await import(await loadSource('../src/domains/enc/pointSymbols.ts',{'@maplibre/maplibre-gl-style-spec':import.meta.resolve('@maplibre/maplibre-gl-style-spec')}));
const schema=JSON.parse(await readFile(new URL('../../editor-api/internal/enc/editing_schema.generated.json',import.meta.url),'utf8'));

test('Vietnamese copy covers the exact atlas with consistent punctuation and no upstream English fallback',async()=>{
  const descriptions=JSON.parse(await readFile(new URL('../../Presentation_Library/runtime/symbolDescriptions.vi.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(descriptions).sort(),encSymbols.map(symbol=>symbol.code).sort());
  for(const symbol of encSymbols){
    assert.equal(symbol.description,descriptions[symbol.code]);
    assert.equal(symbol.description,symbol.description.trim());
    assert.match(symbol.description,/^[\p{Lu}0-9].*\.$/u,symbol.code);
    assert.match(symbol.description,/[^\x00-\x7f]/,symbol.code);
    assert.doesNotMatch(symbol.description,/\r|\n|\s{2,}|Chưa có giải thích|paper.chart|pattern of|symbol for|conspicuous|sounding of|traffic scheme|radar transponder/i,symbol.code);
  }
  assert.ok(searchEncSymbols('hai do giay').some(symbol=>symbol.code==='BOYCON01'));
  assert.ok(searchEncSymbols('do chinh xac').some(symbol=>symbol.code==='DQUALA11P'));
});

test('S-52 harbour class search includes marina, fishing harbour and RoRo without confusing their meanings',()=>{
  const codes=searchEncSymbols('HRBFAC').map(entry=>entry.code);
  assert.deepEqual(codes.sort(),['CHINFO07','HRBFAC09','ROLROL01','SMCFAC02']);
  for(const [category,code] of [[1,'ROLROL01'],[4,'HRBFAC09'],[5,'SMCFAC02'],[10,'CHINFO07']]) {
    assert.equal(pointSymbol('HRBFAC',{CATHAF:[String(category)]}),code);
    assert.equal(featureSymbol(pointProperties('HRBFAC',{CATHAF:[String(category)]})),code);
  }
  assert.ok(searchEncSymbols('HRBFAC du thuyen').some(entry=>entry.code==='SMCFAC02'));
  assert.ok(!searchEncSymbols('HRBFAC du thuyen').some(entry=>entry.code==='HRBFAC09'));
  assert.equal(featureSymbol({object_class:'BUISGL',s52_geometry:2}),undefined);
});

test('all 499 atlas entries have descriptions and consistent in-bounds rectangles in every theme',async()=>{
  assert.equal(encSymbols.length,499);
  for(const theme of ['day','dusk','night']) {
    const atlas=JSON.parse(await readFile(new URL(`../../Presentation_Library/assets/sprites/${theme}_simplified@2x.json`,import.meta.url),'utf8'));
    const png=await readFile(new URL(`../../Presentation_Library/assets/sprites/${theme}_simplified@2x.png`,import.meta.url));
    assert.deepEqual(Object.keys(atlas).sort(),encSymbols.map(entry=>entry.code).sort());
    for(const entry of encSymbols) {
      assert.ok(entry.description && !entry.description.startsWith('Chưa có'),entry.code);
      const rect=atlas[entry.code];
      assert.deepEqual(rect,entry.sprite,`${theme}/${entry.code}`);
      assert.ok(rect.x>=0 && rect.y>=0 && rect.width>0 && rect.height>0 && rect.pixelRatio>0 && rect.x+rect.width<=png.readUInt32BE(16) && rect.y+rect.height<=png.readUInt32BE(20),`${theme}/${entry.code}`);
    }
  }
});

test('every branch of every registered selector points to an existing symbol discoverable by its source class',()=>{
  const atlas=new Set(encSymbols.map(entry=>entry.code));
  for(const [kind,registry] of Object.entries(symbolRegistries))for(const [objectClass,value] of Object.entries(registry)) {
    const searchable=new Set(searchEncSymbols(objectClass).map(entry=>entry.code));
    for(const code of symbolOutputs(value)) {
      assert.ok(atlas.has(code),`${kind}/${objectClass}/${code}`);
      assert.ok(symbolClasses[code]?.includes(objectClass));
      assert.ok(searchable.has(code),`${objectClass} search misses ${code}`);
    }
    if(!Array.isArray(value))continue;
    const compiled=createExpression(value,'symbol-audit',{type:'string',default:'','property-type':'data-driven',transition:false});
    assert.equal(compiled.result,'success',`${kind}/${objectClass}`);
    // Exercise every declared S-57 enum value read by the actual selector,
    // including values that do not occur in the installed ENC cells.
    const fields=new Set([...JSON.stringify(value).matchAll(/(?:sym_|list_)([A-Z_]+)/g)].map(match=>match[1]));
    const cases=[{}];
    for(const field of fields)for(const option of schema.attributes[field]?.options??[])cases.push({[field]:[option.value]});
    for(const attributes of cases) {
      const code=compiled.value.evaluate({zoom:17},{type:1,properties:pointProperties(objectClass,attributes)});
      assert.ok(code==='' || atlas.has(code),`${kind}/${objectClass}/${JSON.stringify(attributes)} => ${code}`);
    }
  }
});
