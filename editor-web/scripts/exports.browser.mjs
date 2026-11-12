// Real Chrome/OPFS, bounded Range responses and an OPFS-backed save picker.
// EDITOR_URL points to Vite. API data is isolated from the actual editor DB.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
const origin = process.env.EDITOR_URL || 'http://127.0.0.1:5186';
const jobId = 'a1111111-2222-4333-8444-555555555555';
const block = Buffer.alloc(32 * 1024 ** 2, 0x5a), total = block.length * 2;
const digest = createHash('sha256').update(block).update(block).digest('hex');
const waitUntil = async condition => { for (let i = 0; i < 150; i++) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Condition timed out'); };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    let state = null, creates = 0, listRequests = 0, hold = true, wrongETag = false, corruptBody = false;
    let pausedExport = false;
    const ranges = [], held = [], errors = [];
    await context.addInitScript(() => {
      window.__saveCalls = 0;
      window.__slowSave = false;
      window.showSaveFilePicker = async () => {
        window.__saveCalls++;
        const handle = await (await navigator.storage.getDirectory()).getFileHandle('verification-final.pbf', { create: true });
        return { createWritable: async () => {
          const target = await handle.createWritable();
          return new WritableStream({
            async write(chunk) { if (window.__slowSave) await new Promise(resolve => setTimeout(resolve, 25)); await target.write(chunk); },
            close() { return target.close(); }, abort(reason) { return target.abort(reason); },
          });
        } };
      };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const path = url.pathname;
      if (!path.startsWith('/api/')) return route.continue();
      if (path === '/api/datasets') return route.fulfill({ json: { datasets: [{ id: 'review', name: 'export-review', state: 'ready', bounds: [105, 21, 106, 22], canonicalRevision: 7, renderRevision: 7 }] } });
      if (path === '/api/publish-status') return route.fulfill({ json: { canonicalRevision: 7, renderRevision: 7, pendingEvents: 0, status: 'published' } });
      if (path.startsWith('/api/mvt/')) return route.fulfill({ status: 204 });
      if (path === '/api/exports' && route.request().method() === 'GET') {
        listRequests++;
        return route.fulfill({ json: { workerOnline: true, jobs: [{ id: 'old-failed-job', state: 'failed', error: 'old failure must stay hidden' }] } });
      }
      if (path === '/api/exports' && route.request().method() === 'POST') {
        assert.equal(url.searchParams.get('dataset'), 'export-review');
        assert.equal(url.searchParams.has('bbox'), false);
        assert.equal(route.request().headers()['x-editor-import'], '1');
        creates++; state = 'queued'; pausedExport = false;
        return route.fulfill({ status: 202, json: { id: jobId } });
      }
      if (path === `/api/exports/${jobId}`) return route.fulfill({ json: { id: jobId, state, pauseRequested: pausedExport, phase: pausedExport ? 'paused' : state === 'running' ? 'writing' : state, totalCount: 100, cancelRequested: false, revision: 7, entityCount: state === 'running' ? 50 : 100, bytes: total, sha256: digest, created_at: '2026-11-12T01:00:00Z' } });
      if (path.endsWith('/pause') || path.endsWith('/resume')) {
        assert.equal(route.request().method(), 'POST');
        assert.equal(route.request().headers()['x-editor-import'], '1');
        pausedExport = path.endsWith('/pause');
        return route.fulfill({ status: 202, json: { state, pauseRequested: pausedExport } });
      }
      if (path.endsWith('/cancel')) {
        assert.equal(route.request().method(), 'POST');
        assert.equal(route.request().headers()['x-editor-import'], '1');
        state = 'cancelled';
        return route.fulfill({ status: 202, json: { state } });
      }
      if (path.endsWith('/file')) {
        const range = route.request().headers().range;
        assert.equal(route.request().headers()['if-range'], `"${digest}"`);
        ranges.push(range);
        if (hold && range !== `bytes=0-${block.length - 1}`) { held.push(route); return; }
        const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range);
        const body = corruptBody && Number(start) === 0 ? Buffer.from(block) : block;
        if (body !== block) body[0] ^= 1;
        return route.fulfill({ status: 206, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(Number(end) - Number(start) + 1), 'Content-Range': `bytes ${start}-${end}/${total}`, ETag: `"${wrongETag ? 'changed' : digest}"` }, body });
      }
      return route.fulfill({ json: { features: [], canonicalRevision: 7 } });
    });
    const open = async () => {
      await page.getByRole('button', { name: 'Xuất dữ liệu bản đồ' }).click();
      await page.getByRole('menuitem').filter({ hasText: 'Tải toàn bộ dữ liệu' }).click();
      await page.getByRole('dialog').waitFor();
    };
    const capture = async suffix => {
      const dialog = page.getByRole('dialog');
      assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.REVIEW_SCREENSHOTS) {
        await mkdir(process.env.REVIEW_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: join(process.env.REVIEW_SCREENSHOTS, `exports-${suffix}-${width}.png`), animations: 'disabled' });
      }
    };
    const cache = () => page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names = []; for await (const name of root.keys()) if (name.startsWith('osm-download-')) names.push(name);
      const entries = []; let checkpoint = null, bytes = 0;
      for (const name of names) {
        const directory = await root.getDirectoryHandle(name);
        for await (const entry of directory.keys()) {
          entries.push(entry);
          const file = await (await directory.getFileHandle(entry)).getFile();
          if (entry === 'checkpoint.json') checkpoint = JSON.parse(await file.text());
          if (entry === 'data.partial') bytes = file.size;
        }
      }
      return { entries, checkpoint, bytes };
    });
    await page.goto(`${origin}/?mode=osm`); await open();
    assert.equal(await page.getByText('old failure must stay hidden').count(), 0);
    assert.equal(listRequests, 0);
    await page.getByRole('button', { name: 'Tạo file PBF', exact: true }).click();
    await page.getByText('Đang chờ xuất…', { exact: true }).waitFor();
    state = 'running';
    await page.getByText('50% · Đã xuất 50 / 100 đối tượng', { exact: true }).waitFor();
    assert.equal(await page.getByRole('progressbar', { name: 'Tiến độ xuất dữ liệu' }).getAttribute('aria-valuenow'), '50');
    await capture('exporting');
    await page.getByRole('button', { name: 'Tạm dừng', exact: true }).evaluate(button => { button.dataset.toggleIdentity = 'server-export'; });
    await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
    await page.getByText('Đã tạm dừng xuất', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Tiếp tục', exact: true }).getAttribute('data-toggle-identity'), 'server-export');
    await capture('export-paused');
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await page.getByText('50% · Đã xuất 50 / 100 đối tượng', { exact: true }).waitFor();
    await page.reload(); await open();
    await page.getByText('Đã tạm dừng xuất', { exact: true }).waitFor();
    assert.equal(creates, 1);
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await page.getByText('50% · Đã xuất 50 / 100 đối tượng', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Xóa', exact: true }).click();
    await page.getByText('Chọn “Tạo file PBF” để bắt đầu.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Đã dừng xuất', { exact: false }).count(), 0);
    await page.getByRole('button', { name: 'Tạo file PBF', exact: true }).click();
    await page.getByText('Đang chờ xuất…', { exact: true }).waitFor();
    state = 'ready';
    await page.getByRole('button', { name: 'Đóng', exact: true }).click(); await open();
    const download = page.getByRole('button', { name: 'Tải .osm.pbf', exact: true });
    await download.waitFor(); await download.click();
    await waitUntil(() => ranges.length >= 2);
    await page.getByRole('button', { name: 'Tạm dừng', exact: true }).evaluate(button => { button.dataset.toggleIdentity = 'preserved'; });
    await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
    await page.getByText('Đã tạm dừng tải', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Tiếp tục', exact: true }).getAttribute('data-toggle-identity'), 'preserved');
    assert.equal(await page.getByRole('button', { name: 'Tiếp tục', exact: true }).evaluate(button => button.parentElement.querySelectorAll('button').length), 2);
    assert.equal((await cache()).checkpoint.offset, block.length);
    assert.equal((await cache()).bytes, block.length);
    await capture('paused');
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await waitUntil(() => ranges.length >= 3);
    // Reload while actively fetching. No fetch may restart before Resume.
    await page.reload(); await open();
    await page.getByText('Đã tạm dừng tải', { exact: true }).waitFor();
    const beforeResume = ranges.length;
    await page.waitForTimeout(1200);
    assert.equal(ranges.length, beforeResume);
    assert.equal((await cache()).checkpoint.offset, block.length);
    assert.equal(creates, 2);
    hold = false;
    // Pause on the worker's verification event, even on a fast test machine.
    await page.evaluate(async () => {
      const { getPBFDownload } = await import('/src/features/editor/pbfDownload.ts');
      const manager = getPBFDownload('export-review');
      const unsubscribe = manager.subscribe(() => {
        if (manager.getSnapshot().mode === 'verifying') { unsubscribe(); void manager.pause(); }
      });
    });
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await waitUntil(async () => (await cache()).checkpoint.offset === total);
    await page.getByText('Đã tạm dừng tải', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Lưu tệp về máy', exact: true }).count(), 0);
    const beforeVerificationResume = ranges.length;
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await page.getByRole('button', { name: 'Lưu tệp về máy', exact: true }).waitFor();
    assert.equal(ranges.length, beforeVerificationResume); // Re-hash cache, no re-download.
    assert.equal(ranges.at(-1), `bytes=${block.length}-${total - 1}`);
    assert.equal((await cache()).checkpoint.offset, total);
    await page.evaluate(() => { window.__slowSave = true; });
    await page.getByRole('button', { name: 'Lưu tệp về máy', exact: true }).click();
    await page.getByText('Đang lưu tệp về máy…', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
    await page.getByText('Đã tạm dừng tải', { exact: true }).waitFor();
    assert.equal((await cache()).checkpoint.offset, total);
    const savesBeforeResume = await page.evaluate(() => window.__saveCalls);
    await page.evaluate(() => { window.__slowSave = false; });
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await page.getByText('Đã lưu tệp về máy.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__saveCalls), savesBeforeResume);
    assert.equal(ranges.length, beforeVerificationResume);
    const savedDigest = await page.evaluate(async () => {
      const file = await (await (await navigator.storage.getDirectory()).getFileHandle('verification-final.pbf')).getFile();
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    });
    assert.equal(savedDigest, digest);
    assert.deepEqual((await cache()).entries, []);
    // Stop while downloading removes both checkpoint and bytes.
    hold = true; const beforeStop = ranges.length;
    await download.click(); await waitUntil(() => ranges.length >= beforeStop + 2);
    await page.getByRole('button', { name: 'Xóa', exact: true }).click();
    await page.getByText('Chọn “Tạo file PBF” để bắt đầu.', { exact: true }).waitFor();
    assert.deepEqual((await cache()).entries, []);
    const afterStop = ranges.length;
    await page.reload(); await open();
    await page.waitForTimeout(500);
    assert.equal(await page.getByRole('button', { name: 'Tiếp tục', exact: true }).count(), 0);
    assert.equal(ranges.length, afterStop);
    // A same-size body with the expected ETag still must pass SHA-256.
    await page.getByRole('button', { name: 'Tạo file PBF', exact: true }).click();
    await page.getByText('Đang chờ xuất…', { exact: true }).waitFor(); state = 'ready';
    await page.getByRole('button', { name: 'Đóng', exact: true }).click(); await open();
    corruptBody = true; hold = false;
    await download.click();
    await page.getByText('Kiểm tra toàn vẹn không thành công.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Tải bằng trình duyệt', exact: true }).count(), 0);
    await capture('checksum-failed');
    assert.equal((await cache()).checkpoint.offset, total);
    assert.equal(await page.getByRole('button', { name: 'Lưu tệp về máy', exact: true }).count(), 0);
    const beforeSaveCalls = await page.evaluate(() => window.__saveCalls);
    await page.evaluate(async () => { const { getPBFDownload } = await import('/src/features/editor/pbfDownload.ts'); await getPBFDownload('export-review').save(); });
    assert.equal(await page.evaluate(() => window.__saveCalls), beforeSaveCalls);
    await page.getByRole('button', { name: 'Xóa', exact: true }).click();
    await page.getByText('Chọn “Tạo file PBF” để bắt đầu.', { exact: true }).waitFor();
    assert.deepEqual((await cache()).entries, []);
    corruptBody = false;
    // Never append data if the server no longer identifies the same file.
    await page.getByRole('button', { name: 'Tạo file PBF', exact: true }).click();
    await page.getByText('Đang chờ xuất…', { exact: true }).waitFor(); state = 'ready';
    await page.getByRole('button', { name: 'Đóng', exact: true }).click(); await open();
    wrongETag = true; hold = false;
    await download.click();
    await page.getByText('Không thể tiếp tục đúng file đã chọn.', { exact: false }).waitFor();
    assert.equal((await cache()).checkpoint.offset, 0);
    assert.equal((await cache()).bytes, 0);
    await page.getByRole('button', { name: 'Xóa', exact: true }).click();
    await page.getByText('Chọn “Tạo file PBF” để bắt đầu.', { exact: true }).waitFor();
    wrongETag = false;
    // Chrome can round storage.estimate(); a real quota write failure must
    // still pause safely and roll back to the last durable checkpoint.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 96 * 1024 ** 2 });
    await page.getByRole('button', { name: 'Tạo file PBF', exact: true }).click();
    await page.getByText('Đang chờ xuất…', { exact: true }).waitFor(); state = 'ready';
    await page.getByRole('button', { name: 'Đóng', exact: true }).click(); await open();
    const beforeQuota = ranges.length;
    await download.click();
    await page.getByText('Không đủ dung lượng lưu tạm.', { exact: false }).waitFor();
    assert.ok(ranges.length <= beforeQuota + 1);
    assert.equal((await cache()).checkpoint.offset, 0);
    assert.equal((await cache()).bytes, 0);
    await page.getByRole('button', { name: 'Xóa', exact: true }).click();
    await page.getByText('Chọn “Tạo file PBF” để bắt đầu.', { exact: true }).waitFor();
    await cdp.send('Storage.overrideQuotaForOrigin', { origin }); await cdp.detach();
    // Current-session failure is a warning, never a historical row on reopen.
    await page.getByRole('button', { name: 'Tạo file PBF', exact: true }).click();
    await page.getByText('Đang chờ xuất…', { exact: true }).waitFor(); state = 'failed';
    await page.getByText('Xuất file chưa thành công. Bạn có thể thử tạo lại file.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Đóng', exact: true }).click(); await open();
    assert.equal(await page.getByText('Xuất file chưa thành công.', { exact: false }).count(), 0);
    assert.equal(listRequests, 0);
    assert.deepEqual(errors, []);
    for (const route of held) await route.abort().catch(() => {});
    await context.close();
    console.log(`PASS: session UI, OPFS pause/reload, Range resume, SHA-256 gate, hash pause/resume, save, stop deletion, ${width}px`);
  }
} finally { await browser.close(); }
