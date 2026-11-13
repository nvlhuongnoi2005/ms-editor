import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './test-source.mjs';
const { createDraftWriter }=await import(await loadSource('../src/domains/enc/draftWriter.ts'));
const { createEditPreview }=await import(await loadSource('../src/domains/enc/editPreview.ts'));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

test('draft writes coalesce a burst and retain the entire latest Undo/Redo history',async()=>{
  const writes=[];
  const writer=createDraftWriter(async value=>writes.push(structuredClone(value)),assert.fail,10000);
  const history=[];
  for(let i=0;i<1000;i++){history.push(i);writer.schedule({undo:[...history],value:i});}
  assert.ok(writer.hasPending());
  await writer.flush();
  assert.equal(writes.length,1);
  assert.equal(writes[0].value,999);
  assert.equal(writes[0].undo.length,1000);
  assert.equal(writer.hasPending(),false);
});
test('flush waits for in-flight write and only the latest queued complete snapshot',async()=>{
  const gate=deferred(),writes=[];
  const writer=createDraftWriter(async value=>{writes.push(value);if(value===1)await gate.promise;},assert.fail,10000);
  writer.schedule(1);const flushed=writer.flush();
  for(let i=2;i<=200;i++)writer.schedule(i);
  let done=false;flushed.then(()=>done=true);
  await Promise.resolve();assert.equal(done,false);
  gate.resolve();await flushed;
  assert.deepEqual(writes,[1,200]);
});
test('write conflict remains blocked, preserves pending data and rejects critical flush',async()=>{
  let expected=0,actual=1,calls=0;const errors=[];
  const writer=createDraftWriter(async()=>{calls++;if(expected!==actual)throw Error('CAS conflict');expected=++actual;},error=>errors.push(error),10000);
  writer.schedule({value:1});
  await assert.rejects(writer.flush(),/CAS conflict/);
  writer.schedule({value:2});
  await assert.rejects(writer.flush(),/CAS conflict/);
  assert.equal(calls,1);assert.equal(errors.length,1);assert.ok(writer.hasPending());
});
test('preview does not wait for idle, batches per frame, and only sends changed features',async()=>{
  let nextFrame=0,source,documents={};const frames=new Map(),listeners=new Map(),updates=[],filters=[],errors=[];
  globalThis.requestAnimationFrame=fn=>{frames.set(++nextFrame,fn);return nextFrame;};
  globalThis.cancelAnimationFrame=id=>frames.delete(id);
  const tick=()=>{const current=[...frames.values()];frames.clear();current.forEach(fn=>fn());};
  const layers=Array.from({length:200},(_,i)=>({id:`base${i}`,source:'enc',filter:['==',['get','object_class'],'LNDMRK']}));
  const originals=structuredClone(layers);
  const map={isStyleLoaded:()=>false,getLayer:id=>id==='enc-background'||layers.find(layer=>layer.id===id),getSource:()=>source,
    getStyle:()=>({layers}),setFilter:(id,filter)=>{filters.push([id,filter]);layers.find(layer=>layer.id===id).filter=filter;},
    on:(name,fn)=>listeners.set(name,fn),off:name=>listeners.delete(name),removeSource:()=>source=undefined,removeLayer:()=>{}};
  const feature=(key)=>({key,sourceId:key.includes('new:')?'new:one':'original',objectClass:'LNDMRK',attributes:{OBJNAM:'A'},geometry:{type:'Point',coordinates:[105,21]},deleted:false});
  documents=Object.fromEntries(Array.from({length:1000},(_,i)=>[`LNDMRK/new:${i}`,feature(`LNDMRK/new:${i}`)]));
  documents['LNDMRK/original']=feature('LNDMRK/original');
  const preview=createEditPreview(map,()=>documents,()=>source={updateData:async diff=>updates.push(diff)},f=>f.attributes,error=>errors.push(error));
  tick();assert.equal(updates.length,1);assert.equal(updates[0].add.length,1001);assert.equal(filters.length,200);
  const changed={...documents['LNDMRK/original'],attributes:{OBJNAM:'B'}};
  documents={...documents,[changed.key]:changed};
  for(let i=0;i<100;i++)preview.schedule();
  assert.equal(frames.size,1);tick();
  assert.equal(updates.length,2);assert.equal(updates[1].add.length,1);
  assert.equal(updates[1].add[0].id,changed.key);assert.equal(filters.length,200);
  assert.equal(listeners.has('idle'),false);
  delete (documents={...documents})['LNDMRK/original'];preview.schedule();tick();
  assert.equal(filters.length,400);assert.deepEqual(layers,originals);
  assert.deepEqual(updates.at(-1).remove,['LNDMRK/original']);
  preview.schedule();preview.stop();assert.equal(frames.size,0);assert.deepEqual(errors,[]);
});
