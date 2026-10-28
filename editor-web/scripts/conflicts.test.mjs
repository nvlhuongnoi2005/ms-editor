import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './test-source.mjs';

const resolutionURL = await loadSource('../src/features/editor/conflictResolution.ts');
const { planConflictResolution, sameEntityContent } = await import(resolutionURL);
const { editorReducer, initialState, visibleFeatures } = await import(await loadSource('../src/features/editor/EditorStore.tsx', {
  react: import.meta.resolve('react'), 'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'), './conflictResolution': resolutionURL
}));
const { uploadChangeset, ChangesetApiError, toUploadChanges } = await import(await loadSource('../src/api/changeset.ts'));
const { loadEntitySnapshots } = await import(await loadSource('../src/api/conflicts.ts', { './graph': await loadSource('../src/api/graph.ts') }));
const point = (id, version, tags = {}, coordinate = [106, 20]) => ({ type: 'Feature', properties: { entityType: 'node', entityId: String(id), version, tags }, geometry: { type: 'Point', coordinates: coordinate } });
const key = feature => `${feature.properties.entityType}/${feature.properties.entityId}`;
const change = (before, after) => ({ id: 1, key: key(before ?? after), label: 'Edit', before, after });
const batch = (...features) => ({ snapshots: features.map(feature => ({ key: key(feature), version: feature.properties.version, visible: true, feature })), support: [] });
const resolved = plan => plan.entities[0].local;

