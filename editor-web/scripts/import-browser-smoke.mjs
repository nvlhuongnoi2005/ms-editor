// Opt-in: run against the isolated import fixture API, never submits a Save.
// Needs two ready datasets and an installed Chromium/Chrome browser.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'ms-editor-import-ui-'));
const chrome = spawn(process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=9334', '--user-data-dir=' + profile, '--no-first-run', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
let dump;
try {
  let page;
  for (let i = 0; i < 30; i++) {
    try { page = (await (await fetch('http://127.0.0.1:9334/json')).json()).find(item => item.type === 'page'); if (page) break; } catch { /* starting */ }
    await pause(200);
  }
  assert.ok(page, 'Chrome did not start');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let next = 0;
  const pending = new Map(), errors = [], urls = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const result = pending.get(message.id); pending.delete(message.id);
      message.error ? result?.reject(new Error(JSON.stringify(message.error))) : result?.resolve(message.result);
    } else if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/api/')) urls.push(message.params.request.url);
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  dump = () => evaluate('JSON.stringify({body:document.body.innerText.slice(0,5000),buttons:[...document.querySelectorAll("button")].map(b=>({text:b.innerText,disabled:b.disabled})),dialogs:[...document.querySelectorAll("[role=dialog]")].length})');
  const waitFor = async condition => {
    for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${condition})`)) return; await pause(100); }
    throw new Error('Timed out: ' + condition);
  };
  await call('Page.enable'); await call('Network.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: process.env.IMPORT_TEST_URL ?? 'http://127.0.0.1:4174/' });
  await waitFor('document.querySelector("canvas") && document.body.innerText.includes("Import PBF")'); await pause(1800);
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.innerText.includes("Import PBF")).click()');
  await waitFor('document.querySelector("#datasets-title")');
  await waitFor('[...document.querySelectorAll("[role=dialog] button")].some(b=>b.textContent.includes("editor"))');
  const manager = JSON.parse(await evaluate('JSON.stringify({title:!!document.querySelector("#datasets-title"),uploadInput:!!document.querySelector("input[type=file]")})'));
  await evaluate('[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent.includes("editor")).click()');
  await waitFor('!document.querySelector("#datasets-title") && document.querySelector("canvas")'); await pause(1800);
  const activeUrl = await evaluate('location.href');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Digit1' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Digit1' }); await pause(150);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 800, y: 450, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 800, y: 450, button: 'left', clickCount: 1 });
  await waitFor('[...document.querySelectorAll("button")].some(b=>b.innerText.includes("(1)"))');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.innerText.includes("Import PBF")).click()');
  await waitFor('document.querySelector("#datasets-title")'); await pause(300);
  const guard = JSON.parse(await evaluate('JSON.stringify({switchButtons:[...document.querySelectorAll("[role=dialog] button")].filter(b=>b.textContent.includes("editor")).map(b=>({disabled:b.disabled})),draftStillPresent:[...document.querySelectorAll("button")].some(b=>b.innerText.includes("(1)"))})'));
  assert.ok(manager.uploadInput);
  assert.ok(guard.switchButtons.length && guard.switchButtons.every(button => button.disabled));
  assert.ok(guard.draftStillPresent);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const graphRequests = urls.filter(url => url.includes('/api/graph'));
  assert.ok(new Set(graphRequests.map(url => new URL(url).searchParams.get('dataset'))).size >= 2);
  console.log(JSON.stringify({ manager, activeUrl, guard, graphRequests, errors }, null, 2));
  await call('Browser.close').catch(() => {});
} catch (error) {
  if (dump) console.error(await dump().catch(() => 'Cannot inspect page'));
  throw error;
} finally {
  ws?.close(); chrome.kill();
}
