// Real Chrome, MapLibre and shared IndexedDB drafts; isolated ENC API fixtures.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.EDITOR_URL || 'http://127.0.0.1:5189';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
const revision = 'TESTCELL-E1-U0-R1';
const attributes = [{ key: 'OBJNAM', label: 'Tên đối tượng', kind: 'text' }, { key: 'INFORM', label: 'Thông tin', kind: 'text' }, { key: 'SCAMIN', label: 'Mẫu số tỷ lệ hiển thị tối thiểu', kind: 'number' }];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [], commits = [], receipts = new Map(), documents = new Map();
    let credentials, version = 0, loseResponse = false, creates = 0;
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (!path.startsWith('/api/')) return route.continue();
      if (path === '/api/enc/datasets') return route.fulfill({ json: { datasets: [], catalogRevision: 1 } });
      if (path === '/api/enc/cells') return route.fulfill({ json: { cells: [{ name: 'TESTCELL', description: 'Hải đồ kiểm thử', revisionId: revision, edition: 1, updateNumber: 0, bounds: [105, 21, 105.01, 21.01], focus: [105.005, 21.005] }] } });
      if (path === '/api/enc/regions') return route.fulfill({ json: { type: 'FeatureCollection', features: [] } });
      if (path.startsWith('/api/enc/tiles/')) return route.fulfill({ status: 204 });
      if (path.includes('/workspaces/') && path.includes('/tiles/')) {
        assert.equal(request.headers()['x-enc-workspace-token'], credentials.token);
        return route.fulfill({ status: 204 });
      }
      if (path === '/api/enc/workspaces') {
        const body = request.postDataJSON();
        assert.equal(request.headers()['x-editor-import'], '1');
        if (!credentials) { credentials = body; creates++; }
        assert.deepEqual(body, credentials);
        return route.fulfill({ json: { id: credentials.id } });
      }
      if (path === `/api/enc/workspaces/${credentials?.id}`) return route.fulfill({ json: { id: credentials.id, baseRevision: revision, cellName: 'TESTCELL', version, sourceChanged: false, features: [...documents.values()], attributes, pointClasses: ['LNDMRK', 'BOYLAT', 'LIGHTS'] } });
      if (path.endsWith('/commits')) {
        const body = request.postDataJSON(); commits.push(body);
        assert.equal(request.headers()['x-enc-workspace-token'], credentials.token);
        const existing = receipts.get(body.requestId);
        if (existing) assert.deepEqual(existing.body, body);
        else {
          assert.equal(body.expectedVersion, version);
          for (const change of body.changes) if (change.after) documents.set(change.key, change.after); else documents.delete(change.key);
          version++; receipts.set(body.requestId, { body, version });
        }
        if (loseResponse) { loseResponse = false; return route.abort('failed'); }
        return route.fulfill({ json: { version: receipts.get(body.requestId).version, requestId: body.requestId } });
      }
      return route.fulfill({ status: 404, json: { error: 'Unknown fixture route ' + path } });
    });
    // Only use local assets; basemap is optional for editing tests.
    await context.route('**/datas/**', route => route.fulfill({ status: 204 }));
    await context.route('**/enc/basemap/**', route => route.fulfill({ status: 204 }));
    await context.route('**/enc/assets/sprites/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      const file = name.includes('@2x') ? name : name.replace(/\.(png|json)$/, '@2x.$1');
      return route.fulfill({ body: await readFile(new URL(`../../ENC/sprites/${file}`, import.meta.url)), contentType: name.endsWith('.json') ? 'application/json' : 'image/png' });
    });
    await context.route('**/enc/assets/fonts/**', async route => {
      const relative = new URL(route.request().url()).pathname.split('/fonts/')[1];
      return route.fulfill({ body: await readFile(new URL(`../../ENC/fonts/${relative}`, import.meta.url)), contentType: 'application/x-protobuf' });
    });
    await page.goto(origin + '/?mode=enc');
    await page.locator('.maplibregl-map').waitFor();
    if (width < 700) await page.getByRole('button', { name: 'Mở bảng hiển thị hải đồ' }).click();
    await page.getByLabel('Phạm vi hiển thị').click();
    await page.getByRole('option', { name: 'Hải đồ kiểm thử · TESTCELL' }).click();
    if (width < 700) await page.getByRole('button', { name: 'Thu gọn bảng hải đồ' }).click();
    await page.getByRole('button', { name: 'Biên tập cell', exact: true }).click();
    await page.getByRole('button', { name: 'Thêm điểm', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Thêm điểm', exact: true }).click();
    await page.mouse.click(width < 700 ? 170 : 800, width < 700 ? 560 : 440);
    const inspector = page.getByRole('region', { name: 'Chỉnh sửa đối tượng ENC' });
    await inspector.waitFor();
    await inspector.getByLabel('Tên đối tượng (OBJNAM)', { exact: true }).fill('Điểm kiểm thử');
    await inspector.getByLabel('Kinh độ', { exact: true }).fill('105.123456789');
    await inspector.getByLabel('Vĩ độ', { exact: true }).fill('21.987654321');
    await inspector.getByRole('button', { name: 'Áp dụng tọa độ' }).click();
    // Capture a meaningful editing state and assert both layouts fit.
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.REVIEW_SCREENSHOTS) {
      await mkdir(process.env.REVIEW_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: `${process.env.REVIEW_SCREENSHOTS}/enc-editing-${width}.png` });
    }
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByText('Đã lưu thay đổi vào không gian biên tập.', { exact: true }).waitFor();
    assert.equal(documents.size, 1);
    assert.deepEqual([...documents.values()][0].geometry.coordinates, [105.123456789, 21.987654321]);
    await page.getByRole('button', { name: 'Hoàn tác ENC' }).click();
    await inspector.getByLabel('Kinh độ', { exact: true }).waitFor();
    assert.notEqual(await inspector.getByLabel('Kinh độ', { exact: true }).inputValue(), '105.123456789');
    await page.getByRole('button', { name: 'Làm lại ENC' }).click();
    assert.equal(await inspector.getByLabel('Kinh độ', { exact: true }).inputValue(), '105.123456789');
    await inspector.getByLabel('Tên đối tượng (OBJNAM)', { exact: true }).fill('Sau mất kết nối');
    loseResponse = true;
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Kiểm tra lần lưu' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Tiếp tục bản biên tập' }).click();
    await page.getByRole('button', { name: 'Kiểm tra lần lưu' }).click();
    await page.getByText('Đã lưu thay đổi vào không gian biên tập.', { exact: true }).waitFor();
    assert.equal(creates, 1, 'reload reused workspace');
    assert.equal(receipts.size, 2, 'lost response did not duplicate a commit');
    assert.deepEqual(commits.at(-1), commits.at(-2));
    // After reload, select a persisted overlay point using MapLibre's public event API.
    await page.evaluate(() => {
      let fiber = document.querySelector('.maplibregl-map')[Object.keys(document.querySelector('.maplibregl-map')).find(key => key.startsWith('__reactFiber$'))];
      for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const map = hook.memoizedState?.current;
        if (map && typeof map.getSource === 'function') { window.encTestMap = map; return; }
      }
      throw new Error('Map ref missing');
    });
    const point = [...documents.values()][0];
    await page.evaluate(coordinates => { window.encTestMap.jumpTo({ center: coordinates }); }, point.geometry.coordinates);
    await page.waitForFunction(() => window.encTestMap.getLayer('enc-edits-points') && window.encTestMap.queryRenderedFeatures({ layers: ['enc-edits-points'] }).length > 0);
    await page.evaluate(coordinates => {
      const map = window.encTestMap, point = map.project(coordinates);
      map.fire('click', { point, lngLat: { lng: coordinates[0], lat: coordinates[1] }, originalEvent: new MouseEvent('click') });
    }, point.geometry.coordinates);
    await inspector.waitFor();
    await inspector.getByRole('button', { name: 'Xóa điểm', exact: true }).click();
    await inspector.getByRole('button', { name: 'Xóa', exact: true }).click();
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByText('Đã lưu thay đổi vào không gian biên tập.', { exact: true }).waitFor();
    assert.equal(documents.size, 0, 'deleted local point removed from workspace');
    // Two ENC tabs must never overwrite one another's draft silently.
    const other = await context.newPage();
    other.on('pageerror', error => errors.push(error.message));
    other.on('dialog', dialog => dialog.accept());
    await other.goto(origin + '/?mode=enc');
    await other.getByRole('button', { name: 'Tiếp tục bản biên tập' }).click();
    await other.getByRole('button', { name: 'Thêm điểm', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Thêm điểm', exact: true }).click();
    await page.mouse.click(width < 700 ? 170 : 800, width < 700 ? 560 : 440);
    await page.getByRole('region', { name: 'Chỉnh sửa đối tượng ENC' }).waitFor();
    // Wait for this tab's CAS write before the stale tab attempts its write.
    await page.waitForTimeout(200);
    await other.getByRole('button', { name: 'Thêm điểm', exact: true }).click();
    await other.mouse.click(width < 700 ? 170 : 800, width < 700 ? 560 : 440);
    await other.getByText(/Bản nháp đã thay đổi ở tab khác/).waitFor();
    assert.ok(await other.getByRole('button', { name: 'Lưu', exact: true }).isDisabled());
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`ENC editing browser passed at ${width}px: create, exact position, save, undo/redo, reload, retry, delete, multi-tab CAS`);
  }
} finally { await browser.close(); }