test('three-way merge preserves independent server edits and local delta', () => {
  const base = point(1, 1, { name: 'Old', phone: '01' });
  const local = point(1, 1, { name: 'New', phone: '01' });
  const server = point(1, 2, { name: 'Old', phone: '02', website: 'example.com' });
  const plan = planConflictResolution([change(base, local)], batch(server));
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(resolved(plan).properties.tags, { name: 'New', phone: '02', website: 'example.com' });
  assert.equal(resolved(plan).properties.version, 2);
});
test('same-field conflict blocks apply until an explicit choice', () => {
  const base = point(1, 1, { name: 'Old' }), local = point(1, 1, { name: 'Local' }), server = point(1, 4, { name: 'Remote' });
  const edits = [change(base, local)], latest = batch(server);
  assert.equal(planConflictResolution(edits, latest).blockers.length, 1);
  assert.equal(resolved(planConflictResolution(edits, latest, { 'node/1::tag:name': 'local' })).properties.tags.name, 'Local');
  assert.equal(resolved(planConflictResolution(edits, latest, { 'node/1::tag:name': 'server' })).properties.tags.name, 'Remote');
});
test('tag deletions are deltas, and identical edits do not conflict', () => {
  const base = point(1, 1, { phone: '01', name: 'A' }), local = point(1, 1, { name: 'B' }), server = point(1, 2, { phone: '01', name: 'B', shop: 'bicycle' });
  const plan = planConflictResolution([change(base, local)], batch(server));
  assert.equal(plan.blockers.length, 0);
  assert.deepEqual(resolved(plan).properties.tags, { name: 'B', shop: 'bicycle' });
});
test('server tag edit versus local tag deletion requires a choice', () => {
  const base = point(1, 1, { name: 'A' }), local = point(1, 1), server = point(1, 2, { name: 'B' });
  const plan = planConflictResolution([change(base, local)], batch(server), { 'node/1::tag:name': 'local' });
  assert.deepEqual(resolved(plan).properties.tags, {});
  assert.equal(plan.blockers.length, 0);
});
test('geometry edits at both ends are explicit and selected geometry uses current version', () => {
  const base = point(1, 1), local = point(1, 1, {}, [106.1, 20]), server = point(1, 2, {}, [106.2, 20]);
  assert.equal(planConflictResolution([change(base, local)], batch(server)).blockers.length, 1);
  const plan = planConflictResolution([change(base, local)], batch(server), { 'node/1::shape': 'local' });
  assert.deepEqual(resolved(plan).geometry.coordinates, [106.1, 20]);
  assert.equal(resolved(plan).properties.version, 2);
});
test('tag-only local edit retains server-moved position', () => {
  const base = point(1, 1, { name: 'A' }), local = point(1, 1, { name: 'B' }), server = point(1, 2, { name: 'A' }, [107, 21]);
  const plan = planConflictResolution([change(base, local)], batch(server));
  assert.deepEqual(resolved(plan).geometry.coordinates, [107, 21]);
  assert.equal(resolved(plan).properties.tags.name, 'B');
});
test('deleting a remotely modified entity requires explicit confirmation', () => {
  const base = point(1, 1, { name: 'A' }), server = point(1, 2, { name: 'B' });
  const edits = [change(base, null)];
  assert.equal(planConflictResolution(edits, batch(server)).blockers.length, 1);
  assert.equal(resolved(planConflictResolution(edits, batch(server), { 'node/1::delete': 'local' })), null);
  assert.equal(resolved(planConflictResolution(edits, batch(server), { 'node/1::delete': 'server' })).properties.tags.name, 'B');
});
test('remote deletion cannot be silently resurrected with a higher version', () => {
  const base = point(1, 1, { name: 'A' }), local = point(1, 1, { name: 'B' });
  const latest = { snapshots: [{ key: 'node/1', visible: false, version: 2, feature: null }], support: [] };
  assert.ok(planConflictResolution([change(base, local)], latest).blockers.length);
  const plan = planConflictResolution([change(base, local)], latest, { 'node/1::deleted': 'server' });
  assert.equal(plan.blockers.length, 0);
  assert.equal(resolved(plan), null);
  assert.deepEqual(plan.removedKeys, ['node/1']);
});
test('JSON object key order never creates a false geometry conflict', () => {
  const base = point(1, 1, { name: 'A', shop: 'bicycle' });
  const server = { ...point(1, 2, { shop: 'bicycle', name: 'A' }), geometry: { coordinates: [106, 20], type: 'Point' } };
  assert.ok(sameEntityContent(base, server));
  const plan = planConflictResolution([change(base, point(1, 1, { name: 'B', shop: 'bicycle' }))], batch(server));
  assert.equal(plan.fields.filter(field => field.label.includes('Hình học')).length, 0);
});
test('rebase Undo/Redo uses the new baseline and preserves other pending creates', () => {
  const base = point(1, 1, { name: 'A' }), local = point(1, 1, { name: 'B' }), server = point(1, 3, { name: 'A', phone: '01' }), created = point(-1, 0, { shop: 'bicycle' });
  const edits = [change(base, local), change(undefined, created)];
  const plan = planConflictResolution(edits, batch(server));
  let state = editorReducer(initialState, { type: 'hydrate', features: [base] });
  state = editorReducer(state, { type: 'resolve-conflicts', plan });
  assert.equal(state.baseFeatures['node/1'].properties.version, 3);
  assert.equal(state.overrides['node/1'].properties.version, 3);
  assert.equal(state.overrides['node/-1'].properties.tags.shop, 'bicycle');
  state = editorReducer(state, { type: 'undo' });
  assert.deepEqual(state.overrides, {});
  assert.equal(state.baseFeatures['node/1'].properties.tags.phone, '01');
  state = editorReducer(state, { type: 'redo' });
  const payload = toUploadChanges(Object.entries(state.overrides).map(([key, after]) => ({ key, before: state.baseFeatures[key], after })));
  assert.equal(payload.find(item => item.operation === 'modify').entity.version, 3);
  assert.equal(payload.find(item => item.operation === 'create').entity.id, '-1');
});
test('choosing server content creates no phantom pending change', () => {
  const base = point(1, 1, { name: 'A' }), local = point(1, 1, { name: 'B' }), server = point(1, 3, { name: 'C' });
  const plan = planConflictResolution([change(base, local)], batch(server), { 'node/1::tag:name': 'server' });
  const state = editorReducer(initialState, { type: 'resolve-conflicts', plan });
  assert.deepEqual(state.overrides, {});
  assert.deepEqual(state.undoStack, []);
});
test('dropping an entity still referenced by local topology blocks apply', () => {
  const base = point(1, 1), local = point(1, 1, { name: 'B' });
  const createdWay = { type: 'Feature', properties: { entityType: 'way', entityId: '-2', version: 0, tags: {}, nodeIds: ['1', '2'], nodes: [{ id: '1', coordinates: [106, 20] }, { id: '2', coordinates: [107, 20] }] }, geometry: { type: 'LineString', coordinates: [[106, 20], [107, 20]] } };
  const plan = planConflictResolution([change(base, local), change(undefined, createdWay)], { snapshots: [{ key: 'node/1', visible: false, version: 2, feature: null }], support: [] }, { 'node/1::deleted': 'server' });
  assert.ok(plan.blockers.some(message => message.includes('nhóm topology')));
});
test('unused new geometry-only nodes are pruned while tagged POIs survive', () => {
  const geometryNode = point(-1, 0); geometryNode.properties.topologyNode = true;
  const poi = point(-2, 0, { shop: 'bicycle' });
  const plan = planConflictResolution([change(undefined, geometryNode), change(undefined, poi)], batch());
  assert.equal(plan.entities[0].local, null);
  assert.equal(plan.entities[1].local.properties.tags.shop, 'bicycle');
});
test('HTTP 409 errors preserve status and code without confusing topology errors', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Version changed', code: 'version_conflict' }), { status: 409 });
    await assert.rejects(uploadChangeset('1', []), error => error instanceof ChangesetApiError && error.status === 409 && error.code === 'version_conflict');
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Missing node' }), { status: 409 });
    await assert.rejects(uploadChangeset('1', []), error => error.status === 409 && error.code === null);
  } finally { globalThis.fetch = original; }
});
test('snapshot parsing rejects missing or mismatched entities', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ snapshots: [], support: [] }));
    await assert.rejects(loadEntitySnapshots(['node/1']), /thiếu/);
    globalThis.fetch = async () => new Response(JSON.stringify({ snapshots: [{ key: 'node/1', version: 2, visible: true, feature: point(2, 2) }], support: [] }));
    await assert.rejects(loadEntitySnapshots(['node/1']), /ID\/version/);
  } finally { globalThis.fetch = original; }
});

