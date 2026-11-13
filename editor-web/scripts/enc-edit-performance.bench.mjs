// Synthetic CPU comparison, not a field measurement of network or tile rendering.
import { readFile } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
const source=await readFile(new URL('../src/domains/enc/editing.ts',import.meta.url),'utf8');
const legacy=source.replace(/  let bytes=2[^\n]*\n  while \(undo.length[^\n]*\n/,"  while (undo.length>1 && JSON.stringify(undo).length>4*1024*1024) undo=undo.slice(1);\n");
if(legacy===source)throw Error('Legacy history comparison did not match');
async function compile(text){const {code}=await transformWithOxc(text,'editing.ts');return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);}
const workspace={id:crypto.randomUUID(),token:'a'.repeat(64),baseRevision:'BENCH'};
const coordinates=Array.from({length:512},(_,i)=>[105+i/100000,21+Math.sin(i)/100000]);
const features=Array.from({length:100},(_,i)=>({key:`LNDARE/${i}`,objectClass:'LNDARE',sourceId:String(i),attributes:{OBJNAM:'A'},geometry:{type:'LineString',coordinates},deleted:false,canMove:false,canDelete:false}));
for(const [name,module,snapshotEveryEdit] of [['previous',await compile(legacy),true],['optimized',await compile(source),false]]){
  let state=module.initialEditing(workspace,{version:0,features});
  const start=performance.now();
  for(let i=0;i<100;i++){
    const f=state.documents['LNDARE/0'];state=module.changeFeature(state,f.key,{...f,attributes:{OBJNAM:String(i)}});
    if(snapshotEveryEdit)structuredClone(state);
  }
  if(!snapshotEveryEdit)structuredClone(state);
  const editingMs=performance.now()-start;
  const undoStart=performance.now();
  for(let i=0;i<100;i++){state=module.travelHistory(state,'undo');if(snapshotEveryEdit)structuredClone(state);}
  if(!snapshotEveryEdit)structuredClone(state);
  console.log(JSON.stringify({name,edits:100,overrides:100,verticesPerFeature:512,editCpuMs:Math.round(editingMs*10)/10,undoCpuMs:Math.round((performance.now()-undoStart)*10)/10}));
}
