// Opt-in: build first, then `node scripts/zoom-browser-smoke.mjs`.
// Uses a local fixture server only; never reads or modifies a real dataset.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const center = [104.50728, 21.59988];
const node = { type: 'Feature', properties: { entityType: 'node', entityId: '1', version: 1, tags: { name: 'Selected POI', shop: 'motorcycle_repair' } }, geometry: { type: 'Point', coordinates: center } };
const other = { ...node, properties: { ...node.properties, entityId: '2' }, geometry: { type: 'Point', coordinates: [center[0] + .001, center[1] + .001] } };
const way = { type: 'Feature', properties: { entityType: 'way', entityId: '3', version: 1, tags: { highway: 'residential' }, nodeIds: ['4', '5'] }, geometry: { type: 'LineString', coordinates: [[center[0] - .001, center[1] - .001], [center[0] + .001, center[1] - .001]] } };
let omitSelected = false;
const graphRequests = [], unexpected = [];
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (req.method !== 'GET') { unexpected.push(`${req.method} ${url.pathname}`); res.writeHead(405).end(); return; }
  if (url.pathname === '/api/datasets') return json({ datasets: [{ id: 'fixture', name: 'zoom-fixture', state: 'ready', bounds: null, canonicalRevision: 1, renderRevision: 1 }] });
  if (url.pathname === '/api/publish-status') return json({ status: 'published', canonicalRevision: 1, renderRevision: 1, pendingEvents: 0 });
  if (url.pathname === '/api/graph') {
    graphRequests.push(url.href);
    return json({ canonicalRevision: 1, features: url.searchParams.get('part') === 'relations' ? [] : [...(omitSelected ? [] : [node]), other, way] });
  }
  if (url.pathname.startsWith('/api/mvt/')) { res.setHeader('Content-Type', 'application/x-protobuf'); res.end(); return; }
  if (url.pathname.startsWith('/api/')) { unexpected.push(url.pathname); res.writeHead(404).end(); return; }
  const path = resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!path.startsWith(resolve(dist) + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[extname(path)] ?? 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'ms-editor-zoom-ui-'));
const chrome = spawn(process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws, call, evaluate;
try {
  let page;
  for (let i = 0; i < 50; i++) {
    try {
      const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page');
      if (page) break;
    } catch { /* Chrome is starting. */ }
    await pause(200);
  }
  assert.ok(page, 'Chrome did not start');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let next = 0;
  const pending = new Map(), errors = [];
  call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const result = pending.get(message.id); pending.delete(message.id);
      message.error ? result?.reject(new Error(JSON.stringify(message.error))) : result?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    else if (message.method === 'Fetch.requestPaused') {
      // Avoid a dependency on the real satellite tile server.
      void call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
        body: Buffer.from(JSON.stringify({ tilejson: '2.2.0', tiles: [], minzoom: 0, maxzoom: 0 })).toString('base64') });
    }
  });
  evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async condition => {
    for (let i = 0; i < 150; i++) { if (await evaluate(`Boolean(${condition})`)) return; await pause(100); }
    throw new Error('Timed out: ' + condition);
  };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:8081/*' }] });
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: base });
  await waitFor('document.querySelector(".maplibregl-map")');
  // Inspect the component's existing ref; no production debug API is needed.
  await evaluate(`(() => {
    const element = document.querySelector('.maplibregl-map');
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
    for (; fiber; fiber = fiber.return) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const value = hook.memoizedState?.current;
        if (value && typeof value.getZoom === 'function' && typeof value.getSource === 'function') { window.testMap = value; return; }
      }
    }
    throw new Error('Map ref not found');
  })()`);
  await waitFor('testMap.getLayer("selection-origin-point-preview")');
  await evaluate('void testMap.jumpTo({zoom:18})');
  await waitFor('testMap.getLayer("graph-point") && testMap.queryRenderedFeatures({layers:["graph-point"]}).length');
  const point = await evaluate(`(() => { const p=testMap.project(${JSON.stringify(center)}),r=testMap.getCanvas().getBoundingClientRect(); return {x:r.left+p.x,y:r.top+p.y}; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await waitFor('(await testMap.getSource("editor-selection").getData()).features[0]?.properties.entityId === "1"');
  omitSelected = true;
  await evaluate('void testMap.jumpTo({zoom:12})');
  await waitFor('testMap.queryRenderedFeatures({layers:["graph-point-preview"]}).length && !(await testMap.getSource("canonical-graph").getData()).features.some(f=>f.properties.entityId==="1")');
  assert.equal(await evaluate('(await testMap.getSource("editor-selection").getData()).features[0]?.properties.entityId'), '1');
  assert.ok(await evaluate('testMap.queryRenderedFeatures({layers:["selection-origin-point-preview"]}).length'));
  await pause(200);
  const before = graphRequests.length;
  await evaluate('void testMap.jumpTo({zoom:11})');
  await waitFor('!(await testMap.getSource("canonical-graph").getData()).features.length');
  const pulseA = await evaluate('testMap.getPaintProperty("selection-halo-point-preview","circle-radius")');
  await pause(220);
  const pulseB = await evaluate('testMap.getPaintProperty("selection-halo-point-preview","circle-radius")');
  assert.notEqual(pulseA, pulseB, 'selected POI must keep pulsing below Z12');
  assert.ok(await evaluate('testMap.queryRenderedFeatures({layers:["selection-origin-point-preview"]}).length'));
  assert.equal(graphRequests.length, before, 'no graph request below Z12');
  assert.equal(await evaluate('testMap.queryRenderedFeatures({layers:["graph-line","graph-point-preview"]}).length'), 0);

  await evaluate('void testMap.jumpTo({zoom:16})');
  await waitFor('testMap.queryRenderedFeatures({layers:["graph-line"]}).length');
  const wayPoint = await evaluate(`(() => { const p=testMap.project([${center[0]},${center[1] - .001}]),r=testMap.getCanvas().getBoundingClientRect(); return {x:r.left+p.x,y:r.top+p.y}; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...wayPoint, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...wayPoint, button: 'left', clickCount: 1 });
  await waitFor('(await testMap.getSource("editor-selection").getData()).features[0]?.properties.entityId === "3"');
  await evaluate('void testMap.jumpTo({zoom:11})');
  await waitFor('testMap.queryRenderedFeatures({layers:["selection-origin-line"]}).length');
  const linePulseA = await evaluate('testMap.getPaintProperty("selection-halo-line","line-opacity")');
  await pause(220);
  const linePulseB = await evaluate('testMap.getPaintProperty("selection-halo-line","line-opacity")');
  assert.notEqual(linePulseA, linePulseB, 'selected way must keep pulsing below Z12');
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ passed: true, graphAt: 12, selectedVisibleAt: 11, pulseA, pulseB, linePulseA, linePulseB, graphRequests: graphRequests.length, errors }, null, 2));
} catch (error) {
  if (evaluate) console.error(await evaluate('document.body.innerText.slice(0,2000)').catch(() => 'Cannot inspect page'));
  throw error;
} finally {
  if (call) await call('Browser.close').catch(() => {});
  ws?.close(); chrome.kill(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
