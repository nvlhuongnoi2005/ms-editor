import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadSource } from './test-source.mjs';

const { ViewportGraphLoader } = await import(await loadSource('../src/features/map/ViewportGraphLoader.ts'));
const rules = await readFile(new URL('../src/features/map/style-rules.json', import.meta.url), 'utf8');
const rulesURL = `data:text/javascript;base64,${Buffer.from(`export default ${rules}`).toString('base64')}`;
const styleURL = await loadSource('../src/features/map/styleRules.ts', { './style-rules.json': rulesURL });
const { GraphTileHandoff, renderCollection } = await import(await loadSource('../src/features/map/graphRendering.ts', { './styleRules': styleURL }));
const { loadGraph } = await import(await loadSource('../src/api/graph.ts'));
const bbox = [106.175, 20.388, 106.185, 20.397];
const elsewhere = [107, 21, 107.01, 21.01];
const feature = (id, type = 'node') => ({ type: 'Feature', properties: { entityType: type, entityId: String(id), version: 1, name: 'Test', tags: { name: 'Test' } }, geometry: { type: 'Point', coordinates: [106.18, 20.39] } });
const response = (features = [], canonicalRevision = 1) => ({ features, canonicalRevision });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function setup(load) {
  const shown = [], relations = [], loading = [], errors = [], calls = [];
  const loader = new ViewportGraphLoader({
    load: (...args) => { calls.push(args); return load(...args); },
    onFeatures: value => shown.push(value), onRelations: value => relations.push(value),
    onLoading: value => loading.push(value), onError: value => errors.push(value)
  });
  return { loader, shown, relations, loading, errors, calls };
}

test('geometry is visible and interactive while relations are still loading', async () => {
  const pending = deferred(), geometry = [feature(1)], relation = [feature(2, 'relation')];
  const s = setup(async (_bbox, _signal, part) => part === 'geometry' ? response(geometry) : pending.promise);
  const loading = s.loader.refresh(bbox);
  await tick();
  assert.strictEqual(s.shown[0], geometry);
  assert.equal(s.loading.at(-1), false);
  assert.deepEqual(s.calls.map(call => call[2]), ['geometry', 'relations']);
  assert.strictEqual(s.loader.refresh(bbox), loading);
  assert.equal(s.calls[0][1].aborted, false);
  pending.resolve(response(relation));
  await loading;
  assert.deepEqual(s.relations, [relation]);
  await s.loader.refresh(bbox);
  assert.equal(s.shown.length, 1, 'cache must not hydrate the same graph again');
  assert.equal(s.calls.length, 2);
});

test('same buffered viewport deduplicates in-flight geometry requests', async () => {
  const pending = deferred();
  const s = setup(async (_bbox, _signal, part) => part === 'geometry' ? pending.promise : response());
  const first = s.loader.refresh(bbox);
  assert.strictEqual(s.loader.refresh([106.176, 20.389, 106.184, 20.396]), first);
  assert.equal(s.calls.length, 1);
  pending.resolve(response([feature(1)]));
  await first;
});

test('returning to a cached viewport cancels and ignores a newer stale request', async () => {
  let slow = false;
  const pending = deferred();
  const s = setup(async (_bbox, _signal, part) => slow
    ? (part === 'geometry' ? response([feature(9)]) : pending.promise)
    : response(part === 'geometry' ? [feature(1)] : [feature(2, 'relation')]));
  await s.loader.refresh(bbox);
  slow = true;
  const abandoned = s.loader.refresh(elsewhere);
  await tick();
  const signal = s.calls.at(-1)[1];
  await s.loader.refresh(bbox);
  assert.equal(signal.aborted, true);
  assert.deepEqual(s.shown.at(-1).map(item => item.properties.entityId), ['1', '2']);
  const count = s.shown.length;
  pending.resolve(response([feature(99)]));
  await abandoned;
  assert.equal(s.shown.length, count);
  assert.equal(s.loading.at(-1), false);
});

