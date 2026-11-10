// Run against Vite with PLAYWRIGHT_MODULE pointing to an installed playwright module.
// All APIs are mocked; real Chrome, React, MapLibre and IndexedDB are exercised.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
const origin = process.env.EDITOR_URL || 'http://127.0.0.1:5178';
const errors = [];
const node = (id, version = 1) => ({ type: 'Feature', properties: { entityType: 'node', entityId: id, version, tags: { amenity: 'bench', name: id } }, geometry: { type: 'Point', coordinates: [105 + (Number(id) - 2) * 0.0003, 21] } });
async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', ...options });
  const api = { mode: 'success', creates: 0, uploads: 0, committed: false, version: 1 };
  ctx.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
  });
  await ctx.route('http://localhost:8081/**', route => route.abort());
  await ctx.route('**/api/**', route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (path === '/api/datasets') return route.fulfill({ json: { datasets: [{ id: 'review', name: 'review-ui', state: 'ready', bounds: [105, 21, 105.001, 21.001], canonicalRevision: 1, renderRevision: 1 }] } });
    if (path === '/api/publish-status') return route.fulfill({ json: { dataset: 'review-ui', status: 'published', canonicalRevision: 1, renderRevision: 1, pendingEvents: 0 } });
    if (path.includes('/mvt/')) return route.fulfill({ status: 204 });
    if (path === '/api/graph') return route.fulfill({ json: { canonicalRevision: 1, features: url.searchParams.get('part') === 'relations' ? [] : ['1', '2', '3'].map(id => node(id, api.version)) } });
    if (path === '/api/entities/snapshots') {
      const keys = route.request().postDataJSON().keys;
      return route.fulfill({ json: { snapshots: keys.map(key => ({ key, version: api.version, visible: true, feature: node(key.split('/')[1], api.version) })), support: [] } });
    }
    if (path.endsWith('/create')) { api.creates++; return route.fulfill({ json: { changeset: { id: '123', status: 'open' } } }); }
    if (path.endsWith('/upload')) {
      api.uploads++;
      if (api.mode === 'reject') return route.fulfill({ status: 400, json: { error: 'Test rejection' } });
      if (api.mode === 'lost-before' && api.uploads === 1) return route.abort();
      api.committed = true;
      if (api.mode === 'lost-after' && api.uploads === 1) return route.abort();
      if (api.mode === 'server-error-after' && api.uploads === 1) return route.fulfill({ status: 500, json: { error: 'Unknown commit outcome' } });
      return route.fulfill({ json: { changeset: { id: '123', status: 'committed', committedRevision: 2 } } });
    }
    if (path.startsWith('/api/0.6/changeset/')) return route.fulfill({ json: { changeset: { id: '123', status: path.endsWith('/close') ? 'closed' : api.committed ? 'committed' : 'open', ...(api.committed ? { committedRevision: 2 } : {}) } } });
    return route.fulfill({ json: { features: [] } });
  });
  return { ctx, api };
}
async function open(ctx) {
  const page = await ctx.newPage(); await page.goto(origin);
  await page.getByRole('button', { name: 'Quản lý bản nháp', exact: true }).waitFor();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  return page;
}
async function locate(page) {
  await page.getByRole('button', { name: 'Đi tới vị trí theo tọa độ', exact: true }).click();
  await page.getByPlaceholder('20.409586,106.1704618').fill('21,105');
  await page.getByRole('button', { name: 'Định vị', exact: true }).click();
  await page.waitForTimeout(1000);
}
async function duplicate(page) {
  const box = await page.locator('.maplibregl-canvas').boundingBox();
  await page.locator('.maplibregl-canvas').click({ position: { x: box.width / 2 - 0.0003 / 360 * 512 * 2 ** 18, y: box.height / 2 - 8 } });
  await page.locator('.maplibregl-canvas').click({ button: 'right', position: { x: 350, y: 200 } });
  await page.getByRole('menuitem', { name: 'Nhân bản', exact: false }).click();
}
const saved = page => page.getByRole('status').filter({ hasText: 'Đã lưu nháp trên máy' }).waitFor();
const saveButton = page => page.getByRole('button', { name: 'Lưu thay đổi', exact: false });
const read = page => page.evaluate(() => new Promise((resolve, reject) => {
  const r = indexedDB.open('geodata-editor-drafts', 1);
  r.onsuccess = () => { const db = r.result, q = db.transaction('drafts').objectStore('drafts').get('review:review-ui'); q.onsuccess = () => { resolve(q.result); db.close(); }; q.onerror = reject; };
  r.onerror = reject;
}));
const restore = page => page.getByRole('button', { name: 'Khôi phục bản nháp', exact: true }).click();
async function run(name, fn) { if (process.env.DRAFT_BROWSER_FILTER && !name.includes(process.env.DRAFT_BROWSER_FILTER)) return; await fn(); console.log(`PASS ${name}`); }
try {
  await run('core: reload, restore, IDs, undo/redo, discard, leave warning', async () => {
    const { ctx } = await context();
    try {
      const page = await open(ctx); await locate(page); await duplicate(page); await saved(page);
      assert.equal(Object.keys((await read(page)).state.overrides).length, 1);
      let leave = 0; page.on('dialog', d => { if (d.type() === 'beforeunload') leave++; });
      await page.reload(); await restore(page); await saved(page);
      assert.match(await saveButton(page).innerText(), /\(1\)/);
      await page.keyboard.press('Control+z'); assert.ok(await saveButton(page).isDisabled());
      await page.keyboard.press('Control+y'); assert.match(await saveButton(page).innerText(), /\(1\)/);
      await duplicate(page); await saved(page);
      assert.equal(Object.keys((await read(page)).state.overrides).length, 2);
      await page.reload(); await page.getByRole('button', { name: 'Xóa bản nháp', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Không có thay đổi cần lưu nháp' }).waitFor();
      assert.equal(await read(page), undefined); assert.ok(leave >= 1);
    } finally { await ctx.close(); }
  });
  await run('core: HTTP rejection retains draft, confirmed save clears it', async () => {
    const { ctx, api } = await context();
    try {
      const page = await open(ctx); await locate(page); await duplicate(page); await saved(page);
      api.mode = 'reject'; await saveButton(page).click(); await page.getByRole('status').filter({ hasText: 'Test rejection' }).waitFor();
      await saved(page); assert.ok(await read(page));
      api.mode = 'success'; await saveButton(page).click();
      await page.getByRole('status').filter({ hasText: 'Không có thay đổi cần lưu nháp' }).waitFor(); assert.equal(await read(page), undefined);
    } finally { await ctx.close(); }
  });
  await run('extras: unfinished sketch, camera, export/import on narrow screen', async () => {
    const { ctx } = await context();
    try {
      const page = await open(ctx); await locate(page); await page.keyboard.press('2');
      const canvas = page.locator('.maplibregl-canvas');
      await canvas.click({ position: { x: 250, y: 200 } }); await canvas.click({ position: { x: 320, y: 250 } }); await saved(page);
      const before = await read(page); assert.equal(before.workspace.vertices.length, 2); assert.equal(before.workspace.camera.zoom, 18);
      await page.reload(); await restore(page); await saved(page);
      assert.match(await page.locator('body').innerText(), /Đang vẽ đường \(2 điểm\)/);
      assert.deepEqual((await read(page)).workspace.vertices, before.workspace.vertices);
      await page.getByRole('button', { name: 'Quản lý bản nháp', exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      const downloadWait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Xuất bản sao JSON', exact: true }).click();
      const download = await downloadWait, stream = await download.createReadStream(), chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const backup = Buffer.concat(chunks); assert.equal(JSON.parse(backup).workspace.vertices.length, 2);
      assert.ok(await page.getByRole('button', { name: 'Đóng', exact: true }).isVisible());
      if (process.env.REVIEW_SCREENSHOTS) await page.screenshot({ path: '.impeccable/review/drafts-mobile.png' });
      await page.getByRole('button', { name: 'Đóng', exact: true }).click(); await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Quản lý bản nháp', exact: true }).click();
      await page.locator('input[type=file]').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: backup });
      await restore(page); await saved(page); assert.equal((await read(page)).workspace.vertices.length, 2);
      await page.keyboard.press('Enter'); await saved(page);
      assert.equal(Object.keys((await read(page)).state.overrides).length, 3);
    } finally { await ctx.close(); }
  });
  await run('extras: concurrent tabs cannot overwrite drafts; backup remains available', async () => {
    const { ctx } = await context();
    try {
      const a = await open(ctx), b = await open(ctx); await locate(a); await locate(b);
      await duplicate(a); await saved(a); const original = await read(a);
      await duplicate(b); await b.getByRole('status').filter({ hasText: 'Lỗi lưu nháp' }).waitFor();
      assert.equal((await read(a)).revision, original.revision);
      await b.getByRole('button', { name: 'Quản lý bản nháp', exact: true }).click();
      assert.match(await b.getByRole('dialog').innerText(), /tab khác/);
      assert.ok(await b.getByRole('button', { name: 'Xuất bản sao JSON', exact: true }).isEnabled());
    } finally { await ctx.close(); }
  });
  for (const mode of ['lost-after', 'lost-before', 'server-error-after']) await run(`extras: interrupted upload ${mode} never creates a second changeset`, async () => {
    const { ctx, api } = await context();
    try {
      const page = await open(ctx); await locate(page); await duplicate(page); await saved(page); api.mode = mode;
      await saveButton(page).click(); await page.getByRole('button', { name: 'Kiểm tra / Tiếp tục phiên lưu', exact: true }).waitFor();
      assert.equal((await read(page)).pendingUpload, '123');
      await page.reload(); await page.getByRole('button', { name: 'Kiểm tra / Tiếp tục phiên lưu', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Không có thay đổi cần lưu nháp' }).waitFor();
      assert.equal(await read(page), undefined); assert.equal(api.creates, 1); assert.equal(api.uploads, mode === 'lost-before' ? 2 : 1);
    } finally { await ctx.close(); }
  });
  await run('extras: blocked storage degrades explicitly and server save still works', async () => {
    const { ctx } = await context();
    try {
      await ctx.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: { open() { throw new Error('Storage denied'); } } }); });
      const page = await ctx.newPage(); await page.goto(origin);
      await page.getByRole('button', { name: 'Tiếp tục, chưa có bảo vệ nháp', exact: true }).click();
      await locate(page); await duplicate(page); await saveButton(page).click();
      await page.getByRole('status').filter({ hasText: 'Đã lưu các thay đổi thành công' }).waitFor();
      assert.ok(await saveButton(page).isDisabled());
    } finally { await ctx.close(); }
  });
  await run('hardening: quota error preserves previous draft; retry saves retained edits', async () => {
    const { ctx } = await context();
    try {
      const page = await open(ctx); await locate(page); await duplicate(page); await saved(page);
      const original = await read(page);
      await page.evaluate(() => { window.originalDraftPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('Quota test', 'QuotaExceededError'); }; });
      await duplicate(page); await page.getByRole('status').filter({ hasText: 'Lỗi lưu nháp' }).waitFor();
      assert.equal((await read(page)).revision, original.revision);
      await page.getByRole('button', { name: 'Quản lý bản nháp', exact: true }).click();
      assert.match(await page.getByRole('dialog').innerText(), /Quota test/);
      await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalDraftPut; });
      await page.getByRole('button', { name: 'Thử lưu nháp lại', exact: true }).click(); await page.getByRole('dialog').getByText('Đã lưu nháp trên máy', { exact: false }).waitFor();
      assert.equal(Object.keys((await read(page)).state.overrides).length, 2);
    } finally { await ctx.close(); }
  });
  await run('hardening: corrupt schema is not overwritten and can be exported', async () => {
    const { ctx } = await context();
    try {
      const page = await open(ctx); await locate(page); await duplicate(page); await saved(page);
      await page.evaluate(() => new Promise(resolve => {
        const r = indexedDB.open('geodata-editor-drafts', 1); r.onsuccess = () => {
          const db = r.result, tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts'), q = store.get('review:review-ui');
          q.onsuccess = () => store.put({ ...q.result, schema: 999 }, 'review:review-ui'); tx.oncomplete = () => { db.close(); resolve(); };
        };
      }));
      await page.reload(); await page.getByRole('dialog', { name: 'Không truy cập được bản nháp' }).waitFor();
      assert.ok(await page.getByRole('button', { name: 'Xuất bản sao JSON', exact: true }).isEnabled());
      assert.equal((await read(page)).schema, 999);
      await page.getByRole('button', { name: 'Tiếp tục, chưa có bảo vệ nháp', exact: true }).click();
      assert.equal((await read(page)).schema, 999);
    } finally { await ctx.close(); }
  });
  await run('hardening: changed server version opens existing conflict workflow on restore', async () => {
    const { ctx, api } = await context();
    try {
      const page = await open(ctx); await locate(page);
      const box = await page.locator('.maplibregl-canvas').boundingBox();
      await page.locator('.maplibregl-canvas').click({ position: { x: box.width / 2 - 0.0003 / 360 * 512 * 2 ** 18, y: box.height / 2 - 8 } });
      // Keep focus in the field: even text not yet committed by blur must survive.
      await page.getByRole('textbox', { name: 'Giá trị name', exact: true }).fill('Tên local'); await saved(page);
      assert.ok(await saveButton(page).isDisabled());
      api.version = 2; await page.reload(); await restore(page);
      await page.getByRole('dialog', { name: 'Dữ liệu đã được sửa trên server' }).waitFor();
      assert.match(await page.getByRole('dialog', { name: 'Dữ liệu đã được sửa trên server' }).innerText(), /server v2/);
      assert.equal((await read(page)).state.baseFeatures['node/1'].properties.version, 1);
      assert.equal((await read(page)).state.overrides['node/1'].properties.tags.name, 'Tên local');
      if (process.env.REVIEW_SCREENSHOTS) await page.screenshot({ path: '.impeccable/review/drafts-conflict-desktop.png' });
    } finally { await ctx.close(); }
  });
  await run('hardening: close an uncommitted interrupted session and restore for editing', async () => {
    const { ctx, api } = await context();
    try {
      const page = await open(ctx); await locate(page); await duplicate(page); await saved(page); api.mode = 'lost-before';
      await saveButton(page).click();
      await page.getByRole('button', { name: 'Đóng phiên chưa lưu để sửa nháp', exact: true }).click();
      await restore(page); await saved(page);
      assert.equal((await read(page)).pendingUpload, undefined);
      assert.match(await saveButton(page).innerText(), /\(1\)/);
      await saveButton(page).click(); await page.getByRole('status').filter({ hasText: 'Không có thay đổi cần lưu nháp' }).waitFor();
      assert.equal(api.creates, 2); assert.ok(api.committed);
    } finally { await ctx.close(); }
  });
  assert.deepEqual(errors, []); console.log('No uncaught page errors. Raster tile requests intentionally blocked.');
} finally { await browser.close(); }
