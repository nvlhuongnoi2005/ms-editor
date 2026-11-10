import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './test-source.mjs';
const graph = await loadSource('../src/features/topology/graph.ts');
const topology = await loadSource('../src/features/editor/topologyOperations.ts', { '../topology/graph': graph });
const geometry = await loadSource('../src/features/editor/geometryOperations.ts', { './topologyOperations': topology, 'polygon-clipping': import.meta.resolve('polygon-clipping') });
const store = await loadSource('../src/features/editor/EditorStore.tsx', { react: import.meta.resolve('react'), 'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'), './geometryLocks': await loadSource('../src/features/editor/geometryLocks.ts'), './conflictResolution': await loadSource('../src/features/editor/conflictResolution.ts') });
const { editorReducer, initialState, executeTransaction, visibleFeatures } = await import(store);
const { planGeometryCommand, inspectMutations, reservePlannedIds } = await import(await loadSource('../src/features/editor/geometryCommandPlan.ts', { './EditorStore': store, './geometryOperations': geometry, './geometryLocks': await loadSource('../src/features/editor/geometryLocks.ts') }));
const node = (id, coords) => ({ type: 'Feature', properties: { entityType: 'node', entityId: String(id), version: 1, tags: {} }, geometry: { type: 'Point', coordinates: coords } });
const way = (id, refs, coords, area = false) => ({ type: 'Feature', properties: { entityType: 'way', entityId: String(id), version: 1, tags: area ? { area: 'yes' } : {}, nodeIds: refs, nodes: refs.map((id, i) => ({ id, coordinates: coords[i], version: 1, tags: {} })) }, geometry: area ? { type: 'Polygon', coordinates: [coords] } : { type: 'LineString', coordinates: coords } });
const square = (id, x, ids) => way(id, [...ids, ids[0]], [[x, 21], [x + .002, 21], [x + .002, 21.002], [x, 21.002], [x, 21]], true);
const hydrate = features => editorReducer(initialState, { type: 'hydrate', features });
const ids = { node: -1, way: -1, relation: -1 };
test('preview and commit use identical coordinates without changing state, history or ID allocators', () => {
  const a = way(10, ['1', '2'], [[105, 21], [105.001, 21]]), state = hydrate([a]);
  const original = structuredClone(state);
  const options = { operation: 'rotate', value: 90, center: [105, 21] };
  const plan = planGeometryCommand(state, [a], ['way/10'], options, ids);
  assert.equal(plan.status, 'ready'); assert.deepEqual(state, original); assert.deepEqual(ids, { node: -1, way: -1, relation: -1 });
  assert.deepEqual(planGeometryCommand(state, [a], ['way/10'], options, ids), plan);
  const commit = executeTransaction(state, plan.mutations, 'Rotate');
  assert.equal(commit.result.status, 'applied'); assert.equal(commit.state.undoStack.length, 1);
  const displayed = visibleFeatures(commit.state).find(f => f.properties.entityType === 'way');
  assert.deepEqual(displayed.geometry, plan.after.find(f => f.properties.entityType === 'way').geometry);
});
test('impact counts only actually moved shared nodes and transitive external relation dependencies', () => {
  const a = way(10, ['1', '2'], [[105, 21], [105.001, 21]]), b = way(20, ['2', '3'], [[105.001, 21], [105.003, 21]]);
  const relation = { ...node(30, [105, 21]), properties: { entityType: 'relation', entityId: '30', version: 1, tags: { type: 'collection' }, members: [{ type: 'way', ref: '20', role: '', sequence: 0 }] } };
  const features = [a, b, relation], state = hydrate(features);
  const plan = planGeometryCommand(state, features, ['way/10'], { operation: 'rotate', value: 90, center: [105, 21] }, ids);
  assert.equal(plan.status, 'ready'); assert.equal(plan.impact.changedNodes, 1);
  assert.deepEqual(plan.impact.externalWays, ['way/20']); assert.deepEqual(plan.impact.externalRelations, ['relation/30']);
  assert.ok(plan.after.some(f => f.properties.entityId === '20'));
});
test('no-op and locked previews report the same outcome as transaction execution', () => {
  const a = way(10, ['1', '2'], [[105, 21], [105.001, 21]]), state = { ...hydrate([a]), lockedKeys: ['node/2'] };
  assert.equal(planGeometryCommand(state, [a], ['way/10'], { operation: 'rotate', value: 360 }, ids).status, 'noop');
  const blocked = planGeometryCommand(state, [a], ['way/10'], { operation: 'rotate', value: 90 }, ids);
  assert.equal(blocked.status, 'blocked'); assert.match(blocked.reason, /khóa/); assert.equal(state.undoStack.length, 0);
});
test('area preview retains originals, deterministic independent IDs and full multipolygon geometry', () => {
  const a = square(10, 105, ['1', '2', '3', '4']), b = square(20, 105.001, ['5', '6', '7', '8']);
  const features = [a, b], state = hydrate(features);
  const plan = planGeometryCommand(state, features, ['way/10', 'way/20'], { operation: 'difference', primary: 'way/10' }, ids);
  assert.equal(plan.status, 'ready'); assert.ok(plan.impact.created > 0); assert.equal(plan.impact.deleted, 0);
  assert.equal(state.overrides['way/10'], undefined); assert.ok(plan.selected);
  const next = reservePlannedIds(plan.mutations, ids); assert.ok(next.node < -1); assert.ok(next.way < -1);
  const committed = executeTransaction(state, plan.mutations, 'Area'); assert.equal(committed.result.status, 'applied');
});
test('invalid/missing geometry and empty intersections are blocked before apply', () => {
  const a = square(10, 105, ['1', '2', '3', '4']), b = square(20, 105.02, ['5', '6', '7', '8']);
  const features = [a, b], state = hydrate(features);
  assert.match(planGeometryCommand(state, features, ['way/10', 'way/20'], { operation: 'intersection', primary: 'way/10' }, ids).reason, /rỗng/);
  assert.match(planGeometryCommand(state, features, ['way/99'], { operation: 'rotate', value: 90 }, ids).reason, /way\/99/);
});
test('stale source geometry or locks changes the confirmation fingerprint', () => {
  const a = node('1', [105, 21]), state = hydrate([a]);
  const mutations = [{ key: 'node/1', feature: node('1', [105.001, 21]) }];
  const plan = inspectMutations(state, [a], ['node/1'], mutations);
  const moved = node('1', [105, 21.001]);
  assert.notEqual(inspectMutations(hydrate([moved]), [moved], ['node/1'], mutations).fingerprint, plan.fingerprint);
  assert.equal(inspectMutations({ ...state, lockedKeys: ['node/1'] }, [a], ['node/1'], mutations).status, 'blocked');
});
test('fully selected collection belongs to selection scope, not an external relation warning', () => {
  const a = node('1', [105, 21]), b = node('2', [105.001, 21]);
  const group = { ...node('3', [105, 21]), properties: { entityType: 'relation', entityId: '3', version: 1, tags: { type: 'collection' }, members: [{ type: 'node', ref: '1', role: '', sequence: 0 }, { type: 'node', ref: '2', role: '', sequence: 1 }] } };
  const features = [a, b, group];
  const plan = planGeometryCommand(hydrate(features), features, ['node/1', 'node/2'], { operation: 'scale', value: 200 }, ids);
  assert.equal(plan.status, 'ready'); assert.equal(plan.impact.groups, 1); assert.deepEqual(plan.impact.externalRelations, []);
});
