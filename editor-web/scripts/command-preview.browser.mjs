import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
const errors = [];
const coords = { 1: [104.9994, 21], 2: [105, 21], 3: [105, 21.0006], 4: [104.9994, 21.0006], 5: [105.0005, 21.0002], 6: [104.9998, 21.00015], 7: [105.0004, 21.00015], 8: [105.0004, 21.00075], 9: [104.9998, 21.00075] };
const node = (id, coordinates, poi = false) => ({ type: 'Feature', properties: { entityType: 'node', entityId: String(id), version: 1, tags: poi ? { amenity: 'bench' } : {}, topologyNode: !poi }, geometry: { type: 'Point', coordinates } });
const way = (id, refs, area = true) => ({ type: 'Feature', properties: { entityType: 'way', entityId: String(id), version: 1, tags: area ? { area: 'yes', name: `Vùng ${id}` } : { highway: 'service' }, nodeIds: refs.map(String), nodes: refs.map(id => ({ id: String(id), version: 1, tags: {}, coordinates: coords[id] })) }, geometry: area ? { type: 'Polygon', coordinates: [refs.map(id => coords[id])] } : { type: 'LineString', coordinates: refs.map(id => coords[id]) } });
const geometry = [way(10, [1, 2, 3, 4, 1]), way(20, [2, 5], false), way(30, [6, 7, 8, 9, 6]), node(101, [105.0006, 21.0005], true), node(102, [105.0009, 21.0005], true)];
const relation = { ...node(40, coords[2]), properties: { entityType: 'relation', entityId: '40', version: 1, tags: { type: 'collection' }, members: [{ type: 'way', ref: '20', role: '', sequence: 0 }] } };
async function setup(width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', d => d.accept());
  await page.route('http://localhost:8081/**', route => route.abort());
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (path === '/api/datasets') return route.fulfill({ json: { datasets: [{ id: 'preview', name: 'preview-ui', state: 'ready', bounds: [105, 21, 105.001, 21.001], canonicalRevision: 1, renderRevision: 1 }] } });
    if (path === '/api/publish-status') return route.fulfill({ json: { status: 'published', canonicalRevision: 1, renderRevision: 1, pendingEvents: 0 } });
    if (path.includes('/mvt/')) return route.fulfill({ status: 204 });
    if (path === '/api/graph') return route.fulfill({ json: { canonicalRevision: 1, features: url.searchParams.get('part') === 'relations' ? [relation] : geometry } });
    return route.fulfill({ json: { snapshots: [], support: [], features: [] } });
  });
  await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5178');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Đi tới vị trí theo tọa độ', exact: true }).click();
  await page.getByPlaceholder('20.409586,106.1704618').fill('21.0003,105'); await page.getByRole('button', { name: 'Định vị', exact: true }).click();
  await page.waitForTimeout(1200);
  return { ctx, page };
}
async function clickGeo(page, coordinate, ctrl = false) {
  const box = await page.locator('.maplibregl-canvas').boundingBox(), scale = 512 * 2 ** 18 / 360;
  const y = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  await page.locator('.maplibregl-canvas').click({ position: { x: box.width / 2 + (coordinate[0] - 105) * scale, y: box.height / 2 - (y(coordinate[1]) - y(21.0003)) * 512 * 2 ** 18 / (2 * Math.PI) - 8 }, modifiers: ctrl ? ['Control'] : [] });
  await page.waitForTimeout(150);
}
async function dragGeo(page, coordinate, dx = 40, dy = 25) {
  const box = await page.locator('.maplibregl-canvas').boundingBox(), scale = 512 * 2 ** 18 / 360;
  const y = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const x = box.x + box.width / 2 + (coordinate[0] - 105) * scale;
  const sy = box.y + box.height / 2 - (y(coordinate[1]) - y(21.0003)) * 512 * 2 ** 18 / (2 * Math.PI);
  await page.mouse.move(x, sy); await page.mouse.down(); await page.mouse.move(x + dx, sy + dy, { steps: 8 }); await page.mouse.up();
}
async function tool(page, name) {
  await page.locator('.maplibregl-canvas').click({ button: 'right', position: { x: 300, y: 150 } });
  await page.getByRole('menuitem', { name, exact: false }).click();
}
const record = page => page.evaluate(() => new Promise(resolve => {
  const r = indexedDB.open('geodata-editor-drafts', 1); r.onsuccess = () => { const db = r.result, q = db.transaction('drafts').objectStore('drafts').get('preview:preview-ui'); q.onsuccess = () => { resolve(q.result); db.close(); }; };
}));
const saved = page => page.getByRole('status').filter({ hasText: 'Đã lưu nháp trên máy' }).waitFor();
async function run(name, fn) { if (process.env.PREVIEW_FILTER && !name.includes(process.env.PREVIEW_FILTER)) return; await fn(); console.log(`PASS ${name}`); }
try {
  await run('preview cancel, no-op, shared scope, confirmation reset, commit and undo', async () => {
    const { ctx, page } = await setup();
    try {
      await clickGeo(page, [104.99955, 21.0004]); await tool(page, 'Biến đổi hình học');
      const panel = page.getByRole('dialog', { name: 'Biến đổi hình học' });
      await panel.getByRole('button', { name: 'Xoay', exact: true }).click();
      assert.ok(await panel.getByRole('button', { name: 'Áp dụng góc xoay', exact: true }).isDisabled());
      await panel.getByRole('spinbutton', { name: 'Góc xoay (°)', exact: true }).fill('90');
      await panel.getByText('Xem trước · Chưa thay đổi dữ liệu', { exact: true }).waitFor();
      assert.match(await panel.innerText(), /1 đường\/vùng dùng chung node, 1 relation/);
      assert.ok(await panel.getByRole('button', { name: 'Áp dụng góc xoay', exact: true }).isDisabled());
      await page.waitForTimeout(350); assert.equal(await record(page), undefined);
      await panel.getByRole('checkbox').check();
      await panel.getByRole('spinbutton', { name: 'Góc xoay (°)', exact: true }).fill('45');
      await page.waitForFunction(() => !document.querySelector('input[type="checkbox"]')?.checked); assert.ok(!(await panel.getByRole('checkbox').isChecked()));
      await panel.getByRole('button', { name: 'Hủy', exact: true }).click(); await page.waitForTimeout(300); assert.equal(await record(page), undefined);
      await tool(page, 'Biến đổi hình học'); await panel.getByRole('button', { name: 'Xoay', exact: true }).click();
      await panel.getByRole('spinbutton', { name: 'Góc xoay (°)', exact: true }).fill('90'); await panel.getByRole('checkbox').check();
      if (process.env.REVIEW_SCREENSHOTS) await page.screenshot({ path: '.impeccable/review/command-preview-desktop.png' });
      await panel.getByRole('button', { name: 'Áp dụng góc xoay', exact: true }).click(); await panel.waitFor({ state: 'hidden' }); await saved(page);
      const committed = await record(page); assert.equal(committed.state.undoStack.length, 1); assert.ok(Object.keys(committed.state.overrides).some(key => key.startsWith('node/')));
      await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
      assert.ok(await page.getByRole('button', { name: 'Lưu thay đổi', exact: false }).isDisabled());
    } finally { await ctx.close(); }
  });
  await run('area preview uses deterministic IDs and preserves input areas', async () => {
    const { ctx, page } = await setup();
    try {
      await clickGeo(page, [104.99955, 21.0004]); await clickGeo(page, [105.00025, 21.0006], true); await tool(page, 'Phép toán vùng');
      const panel = page.getByRole('dialog', { name: 'Phép toán vùng' });
      await panel.getByRole('button', { name: 'Gộp vùng', exact: true }).click(); await panel.getByRole('radio').first().check();
      await panel.getByText('Xem trước · Chưa thay đổi dữ liệu', { exact: true }).waitFor(); await page.waitForTimeout(300);
      assert.equal(await record(page), undefined);
      await panel.getByRole('button', { name: 'Tạo vùng kết quả', exact: true }).click(); await saved(page);
      const result = await record(page); assert.ok(result.state.overrides['way/-1']); assert.equal(result.state.overrides['way/10'], undefined); assert.equal(result.state.overrides['way/30'], undefined);
      assert.equal(result.state.undoStack.length, 1);
    } finally { await ctx.close(); }
  });
  await run('multi-delete confirmation cancel and confirm; shortcut follows same guard', async () => {
    const { ctx, page } = await setup();
    try {
      await clickGeo(page, [105.0006, 21.0005]); await clickGeo(page, [105.0009, 21.0005], true);
      await page.keyboard.press('Delete'); const confirmation = page.getByRole('dialog', { name: 'Kiểm tra trước khi xóa' });
      await confirmation.waitFor(); await confirmation.getByRole('button', { name: 'Hủy', exact: true }).click(); await page.waitForTimeout(300); assert.equal(await record(page), undefined);
      await page.keyboard.press('Delete'); await confirmation.getByRole('button', { name: 'Xác nhận xóa', exact: true }).click(); await saved(page);
      assert.equal((await record(page)).state.overrides['node/101'], null); assert.equal((await record(page)).state.overrides['node/102'], null);
      await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click(); assert.ok(await page.getByRole('button', { name: 'Lưu thay đổi', exact: false }).isDisabled());
    } finally { await ctx.close(); }
  });
  await run('responsive panel leaves map visible and cancels with Escape', async () => {
    const { ctx, page } = await setup();
    try {
      await clickGeo(page, [104.99955, 21.0004]); await tool(page, 'Biến đổi hình học'); await page.setViewportSize({ width: 390, height: 844 });
      const panel = page.getByRole('dialog', { name: 'Biến đổi hình học' }); await panel.getByRole('button', { name: 'Xoay', exact: true }).click();
      await panel.getByRole('spinbutton', { name: 'Góc xoay (°)', exact: true }).fill('90'); await panel.getByText('Xem trước · Chưa thay đổi dữ liệu', { exact: true }).waitFor();
      const box = await panel.boundingBox(); assert.ok(box.width <= 390 && box.y > 200 && box.y + box.height <= 844);
      if (process.env.REVIEW_SCREENSHOTS) await page.screenshot({ path: '.impeccable/review/command-preview-mobile.png' });
      await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' }); assert.equal(await record(page), undefined);
    } finally { await ctx.close(); }
  });
  await run('dragging a feature or shared vertex requests confirmation without changing data on cancel', async () => {
    const { ctx, page } = await setup();
    try {
      await clickGeo(page, [104.99955, 21.0004]); await dragGeo(page, [104.99955, 21.0004]);
      const confirmation = page.getByRole('dialog', { name: 'Kiểm tra trước khi di chuyển' });
      await confirmation.waitFor(); await page.waitForTimeout(300); assert.equal(await record(page), undefined);
      await confirmation.getByRole('button', { name: 'Hủy', exact: true }).click();
      await dragGeo(page, [105, 21]); await confirmation.waitFor();
      await confirmation.getByRole('button', { name: 'Hủy', exact: true }).click(); assert.equal(await record(page), undefined);
      await dragGeo(page, [104.99955, 21.0004]); await confirmation.getByRole('button', { name: 'Xác nhận di chuyển', exact: true }).click(); await saved(page);
      assert.equal((await record(page)).state.undoStack.length, 1);
      await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click(); assert.ok(await page.getByRole('button', { name: 'Lưu thay đổi', exact: false }).isDisabled());
    } finally { await ctx.close(); }
  });
  await run('locked shared node reports its ID before applying and invalid inputs disable apply', async () => {
    const { ctx, page } = await setup();
    try {
      await clickGeo(page, [104.99955, 21.0004]); await tool(page, 'Khóa đối tượng / layer');
      const locks = page.getByRole('dialog', { name: 'Khóa đối tượng / layer' });
      await locks.getByRole('button', { name: 'Cả layer', exact: true }).click(); await locks.getByRole('radio', { name: 'Đường', exact: true }).check();
      await locks.getByRole('button', { name: 'Khóa layer', exact: true }).click();
      await clickGeo(page, [104.99955, 21.0004]); await tool(page, 'Biến đổi hình học');
      const panel = page.getByRole('dialog', { name: 'Biến đổi hình học' }); await panel.getByRole('button', { name: 'Xoay', exact: true }).click();
      await panel.getByRole('spinbutton', { name: 'Góc xoay (°)', exact: true }).fill('90');
      await panel.getByRole('status').filter({ hasText: 'node/2' }).waitFor(); assert.ok(await panel.getByRole('button', { name: 'Áp dụng góc xoay', exact: true }).isDisabled());
      await panel.getByRole('spinbutton', { name: 'Góc xoay (°)', exact: true }).fill('');
      await panel.getByRole('status').filter({ hasText: 'Nhập một giá trị số hợp lệ' }).waitFor();
      await panel.getByRole('button', { name: 'Hủy', exact: true }).click(); assert.equal(await record(page), undefined);
    } finally { await ctx.close(); }
  });
  assert.deepEqual(errors, []); console.log('No uncaught page errors; APIs mocked, raster tiles intentionally blocked.');
} finally { await browser.close(); }
