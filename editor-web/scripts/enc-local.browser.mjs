// Read-only check of the live ENC viewer after importing a local dataset.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.ENC_PREVIEW_URL ?? 'http://127.0.0.1:4173/?mode=enc';
const profile = await mkdtemp(join(tmpdir(), 'ms-editor-enc-browser-'));
const chrome = spawn(process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws, call, evaluate;
const errors = [], requests = [];
try {
  let page;
  for (let i = 0; i < 60; i++) {
    try {
      const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page');
      if (page) break;
    } catch { /* Chrome is starting. */ }
    await pause(150);
  }
  assert.ok(page, 'Chrome did not start');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let next = 0;
  const pending = new Map();
  call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task?.reject(new Error(JSON.stringify(message.error))) : task?.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
  });
  evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 300; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(100); }
    throw new Error('Timed out: ' + expression);
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: base });
  await waitFor('document.querySelector(".maplibregl-map")');
  await evaluate(`(() => {
    const element = document.querySelector('.maplibregl-map');
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
    for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
      const value = hook.memoizedState?.current;
      if (value && typeof value.getZoom === 'function' && typeof value.getSource === 'function') { window.testMap = value; return; }
    }
    throw new Error('Map ref not found');
  })()`);
  await evaluate('void testMap.on("error",event=>{(window.portrayalErrors??=[]).push(event.error?.message)})');
  await waitFor('testMap.getLayer("enc-depth") && testMap.loaded() && testMap.queryRenderedFeatures().some(f=>f.source === "enc") && document.querySelector("[role=status]")?.textContent.includes("sẵn sàng")');
  const featureCount = await evaluate('testMap.queryRenderedFeatures().filter(f=>f.source === "enc").length');
  assert.ok(await evaluate('testMap.getStyle().sources.enc.tiles[0].includes("/api/enc/tiles/")'), 'local MVT source configured and rendered');
  assert.ok(!requests.some(url => /^https?:/.test(url) && new URL(url).origin !== new URL(base).origin), 'local viewer must not fetch external style, tiles or glyphs');
  await mkdir('../data/enc', { recursive: true });
  await writeFile('../data/enc/preview-day.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  for (const label of ['Chạng vạng', 'Đêm', 'Ngày']) {
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === ${JSON.stringify(label)}).click()`);
    await waitFor('testMap.loaded() && document.querySelector("[role=status]")?.textContent.includes("sẵn sàng")');
    await pause(150);
  }
  const classes = await evaluate('[...new Set(testMap.queryRenderedFeatures().map(f=>f.properties.object_class))]');
  const sounding = await evaluate('testMap.querySourceFeatures("enc",{sourceLayer:"enc"}).find(f=>f.properties.object_class==="SOUNDG")?.geometry.coordinates');
  assert.ok(sounding, 'local tile must contain soundings');
  await evaluate(`void testMap.jumpTo({center:${JSON.stringify(sounding)},zoom:15})`);
  await waitFor('testMap.loaded() && testMap.queryRenderedFeatures({layers:["enc-soundings"]}).length > 0');
  await writeFile('../data/enc/preview-soundings.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(300);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile layout must not overflow horizontally');
  await writeFile('../data/enc/preview-mobile.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  if (process.env.ENC_PORTRAYAL_FIXTURES === '1') {
    // Browser-only GeoJSON fixtures exercise symbols absent from the local ENC.
    // No source dataset, canonical row or API state is changed.
    await call('Emulation.setDeviceMetricsOverride', { width:1600,height:1100,deviceScaleFactor:1,mobile:false });
    const examples = [
      ['Submerged rock','UWTROC',{WATLEV:3}], ['Drying rock','UWTROC',{WATLEV:4}],
      ['Known depth 8m','UWTROC',{VALSOU:8,WATLEV:3}], ['Deep hazard 25m','OBSTRN',{VALSOU:25,WATLEV:3}],
      ['Isolated danger','WRECKS',{VALSOU:2,WATLEV:3,s52_surrounding_depth:12}],
      ['Red light','LIGHTS',{COLOUR:[3]}], ['Strip light','LIGHTS',{CATLIT:[9]}], ['Flood light','LIGHTS',{CATLIT:[8]}],
      ['Red sector 350–10','LIGHTS',{COLOUR:[3],SECTR1:350,SECTR2:10}],
      ['Green sector 45–135','LIGHTS',{COLOUR:[4],SECTR1:45,SECTR2:135}],
      ['Yellow sector 210–300','LIGHTS',{COLOUR:[6],SECTR1:210,SECTR2:300}],
      ['Major all-round light','LIGHTS',{COLOUR:[1],VALNMR:12}],
      ['Radio two-way','RDOCAL',{TRAFIC:4,ORIENT:45}], ['RoRo terminal','HRBFAC',{CATHAF:[1]}],
      ['Water tower','SILTNK',{CATSIL:4,CONVIS:1}], ['Special pillar buoy','BOYSPP',{BOYSHP:4}],
      ['Rescue station','RSCSTA',{}], ['Anchorage area','ACHARE',{s52_geometry:2}],
      ['Refinery area','PRDARE',{CATPRA:5,CONVIS:1,s52_geometry:2}],
      ['Position uncertain','UWTROC',{WATLEV:3,s52_quapos:4}],
      ['Drying height','SOUNDG',{DEPTH:-1.7}], ['Flood stream','TS_FEB',{CAT_TS:1,ORIENT:90}],
      ['Ebb stream','TS_FEB',{CAT_TS:2,ORIENT:90}], ['Customs','CHKPNT',{CATCHP:1}],
    ];
    for (const [label,theme] of [['Ngày','day'],['Chạng vạng','dusk'],['Đêm','night']]) {
      await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === ${JSON.stringify(label)}).click()`);
      await waitFor('testMap.loaded()');
      await evaluate(`(() => {
        const examples = ${JSON.stringify(examples)};
        testMap.resize(); testMap.setPadding({left:0,right:0,top:0,bottom:0}); testMap.jumpTo({center:[0,0],zoom:14,bearing:0});
        const features = examples.map(([name,object_class,attributes],index) => {
          const properties = {feature_id:'fixture-'+index,object_class,s52_geometry:0,...attributes};
          for (const [key,value] of Object.entries(attributes)) {
            const values = Array.isArray(value)?value:[value];
            properties['sym_'+key]=values[0]; properties['list_'+key]='|'+values.join('|')+'|';
          }
          const location = testMap.unproject([450+(index%5)*230,190+Math.floor(index/5)*180]);
          properties.fixture_label=name;
          return {type:'Feature',id:index,properties,geometry:{type:'Point',coordinates:[location.lng,location.lat]}};
        });
        const style = testMap.getStyle();
        const collection = features => ({type:'FeatureCollection',features});
        style.sources = {
          fixturesPoint:{type:'geojson',data:collection(features.filter(f=>f.properties.s52_geometry===0))},
          fixturesAnchor:{type:'geojson',data:collection(features.filter(f=>f.properties.s52_geometry>0))},
          fixtureLabels:{type:'geojson',data:collection(features)}
        };
        style.layers = style.layers.filter(layer => layer.type==='background'||(layer.source==='enc'&&['enc','enc_symbols'].includes(layer['source-layer'])));
        for (const layer of style.layers) if (layer.source==='enc') {
          layer.source=layer['source-layer']==='enc'?'fixturesPoint':'fixturesAnchor'; delete layer['source-layer'];
        }
        style.layers.push({id:'fixture-labels',type:'symbol',source:'fixtureLabels',layout:{'text-field':['get','fixture_label'],
          'text-font':['Roboto Bold'],'text-size':12,'text-offset':[0,5],'text-allow-overlap':true},paint:{'text-color':${JSON.stringify(theme==='day'?'#000000':'#B8C3CC')}}});
        testMap.setStyle(style);
      })()`);
      await waitFor(`testMap.loaded() && ${JSON.stringify([`s52-sector:${theme}:350:10:3`,`s52-sector:${theme}:45:135:4`,`s52-sector:${theme}:210:300:6`,`s52-sector:${theme}:0:360:1`])}.every(id=>testMap.hasImage(id))`);
      await pause(500); // Symbol fade starts after asynchronously generated images arrive.
      assert.ok(await evaluate('testMap.queryRenderedFeatures().filter(f=>f.source.startsWith("fixtures")).length>=20'));
      assert.ok(await evaluate('testMap.queryRenderedFeatures({layers:["enc-hazard-symbols"]}).length>=5'),'hazard symbols must coexist with their depth text');
      assert.equal(await evaluate('new Set(testMap.queryRenderedFeatures({layers:["enc-light-sectors"]}).map(f=>f.id)).size'),4,'all four dynamic light images must be placed, not just cached');
      await writeFile(`../data/enc/portrayal-fixtures-${theme}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await evaluate('window.portrayalErrors??[]'),[]);
  console.log(JSON.stringify({ passed: true, featureCount, classes, themes: 3, portrayalFixtures:process.env.ENC_PORTRAYAL_FIXTURES==='1', externalRequests: 0, errors }, null, 2));
} catch (error) {
  if (evaluate) console.error(await evaluate('document.body.innerText.slice(0,2500)').catch(() => 'Cannot inspect page'));
  if (evaluate) console.error(await evaluate('JSON.stringify({loaded:testMap.loaded(),images:testMap.listImages().filter(id=>id.startsWith("s52-sector:")),errors:window.portrayalErrors,sources:Object.keys(testMap.getStyle().sources)})').catch(() => 'Cannot inspect style'));
  throw error;
} finally {
  if (call) await call('Browser.close').catch(() => {});
  ws?.close(); chrome.kill();
}
