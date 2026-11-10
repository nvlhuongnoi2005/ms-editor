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
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, featureCount, classes, themes: 3, externalRequests: 0, errors }, null, 2));
} catch (error) {
  if (evaluate) console.error(await evaluate('document.body.innerText.slice(0,2500)').catch(() => 'Cannot inspect page'));
  throw error;
} finally {
  if (call) await call('Browser.close').catch(() => {});
  ws?.close(); chrome.kill();
}
