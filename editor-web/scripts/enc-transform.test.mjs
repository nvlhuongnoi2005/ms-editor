import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSource} from './test-source.mjs';
const {geometryPositions,geometryCenter,transformGeometry,projectPosition,symbolScale}=await import(await loadSource('../src/domains/enc/geometryTransform.ts'));
const {changeFeature,initialEditing,travelHistory,commitChanges}=await import(await loadSource('../src/domains/enc/editing.ts'));
test('uniform projected transforms preserve polygon holes, ring closure, Z and source coordinates',()=>{
 const geometry={type:'Polygon',coordinates:[[[105,21,4],[106,21,4],[106,22,4],[105,21,4]],[[105.2,21.1,3],[105.5,21.1,3],[105.5,21.3,3],[105.2,21.1,3]]]};
 const snapshot=structuredClone(geometry),center=geometryCenter(geometry),after=transformGeometry(geometry,center,[.01,.02],1.5);
 assert.deepEqual(geometry,snapshot);assert.equal(after.coordinates.length,2);
 for(let ring=0;ring<2;ring++){assert.deepEqual(after.coordinates[ring][0],after.coordinates[ring].at(-1));for(let i=0;i<4;i++)assert.equal(after.coordinates[ring][i][2],geometry.coordinates[ring][i][2]);}
 for(const [index,p]of geometryPositions(after).entries()){
  const expected=projectPosition(geometryPositions(geometry)[index]),actual=projectPosition(p);
  assert.ok(Math.abs(actual[0]-(center[0]+(expected[0]-center[0])*1.5+.01))<1e-12);
  assert.ok(Math.abs(actual[1]-(center[1]+(expected[1]-center[1])*1.5+.02))<1e-12);
 }
 assert.throws(()=>transformGeometry(geometry,center,[0,0],0));assert.throws(()=>transformGeometry(geometry,center,[20,0]));
 assert.throws(()=>geometryPositions({type:'Point',coordinates:[0,90]}));
});
test('one transform is one reversible transaction, including point symbol scale',()=>{
 const feature={key:'LNDMRK/new:test',objectClass:'LNDMRK',sourceId:'new:test',geometry:{type:'Point',coordinates:[105,21]},attributes:{},canMove:true,canDelete:true,deleted:false};
 const state=initialEditing({id:'test',baseRevision:'test',token:'test'},{version:0,features:[feature]});
 const next=changeFeature(state,feature.key,{...feature,symbolScale:2});
 assert.equal(next.undo.length,1);assert.equal(commitChanges(next)[0].after.symbolScale,2);
 assert.deepEqual(travelHistory(next,'undo').documents,state.documents);
 assert.equal(travelHistory(travelHistory(next,'undo'),'redo').documents[feature.key].symbolScale,2);
 assert.equal(symbolScale(99),4);assert.equal(symbolScale(.01),.5);
});
