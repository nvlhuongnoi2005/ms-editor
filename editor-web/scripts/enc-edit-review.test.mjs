import assert from 'node:assert/strict';
import test from 'node:test';
import {loadSource} from './test-source.mjs';
const {reviewEditing}=await import(await loadSource('../src/domains/enc/editReview.ts'));
const {movementLockMessage}=await import(await loadSource('../src/domains/enc/editPermissions.ts'));
const feature=()=>({key:'DEPARE/a',sourceId:'a',objectClass:'DEPARE',attributes:{DRVAL1:5,DRVAL2:10,OBJNAM:'Old',RCID:1},geometry:{type:'Polygon',coordinates:[]},deleted:false,canMove:false,canDelete:false});
const schema={DEPARE:[{key:'DRVAL1',kind:'number'},{key:'DRVAL2',kind:'number'},{key:'OBJNAM',kind:'text'}]};
const state=(before,after)=>({saved:before?{[before.key]:before}:{},documents:after?{[after.key]:after}:{}});
test('review compares source on first edit and only changed fields, preserving protected source attributes',()=>{
  const original=feature(),after={...original,attributes:{...original.attributes,OBJNAM:'New'}};
  const [entry]=reviewEditing(state(undefined,after),{[original.key]:original},schema);
  assert.deepEqual(entry.fields,[{name:'OBJNAM',before:'Old',after:'New'}]);assert.deepEqual(entry.errors,[]);assert.equal(entry.sourceMissing,false);
});
test('review compares last saved override and identifies restoration to the original',()=>{
  const original=feature(),saved={...original,attributes:{...original.attributes,OBJNAM:'Saved'}};
  const [entry]=reviewEditing(state(saved,undefined),{[original.key]:original},schema);
  assert.equal(entry.action,'Khôi phục nguồn');assert.deepEqual(entry.fields,[{name:'OBJNAM',before:'Saved',after:'Old'}]);
});
test('preflight rejects changed protected fields and invalid depth ranges but permits unchanged imported range',()=>{
  const original=feature(),after={...original,attributes:{...original.attributes,RCID:2,DRVAL1:11}};
  const [entry]=reviewEditing(state(original,after),{},schema);
  assert.ok(entry.errors.some(e=>e.startsWith('RCID:')));assert.ok(entry.errors.some(e=>e.includes('DRVAL1')));
  const invalid={...original,attributes:{...original.attributes,DRVAL1:20}};
  assert.deepEqual(reviewEditing(state(invalid,{...invalid,attributes:{...invalid.attributes,OBJNAM:'Edited'}}),{},schema)[0].errors,[]);
});
test('review reports unavailable source and schema enum violations',()=>{
  const f={...feature(),objectClass:'LIGHTS',sourceId:'new:1',key:'LIGHTS/new:1',geometry:{type:'Point',coordinates:[105,21]},attributes:{COLOUR:[999]}};
  const [entry]=reviewEditing(state(undefined,f),{},{LIGHTS:[{key:'COLOUR',kind:'list',options:[{value:3}]}]});
  assert.equal(entry.action,'Thêm mới');assert.equal(entry.sourceMissing,false);assert.ok(entry.errors.some(e=>e.startsWith('COLOUR:')));
  assert.equal(reviewEditing(state(undefined,feature()),{},schema)[0].sourceMissing,true);
});
test('lock reasons remain explanatory and never grant movement permission',()=>{
  assert.match(movementLockMessage({canMove:false,moveLockReason:'connected_node'}),/ConnectedNode/);
  assert.ok(movementLockMessage({canMove:false,moveLockReason:'future_reason'}));
  assert.equal(movementLockMessage({canMove:true,moveLockReason:'feature_links'}),undefined);
});
