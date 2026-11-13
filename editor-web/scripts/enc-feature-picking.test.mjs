import assert from 'node:assert/strict';
import test from 'node:test';
import {loadSource} from './test-source.mjs';
const {uniqueEncFeatures,pickEncFeatures}=await import(await loadSource('../src/domains/enc/featurePicking.ts'));
const hit=(key,type='symbol',extra={})=>({source:'enc',sourceLayer:'enc_symbols',properties:{edit_key:key,revision_id:'r1',cell_name:'CELL'},layer:{type},...extra});

test('overlap picking deduplicates symbol/line/fill and tile fragments of one object',()=>{
  const a=hit('HRBFAC/a'),b=hit('HRBFAC/b');
  assert.deepEqual(uniqueEncFeatures([hit('HRBFAC/a','fill'),a,hit('HRBFAC/a','line'),b,a]),[a,b]);
});
test('overlap picking preserves separate cells and revisions and prefers edited objects',()=>{
  const a=hit('LIGHTS/a'),other=hit('LIGHTS/a','symbol',{properties:{...a.properties,cell_name:'OTHER'}});
  const revision=hit('LIGHTS/a','symbol',{properties:{...a.properties,revision_id:'r2'}});
  const edit=hit('BOYLAT/new:a','symbol',{source:'enc-edits'});
  assert.deepEqual(uniqueEncFeatures([a,other,revision,edit]),[edit,a,other,revision]);
});
test('picking queries one bounded screen area and falls back to chart regions only without objects',()=>{
  let calls=0;
  const region={source:'regions',id:1,properties:{name:'CELL'},layer:{type:'fill'}};
  const feature=hit('WRECKS/a');
  const map={getLayer:()=>true,queryRenderedFeatures:bounds=>{calls++;assert.deepEqual(bounds,[[94,194],[106,206]]);return[region,feature];}};
  assert.deepEqual(pickEncFeatures(map,{x:100,y:200}),[feature]);assert.equal(calls,1);
  assert.deepEqual(uniqueEncFeatures([region,region]),[region]);
  assert.deepEqual(pickEncFeatures({getLayer:()=>false},{x:0,y:0}),[]);
});