test('cancel ignores an aborted response even if fetch does not honor its signal', async () => {
  const pending = deferred(), s = setup(() => pending.promise);
  const first = s.loader.refresh(bbox);
  s.loader.cancel();
  pending.resolve(response([feature(1)]));
  await first;
  assert.equal(s.shown.length, 0);
  assert.equal(s.calls.length, 1);
  assert.equal(s.errors.filter(Boolean).length, 0);
});

test('invalidation after save ignores late relations and requests a fresh geometry baseline', async () => {
  const pending = deferred();
  const s = setup(async (_bbox, _signal, part) => part === 'geometry' ? response([feature(1)]) : pending.promise);
  const first = s.loader.refresh(bbox);
  await tick();
  s.loader.invalidate();
  pending.resolve(response([feature(2, 'relation')]));
  await first;
  assert.equal(s.relations.length, 0);
  await s.loader.refresh(bbox);
  assert.equal(s.calls.filter(call => call[2] === 'geometry').length, 2);
});

test('failed relations retain geometry and retry without fetching geometry again', async () => {
  let fail = true;
  const s = setup(async (_bbox, _signal, part) => {
    if (part === 'relations' && fail) throw new Error('Offline');
    return response(part === 'geometry' ? [feature(1)] : [feature(2, 'relation')]);
  });
  await s.loader.refresh(bbox);
  assert.match(s.errors.at(-1), /relation: Offline/);
  assert.equal(s.shown.length, 1);
  fail = false;
  await s.loader.refresh(bbox);
  assert.deepEqual(s.calls.map(call => call[2]), ['geometry', 'relations', 'relations']);
  assert.equal(s.shown.length, 1);
  assert.equal(s.errors.at(-1), null);
  assert.equal(s.relations.length, 1);
});

test('failed geometry is not cached and loading always finishes', async () => {
  const s = setup(async () => { throw new Error('Offline'); });
  await s.loader.refresh(bbox);
  await s.loader.refresh(bbox);
  assert.equal(s.calls.length, 2);
  assert.equal(s.shown.length, 0);
  assert.equal(s.loading.at(-1), false);
});

test('different canonical revisions are never combined', async () => {
  const s = setup(async (_bbox, _signal, part) => response([feature(1, part === 'geometry' ? 'node' : 'relation')], part === 'geometry' ? 1 : 2));
  await s.loader.refresh(bbox);
  assert.equal(s.relations.length, 0);
  assert.match(s.errors.at(-1), /server đã thay đổi/);
  await s.loader.refresh(bbox);
  assert.equal(s.calls.filter(call => call[2] === 'geometry').length, 2);
});

test('empty relations do not clone or hydrate the graph again', async () => {
  const geometry = [feature(1)];
  const s = setup(async (_bbox, _signal, part) => response(part === 'geometry' ? geometry : []));
  await s.loader.refresh(bbox);
  await s.loader.refresh(bbox);
  assert.deepEqual(s.shown, [geometry]);
  assert.equal(s.relations.length, 0);
});

test('viewport cache is bounded to eight entries', async () => {
  const s = setup(async () => response());
  for (let i = 0; i < 9; i++) await s.loader.refresh([100 + i, 20, 100.01 + i, 20.01]);
  await s.loader.refresh([100, 20, 100.01, 20.01]);
  assert.equal(s.calls.filter(call => call[2] === 'geometry').length, 10);
});

test('graph API explicitly requests geometry and relations using the caller signal', async () => {
  const previous = globalThis.fetch, calls = [], controller = new AbortController();
  try {
    globalThis.fetch = async (url, options) => { calls.push([url, options]); return { ok: true, json: async () => response() }; };
    await loadGraph(bbox, controller.signal, 'geometry');
    await loadGraph(bbox, controller.signal, 'relations');
    assert.equal(new URL(calls[0][0], 'http://localhost').searchParams.get('part'), 'geometry');
    assert.equal(new URL(calls[1][0], 'http://localhost').searchParams.get('part'), 'relations');
    assert.strictEqual(calls[0][1].signal, controller.signal);
  } finally { globalThis.fetch = previous; }
});

