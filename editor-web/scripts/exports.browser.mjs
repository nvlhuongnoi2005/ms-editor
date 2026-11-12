// Real browser with mocked API; run against Vite using EDITOR_URL.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
const origin = process.env.EDITOR_URL || 'http://127.0.0.1:5186';
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    let state = null;
    let creates = 0;
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const path = url.pathname;
      if (!path.startsWith('/api/')) return route.continue();
      if (path === '/api/datasets') return route.fulfill({ json: { datasets: [{ id: 'review', name: 'export-review', state: 'ready', bounds: [105, 21, 106, 22], canonicalRevision: 7, renderRevision: 7 }] } });
      if (path === '/api/publish-status') return route.fulfill({ json: { canonicalRevision: 7, renderRevision: 7, pendingEvents: 0, status: 'published' } });
      if (path.startsWith('/api/mvt/')) return route.fulfill({ status: 204 });
      if (path === '/api/exports' && route.request().method() === 'POST') {
        assert.equal(url.searchParams.get('dataset'), 'export-review');
        assert.equal(url.searchParams.has('bbox'), false);
        assert.equal(url.searchParams.has('limit'), false);
        assert.equal(route.request().headers()['x-editor-import'], '1');
        creates++;
        state = 'queued';
        return route.fulfill({ status: 202, json: { id: 'job' } });
      }
      if (path === '/api/exports') return route.fulfill({ json: { workerOnline: true, jobs: state ? [{ id: 'job', state, revision: state === 'queued' ? null : 7, entityCount: state === 'queued' ? 0 : 100000000, bytes: 100 * 1024 ** 3, sha256: 'a'.repeat(64), error: null, created_at: '2026-11-12T01:00:00Z' }] : [] } });
      if (path.endsWith('/file')) return route.fulfill({ headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="export-review-r7.osm.pbf"' }, body: 'test-pbf' });
      return route.fulfill({ json: { features: [], canonicalRevision: 7 } });
    });
    await page.goto(`${origin}/?mode=osm`);
    await page.getByRole('button', { name: 'Xuất dữ liệu bản đồ' }).click();
    assert.equal(await page.getByText('Toàn bộ đối tượng trong vùng đang xem', { exact: true }).count(), 0);
    await page.getByRole('menuitem').filter({ hasText: 'Tải toàn bộ dữ liệu' }).click();
    await page.getByRole('button', { name: 'Tạo file PBF', exact: true }).click();
    await page.getByText('Đang chờ xuất', { exact: true }).waitFor();
    assert.equal(creates, 1);
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    state = 'ready';
    await page.getByRole('button', { name: 'Xuất dữ liệu bản đồ' }).click();
    await page.getByRole('menuitem').filter({ hasText: 'Tải toàn bộ dữ liệu' }).click();
    const link = page.getByRole('link', { name: 'Tải .osm.pbf · 100 GiB' });
    await link.waitFor();
    const dialog = page.getByRole('dialog');
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.REVIEW_SCREENSHOTS) {
      await mkdir(process.env.REVIEW_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: join(process.env.REVIEW_SCREENSHOTS, `exports-${width}.png`), animations: 'disabled' });
    }
    const downloaded = page.waitForEvent('download');
    await link.click();
    assert.equal((await downloaded).suggestedFilename(), 'export-review-r7.osm.pbf');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS: full dataset export, reopen, native download, ${width}px`);
  }
} finally { await browser.close(); }
