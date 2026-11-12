import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './test-source.mjs';

const graphURL = await loadSource('../src/features/topology/graph.ts');
const graph = await import(graphURL);
const { ViewportGraphLoader } = await import(await loadSource('../src/features/map/ViewportGraphLoader.ts'));
const { PublishStatusPoller } = await import(await loadSource('../src/api/publish.ts'));
const { editorReducer, initialState, executeTransaction, pendingChanges, MAX_UNDO_TRANSACTIONS } = await import(await loadSource('../src/features/editor/EditorStore.tsx', {
  react: import.meta.resolve('react'), 'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  './conflictResolution': await loadSource('../src/features/editor/conflictResolution.ts'),
  './geometryLocks': await loadSource('../src/features/editor/geometryLocks.ts'),
}));
const node = (id, lon = 105, name = '') => ({ type: 'Feature', properties: { entityType: 'node', entityId: String(id), version: 1, tags: { name } }, geometry: { type: 'Point', coordinates: [lon, 21] } });

test('indexed snapping matches exhaustive search including ties, missing nodes and long segments', () => {
  let seed = 12345;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
  const nodes = new Map(Array.from({ length: 2000 }, (_, id) => [String(id), { id: String(id), coordinate: [random() * 10, random() * 10] }]));
  const ways = new Map(Array.from({ length: 1000 }, (_, id) => [String(id), { id: String(id), nodeRefs: [String(id), String(id + 1)], tags: {} }]));
  ways.set('missing', { id: 'missing', nodeRefs: ['none', '1'], tags: {} });
  const topology = graph.prepareTopologyGraph({ nodes, ways });
  for (let query = 0; query < 100; query++) {
    const point = [random() * 10, random() * 10], radius = query % 10 ? 0.1 : Infinity;
    let nearestNode, nearestSegment, distance = radius ** 2;
    for (const node of nodes.values()) {
      const next = graph.squaredDistance(point, node.coordinate);
      if (next < distance) { nearestNode = node; distance = next; }
    }
    for (const way of ways.values()) for (let index = 0; index < way.nodeRefs.length - 1; index++) {
      const start = nodes.get(way.nodeRefs[index])?.coordinate, end = nodes.get(way.nodeRefs[index + 1])?.coordinate;
      if (!start || !end) continue;
      const coordinate = graph.projectToSegment(point, start, end), distanceSquared = graph.squaredDistance(point, coordinate);
      if (distanceSquared <= radius ** 2 && (!nearestSegment || distanceSquared < nearestSegment.distanceSquared)) nearestSegment = { wayId: way.id, segmentIndex: index, coordinate, distanceSquared };
    }
    assert.deepEqual(graph.findNearestNode(topology, point, radius), nearestNode);
    assert.deepEqual(graph.findNearestSegment(topology, point, radius), nearestSegment);
  }
  const tied = { nodes: new Map([['a', { id: 'a', coordinate: [1, 0] }], ['b', { id: 'b', coordinate: [-1, 0] }]]), ways: new Map() };
  assert.equal(graph.findNearestNode(tied, [0, 0], 2).id, 'a');
  assert.equal(graph.findNearestNode(tied, [0, 0], 1), undefined);
});

test('bounded undo retains dirty baselines and saved changes after old history is trimmed', () => {
  let state = editorReducer(initialState, { type: 'hydrate', features: [node(1)] });
  for (let index = 1; index <= 300; index++) state = executeTransaction(state, [{ key: 'node/1', feature: node(1, 105, String(index)) }], 'Edit').state;
  assert.equal(state.undoStack.length, MAX_UNDO_TRANSACTIONS);
  assert.equal(pendingChanges(state)[0].before.properties.tags.name, '');
  assert.equal(pendingChanges(state)[0].after.properties.tags.name, '300');
  for (let index = 0; index < MAX_UNDO_TRANSACTIONS; index++) state = editorReducer(state, { type: 'undo' });
  assert.equal(state.overrides['node/1'].properties.tags.name, '150');
  assert.equal(pendingChanges(state)[0].before.properties.tags.name, '');
  assert.equal(pendingChanges(state)[0].after.properties.tags.name, '150');
  for (let index = 0; index < MAX_UNDO_TRANSACTIONS; index++) state = editorReducer(state, { type: 'redo' });
  assert.equal(state.overrides['node/1'].properties.tags.name, '300');
});

test('viewport budget and observed revisions force fresh fetches without caching oversized responses', async () => {
  let revision = 1, loads = 0;
  const loader = new ViewportGraphLoader({ maxCacheBytes: 1, load: async (_bbox, _signal, part) => { loads++; return { canonicalRevision: revision, features: part === 'geometry' ? [node(1)] : [] }; }, onFeatures() {}, onRelations() {}, onLoading() {}, onError() {} });
  const bbox = [105, 21, 105.01, 21.01];
  await loader.refresh(bbox); await loader.refresh(bbox);
  assert.equal(loads, 4);
  assert.equal(loader.observeRevision(2), true); revision = 2;
  assert.equal(loader.observeRevision(1), false);
  await loader.refresh(bbox);
  assert.equal(loads, 6);
});

test('publish polling serializes refreshes, stops when hidden and ignores responses after disposal', async () => {
  const visibility = new EventTarget(); visibility.visibilityState = 'visible';
  const pending = [], statuses = [];
  const poller = new PublishStatusPoller(signal => new Promise(resolve => pending.push({ signal, resolve })), value => statuses.push(value), visibility);
  try {
    poller.refresh(); poller.refresh();
    assert.equal(pending.length, 1);
    const value = { status: 'published', canonicalRevision: 1, renderRevision: 1 };
    pending[0].resolve(value); await new Promise(resolve => setImmediate(resolve));
    assert.equal(pending.length, 2);
    visibility.visibilityState = 'hidden'; visibility.dispatchEvent(new Event('visibilitychange'));
    assert.equal(pending[1].signal.aborted, true);
    pending[1].resolve(value); await new Promise(resolve => setImmediate(resolve));
    assert.equal(statuses.length, 1);
    visibility.visibilityState = 'visible'; visibility.dispatchEvent(new Event('visibilitychange'));
    assert.equal(pending.length, 3);
    poller.dispose(); pending[2].resolve(value); await new Promise(resolve => setImmediate(resolve));
    assert.equal(statuses.length, 1);
  } finally { poller.dispose(); }
});

test('idle publish polling waits 60 seconds; pending work and manual saves use fast polling', async t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  t.mock.method(Math,'random',()=>0.5);
  const visibility=new EventTarget(); visibility.visibilityState='visible';
  let requests=0, status='published';
  const poller=new PublishStatusPoller(async()=>{requests++;return {status,canonicalRevision:1,renderRevision:1};},()=>{},visibility);
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  try {
    await flush(); assert.equal(requests,1);
    t.mock.timers.tick(59_999); await flush(); assert.equal(requests,1);
    t.mock.timers.tick(1); await flush(); assert.equal(requests,2);
    status='pending'; poller.refresh(); await flush(); assert.equal(requests,3);
    t.mock.timers.tick(3000); await flush(); assert.equal(requests,4);
    visibility.visibilityState='hidden'; visibility.dispatchEvent(new Event('visibilitychange'));
    t.mock.timers.tick(120_000); await flush(); assert.equal(requests,4);
    visibility.visibilityState='visible'; visibility.dispatchEvent(new Event('visibilitychange'));
    await flush(); assert.equal(requests,5);
  } finally {poller.dispose();}
});