test('an older API returning the full graph cannot duplicate progressive entities', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => response([feature(1), feature(2, 'relation')]) });
    const geometry = await loadGraph(bbox, undefined, 'geometry');
    const relations = await loadGraph(bbox, undefined, 'relations');
    assert.deepEqual([...geometry.features, ...relations.features].map(item => item.properties.entityId), ['1', '2']);
    assert.equal((await loadGraph(bbox)).features.length, 2);
  } finally { globalThis.fetch = previous; }
});

function tileMap() {
  const layers = new Set(['mvt-way-line', 'mvt-label']), filters = new Map(), calls = [];
  return { layers, filters, calls, getLayer: id => layers.has(id), setFilter: (id, filter) => { filters.set(id, filter); calls.push(id); } };
}
const excluded = (map, layer = 'mvt-way-line') => {
  let filter = map.filters.get(layer);
  if (layer === 'mvt-label') filter = filter[2];
  return filter[1][2][1];
};

test('tile handoff keeps MVT until GeoJSON worker AND visible tiles are ready', () => {
  const map = tileMap(), handoff = new GraphTileHandoff(map);
  const token = handoff.begin(new Set());
  assert.deepEqual(excluded(map), []);
  handoff.rendered(true);
  assert.deepEqual(excluded(map), []);
  handoff.settled(token, [feature(10, 'way')]);
  handoff.rendered(false);
  assert.deepEqual(excluded(map), []);
  handoff.rendered(true);
  assert.deepEqual(excluded(map), ['10']);
});

test('dirty and deleted entities suppress stale tiles immediately', () => {
  const map = tileMap(), handoff = new GraphTileHandoff(map);
  handoff.begin(new Set(['way/99', 'node/88']));
  assert.deepEqual(excluded(map), ['99']);
  map.layers.add('mvt-point');
  handoff.sync();
  assert.deepEqual(excluded(map, 'mvt-point'), ['88']);
  assert.deepEqual(map.filters.get('mvt-way-line')[1][1], ['to-string', ['get', 'entity_id']]);
});

test('tile handoff ignores stale source completions and skips identical filters', () => {
  const map = tileMap(), handoff = new GraphTileHandoff(map);
  const old = handoff.begin(new Set());
  const latest = handoff.begin(new Set());
  handoff.settled(old, [feature(1, 'way')]);
  handoff.rendered(true);
  assert.deepEqual(excluded(map), []);
  handoff.settled(latest, [feature(2, 'way')]);
  handoff.rendered(true);
  assert.deepEqual(excluded(map), ['2']);
  const count = map.calls.length;
  handoff.sync();
  const same = handoff.begin(new Set());
  handoff.settled(same, [feature(2, 'way'), feature(3, 'relation')]);
  handoff.rendered(true);
  assert.equal(map.calls.length, count);
});

test('map worker payload keeps geometry/style but excludes editing metadata', () => {
  const input = feature(1, 'way');
  input.properties.nodes = [{ id: '1', coordinates: [106,20], version: 1, tags: { name: 'Node' } }];
  input.properties.nodeIds = ['1'];
  input.properties.parents = [{ id: '2' }];
  const before = structuredClone(input), output = renderCollection([input]).features[0];
  assert.strictEqual(output.geometry, input.geometry);
  assert.equal(output.properties.entityId, '1');
  assert.equal(output.properties.name, 'Test');
  assert.equal(typeof output.properties.editorColor, 'string');
  for (const key of ['tags', 'nodes', 'nodeIds', 'parents', 'members']) assert.equal(key in output.properties, false);
  assert.deepEqual(input, before);
});