test('way coordinates follow resolved node choices without a duplicate way conflict/upload', () => {
  const n1 = point(1, 1), n2 = point(2, 1, {}, [107, 20]);
  const makeWay = (version, a, b) => ({ type: 'Feature', properties: { entityType: 'way', entityId: '10', version, tags: { highway: 'residential' }, nodeIds: ['1', '2'], nodes: [a, b].map(n => ({ id: n.properties.entityId, coordinates: n.geometry.coordinates, version: n.properties.version, tags: {} })) }, geometry: { type: 'LineString', coordinates: [a.geometry.coordinates, b.geometry.coordinates] } });
  const baseWay = makeWay(1, n1, n2), localNode = point(1, 1, {}, [106.1, 20]), localWay = makeWay(1, localNode, n2);
  const serverNode = point(1, 2, {}, [106.2, 20]), serverWay = makeWay(1, serverNode, n2);
  const latest = batch(serverNode, serverWay); latest.support = [serverNode, n2];
  const plan = planConflictResolution([change(n1, localNode), change(baseWay, localWay)], latest, { 'node/1::shape': 'local' });
  assert.equal(plan.fields.filter(field => field.conflict).length, 1);
  assert.equal(plan.blockers.length, 0);
  let state = editorReducer(initialState, { type: 'resolve-conflicts', plan });
  assert.deepEqual(Object.keys(state.overrides), ['node/1']);
  const preview = () => visibleFeatures(state).find(f => f.properties.entityId === '10');
  assert.deepEqual(preview().geometry.coordinates[0], [106.1, 20]);
  state = editorReducer(state, { type: 'undo' });
  assert.deepEqual(preview().geometry.coordinates[0], [106.2, 20]);
  state = editorReducer(state, { type: 'redo' });
  assert.deepEqual(preview().geometry.coordinates[0], [106.1, 20]);
});

test('relation membership conflicts preserve selected order and roles', () => {
  const relation = (version, refs) => ({ type: 'Feature', properties: { entityType: 'relation', entityId: '30', version, tags: { type: 'route' }, members: refs.map((ref, sequence) => ({ type: 'way', ref, role: sequence ? 'backward' : 'forward', sequence })) }, geometry: { type: 'Point', coordinates: [106, 20] } });
  const base = relation(1, ['10', '20']), local = relation(1, ['10', '21']), server = relation(2, ['20', '10']);
  const edits = [change(base, local)];
  assert.equal(planConflictResolution(edits, batch(server)).blockers.length, 1);
  const plan = planConflictResolution(edits, batch(server), { 'relation/30::shape': 'local' });
  assert.deepEqual(resolved(plan).properties.members, local.properties.members);
  assert.equal(resolved(plan).properties.version, 2);
});
