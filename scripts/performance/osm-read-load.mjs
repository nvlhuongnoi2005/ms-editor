// Read-only workload. Requires explicit target; run on staging, never on login pages.
// node scripts/performance/osm-read-load.mjs
const base = process.env.EDITOR_LOAD_URL;
const dataset = process.env.EDITOR_LOAD_DATASET;
if (!base || !dataset) throw new Error('Set EDITOR_LOAD_URL and EDITOR_LOAD_DATASET to the staging target.');
const users = Number(process.env.EDITOR_LOAD_USERS || 50);
const seconds = Number(process.env.EDITOR_LOAD_SECONDS || 60);
if (!Number.isInteger(users) || users < 1 || users > 300 || !Number.isFinite(seconds) || seconds < 1 || seconds > 3600) throw new Error('Users: 1–300; seconds: 1–3600.');
const bbox = (process.env.EDITOR_LOAD_BBOX || '105,21,105.01,21.01').split(',').map(Number);
if (bbox.length !== 4 || bbox.some(v => !Number.isFinite(v)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3] || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -85 || bbox[3] > 85) throw new Error('Invalid EDITOR_LOAD_BBOX.');
const tiles = [];
const z = 14;
const x = Math.floor((bbox[0] + bbox[2] + 360) / 720 * 2 ** z);
const lat = (bbox[1] + bbox[3]) / 2 * Math.PI / 180;
const y = Math.floor((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * 2 ** z);
for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) tiles.push(`/api/mvt/${z}/${x + dx}/${y + dy}.pbf?${new URLSearchParams({ dataset })}`);
const latencies = new Map(), codes = new Map();
let bytes = 0, requests = 0, failures = 0;
const end = Date.now() + seconds * 1000;
const pause = ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, Math.max(0, end - Date.now()))));
async function request(path, kind) {
  const start = performance.now();
  let body = null;
  try {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(25_000), redirect: 'error' });
    codes.set(response.status, (codes.get(response.status) || 0) + 1);
    if (!response.ok) failures++;
    if (kind === 'status' && response.ok) { const text = await response.text(); bytes += Buffer.byteLength(text); body = JSON.parse(text); }
    else if (response.body) for await (const chunk of response.body) bytes += chunk.length;
  } catch { failures++; }
  requests++;
  const items = latencies.get(kind) || []; items.push(performance.now() - start); latencies.set(kind, items);
  return body;
}
await Promise.all(Array.from({ length: users }, async () => {
  let nextStatus = 0;
  await pause(Math.random() * 3000);
  while (Date.now() < end) {
    if (Date.now() >= nextStatus) {
      const state = await request(`/api/publish-status?${new URLSearchParams({ dataset })}`, 'status');
      nextStatus = Date.now() + (state?.status === 'published' ? 60_000 : 3000);
    }
    await Promise.all(tiles.map(tile => request(tile, 'tile')));
    for (const part of ['geometry', 'relations']) await request(`/api/graph?${new URLSearchParams({ dataset, bbox: bbox.join(','), part, limit: '1200' })}`, 'graph');
    await pause(5000 + Math.random() * 5000);
  }
}));
const timing = Object.fromEntries([...latencies].map(([kind, values]) => {
  values.sort((a, b) => a - b);
  return [kind, { requests: values.length, p50ms: Math.round(values[Math.floor((values.length - 1) * .5)]), p95ms: Math.round(values[Math.floor((values.length - 1) * .95)]), p99ms: Math.round(values[Math.floor((values.length - 1) * .99)]) }];
}));
console.log(JSON.stringify({ users, seconds, requests, failures, bytes, http: Object.fromEntries(codes), timing }, null, 2));
if (failures) process.exitCode = 1;
