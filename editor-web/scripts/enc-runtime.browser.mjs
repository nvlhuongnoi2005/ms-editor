// Exercise ENC style replacement and large line rendering in a clean browser.
// Read-only against the live API. Set ENC_ALLOW_RENDER_WARNINGS=1 for diagnosis.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const base = process.env.ENC_PREVIEW_URL ?? 'http://127.0.0.1:4173/?mode=enc';
const profile = await mkdtemp(join(tmpdir(), 'enc-runtime-'));
const chrome = spawn(process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--disable-extensions', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', 'about:blank'],
  { windowsHide:true, stdio:'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const warnings = [], errors = [], tileURLs = new Set();
let visibleLineFeatures=0;
let ws, call;
try {
  let page;
  for (let i=0;i<60;i++) {
    try {
      const port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];
      page=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item=>item.type==='page');
      if(page) break;
    } catch { /* Browser is starting. */ }
    await pause(150);
  }
  assert.ok(page,'Chrome did not start');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  let next=0;
  const pending=new Map();
  call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++next; pending.set(id,{resolve,reject}); ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data), p=message.params;
    if(message.id){const task=pending.get(message.id);pending.delete(message.id);message.error?task?.reject(Error(JSON.stringify(message.error))):task?.resolve(message.result);}
    if(message.method==='Target.attachedToTarget') {
      void (async()=>{await call('Runtime.enable',{},p.sessionId);await call('Network.enable',{},p.sessionId);await call('Runtime.runIfWaitingForDebugger',{},p.sessionId);})().catch(error=>errors.push(String(error)));
    }
    if(message.method==='Runtime.exceptionThrown') errors.push(p.exceptionDetails.exception?.description??p.exceptionDetails.text);
    if(message.method==='Runtime.consoleAPICalled'&&['warning','error'].includes(p.type)) {
      const text=p.args.map(arg=>arg.value??arg.description??'').join(' ');
      (p.type==='warning'?warnings:errors).push(text);
    }
    if(message.method==='Network.requestWillBeSent'&&/\/(?:enc\/basemap|api\/enc\/tiles)\//.test(p.request.url)) tileURLs.add(p.request.url);
  });
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor=async expression=>{
    for(let i=0;i<300;i++){if(await evaluate(expression))return;await pause(100);}
    throw Error('Timed out: '+expression);
  };
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
  await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:base});
  await waitFor('!!document.querySelector(".maplibregl-map")');
  await evaluate(`(()=>{
    const element=document.querySelector('.maplibregl-map');
    let fiber=element[Object.keys(element).find(key=>key.startsWith('__reactFiber$'))];
    for(;fiber;fiber=fiber.return)for(let hook=fiber.memoizedState;hook;hook=hook.next){
      const value=hook.memoizedState?.current;
      if(value&&typeof value.getZoom==='function'&&typeof value.getSource==='function'){window.testMap=value;return;}
    }
    throw Error('Map ref not found');
  })()`);
  await waitFor('!!testMap.getLayer("enc-depth") && testMap.loaded()');
  const initialCamera=await evaluate('({center:testMap.getCenter(),zoom:testMap.getZoom()})');
  await pause(500);
  for(const zoom of [12,9,14]){
    await evaluate(`testMap.jumpTo({zoom:${zoom}});void 0`);
    await waitFor('testMap.loaded()');
    await pause(300);
  }
  for(const zoom of [5,7,8,9,12]){
    await evaluate(`testMap.jumpTo({center:[-87.65,44.09],zoom:${zoom}});void 0`);
    await pause(150);
    await waitFor('testMap.loaded()');
  }
  for(const [lng,lat,zoom] of [[-147.31,61.05,9],[-147.31,61.05,10],[-147.76,61.05,9],[-121.53,37.95,11],[-81.69,28.06,9],[106.3,9.3,14]]){
    await evaluate(`testMap.jumpTo({center:[${lng},${lat}],zoom:${zoom}});void 0`);
    await pause(150);await waitFor('testMap.loaded()');
    visibleLineFeatures+=await evaluate('testMap.queryRenderedFeatures().filter(feature=>feature.sourceLayer==="enc_lines"&&feature.properties.feature_id).length');
  }
  // Replace a style twice within one task, as with fast theme/settings changes.
  await evaluate(`(()=>{const buttons=[...document.querySelectorAll('[aria-label="Chế độ màu ENC"] button')];buttons[1].click();setTimeout(()=>buttons[2].click(),0)})()`);
  await pause(200);
  await waitFor('testMap.loaded()');
  await pause(300);
  const renderedLineLayers=await evaluate('testMap.getStyle().layers.filter(layer=>layer.source==="enc"&&layer.type==="line").map(layer=>layer["source-layer"])');
  const oversized=[];
  for(const url of tileURLs){
    const response=await fetch(url); if(!response.ok)continue;
    const tile=new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer())));
    for(const [name,layer] of Object.entries(tile.layers))for(let i=0;i<layer.length;i++){
      const feature=layer.feature(i), maxRing=Math.max(0,...feature.loadGeometry().map(ring=>ring.length));
      if(maxRing>6000)oversized.push({source:new URL(url).pathname,layer:name,class:feature.properties.object_class,maxRing});
    }
  }
  const renderWarnings=[...new Set(warnings.filter(text=>/Max vertices per segment|Unable to perform style diff/.test(text)))];
  const unsafeRenderedPaths=oversized.filter(feature=>renderedLineLayers.includes(feature.layer));
  const regions=await (await fetch(new URL('/api/enc/regions',base))).json();
  const largeRegions=regions.features.flatMap(feature=>{
    const g=feature.geometry, polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    return polygons.flatMap(polygon=>polygon.filter(ring=>ring.length>6553).map(ring=>({name:feature.properties.name,vertices:ring.length})));
  });
  console.log(JSON.stringify({initialCamera,errors,renderWarnings,unsafeRenderedPaths,visibleLineFeatures,retainedLargeFillRings:oversized.filter(feature=>feature.layer==='enc').length,largeRegions,tileRequests:tileURLs.size},null,2));
  assert.deepEqual(errors,[],'No page/worker exceptions in a clean profile');
  if(process.env.ENC_ALLOW_RENDER_WARNINGS!=='1'){
    assert.deepEqual(renderWarnings,[],'No geometry capacity or style loading warnings');
    assert.deepEqual(unsafeRenderedPaths,[],'Rendered line sources stay below MapLibre segment capacity');
    assert.ok(renderedLineLayers.includes('enc_lines'),'ENC line layers use the bounded geometry source');
    assert.ok(visibleLineFeatures>0,'Split ENC paths remain visible and retain feature identifiers');
  }
} catch(error) {
  console.error(JSON.stringify({errors,warnings:[...new Set(warnings)]},null,2));
  throw error;
} finally {
  if(call)await call('Browser.close').catch(()=>{});
  ws?.close();chrome.kill();
}
