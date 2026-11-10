import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './test-source.mjs';

const graph = await loadSource('../src/features/topology/graph.ts');
const topology = await loadSource('../src/features/editor/topologyOperations.ts', { '../topology/graph': graph });
const geometryURL = await loadSource('../src/features/editor/geometryOperations.ts', { './topologyOperations': topology, 'polygon-clipping': import.meta.resolve('polygon-clipping') });
const { transformGeometry, booleanGeometry, areaGeometry } = await import(geometryURL);
const locks = await loadSource('../src/features/editor/geometryLocks.ts');
const { lockViolation } = await import(locks);
const { editorReducer, initialState, visibleFeatures } = await import(await loadSource('../src/features/editor/EditorStore.tsx', {
  react: import.meta.resolve('react'), 'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'), './geometryLocks': locks,
  './conflictResolution': await loadSource('../src/features/editor/conflictResolution.ts')
}));
const { toUploadChanges, uploadChangeset } = await import(await loadSource('../src/api/changeset.ts'));
const key = f => `${f.properties.entityType}/${f.properties.entityId}`;
const node = (id, coordinates) => ({ type: 'Feature', properties: { entityType: 'node', entityId: String(id), version: 1, tags: {} }, geometry: { type: 'Point', coordinates } });
function way(id, coordinates, ids = coordinates.map((_, i) => `${id}-${i}`), polygon = true) {
  if (polygon) ids[ids.length - 1] = ids[0];
  return { type: 'Feature', properties: { entityType: 'way', entityId: String(id), version: 1, tags: polygon ? { landuse: 'grass' } : {}, parents: [], nodeIds: ids, nodes: ids.map((id, i) => ({ id, coordinates: coordinates[i], version: 1, tags: {} })) }, geometry: { type: polygon ? 'Polygon' : 'LineString', coordinates: polygon ? [coordinates] : coordinates } };
}
const square = (id, x, y, size = 0.002) => way(id, [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]);
function area(sources, operation, primary = key(sources[0]), available = sources) {
  let id = -1;
  return booleanGeometry(sources, available, { operation, primary }, () => String(id--), () => String(id--), () => String(id--));
}
const featureAt = (mutations, id) => mutations.find(item => item.key === id)?.feature;
const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('rotate and scale use local metric frame and explicit centre, maintain shared node identities', () => {
  const first = way(10, [[105, 21], [105.001, 21]], ['1', '2'], false);
  const second = way(20, [[105.001, 21], [105.003, 21]], ['2', '3'], false);
  const mutations = transformGeometry([first], [first, second], { operation: 'rotate', value: 90, center: [105, 21] });
  const moved = featureAt(mutations, 'node/2').geometry.coordinates;
  near(moved[0], 105); near(moved[1], 21 + 0.001 * Math.cos(21 * Math.PI / 180));
  assert.deepEqual(featureAt(mutations, 'way/20').geometry.coordinates[0], moved);
  assert.deepEqual(first.geometry.coordinates, [[105, 21], [105.001, 21]], 'input immutable');
  const scaled = transformGeometry([first], [first, second], { operation: 'scale', value: 200, center: [105, 21] });
  assert.deepEqual(featureAt(scaled, 'node/2').geometry.coordinates, [105.002, 21]);
});

test('circularize keeps refs, orientation and closure with editable radius', () => {
  const source = square(10, 105, 21);
  const mutations = transformGeometry([source], [source], { operation: 'circle', radius: 100, center: [105.001, 21.001] });
  const result = featureAt(mutations, 'way/10');
  assert.deepEqual(result.properties.nodeIds, source.properties.nodeIds);
  for (const [x, y] of result.geometry.coordinates[0]) {
    near(Math.hypot((x - 105.001) * 6371008.8 * Math.PI / 180 * Math.cos(21.001 * Math.PI / 180), (y - 21.001) * 6371008.8 * Math.PI / 180), 100, 0.02);
  }
  assert.deepEqual(result.geometry.coordinates[0][0], result.geometry.coordinates[0].at(-1));
  assert.throws(() => transformGeometry([source], [source], { operation: 'circle', radius: -1 }), /Bán kính/);
});

test('align east-west and distribute preserve outer positions and object geometry', () => {
  const points = [node(1, [105, 21]), node(2, [105.001, 21.001]), node(3, [105.004, 21.002])];
  const aligned = transformGeometry(points, points, { operation: 'align', axis: 'east' });
  for (const mutation of aligned) near(mutation.feature.geometry.coordinates[1], 21.001);
  const distributed = transformGeometry(points, points, { operation: 'distribute', axis: 'east' });
  assert.deepEqual(featureAt(distributed, 'node/1').geometry.coordinates, [105, 21]);
  assert.deepEqual(featureAt(distributed, 'node/3').geometry.coordinates, [105.004, 21.002]);
  assert.deepEqual(featureAt(distributed, 'node/2').geometry.coordinates, [105.002, 21.001]);
});

test('transforms reject invalid, huge and conflicting shared-node alignments', () => {
  assert.throws(() => transformGeometry([node(1, [105, 21])], [], { operation: 'scale', value: 0 }), /hợp lệ/);
  const huge = way(1, [[105, 21], [110, 21]], ['1', '2'], false);
  assert.throws(() => transformGeometry([huge], [huge], { operation: 'rotate', value: 90 }), /phạm vi/);
  const a = way(1, [[105, 21], [105.001, 21]], ['1', '2'], false);
  const b = way(2, [[105.001, 21], [105.003, 21.002]], ['2', '3'], false);
  assert.throws(() => transformGeometry([a, b], [a, b], { operation: 'align', axis: 'east' }), /dùng chung/);
});

test('union and intersection create fresh geometry, preserve inputs and primary tags', () => {
  const sources = [square(1, 105, 21), square(2, 105.001, 21)];
  sources[0].properties.tags.name = 'Main';
  for (const operation of ['union', 'intersection']) {
    const before = structuredClone(sources), result = area(sources, operation);
    assert.deepEqual(sources, before);
    assert.equal(result.selected.properties.tags.name, 'Main');
    assert.ok(result.mutations.every(mutation => mutation.feature.properties.version === 0));
    assert.ok(result.mutations.every(mutation => !sources.some(source => key(source) === mutation.key)));
    const coords = result.selected.geometry.coordinates[0];
    near(Math.min(...coords.map(p => p[0])), operation === 'union' ? 105 : 105.001);
    near(Math.max(...coords.map(p => p[0])), operation === 'union' ? 105.003 : 105.002);
  }
});

test('hole and difference produce canonical outer/inner multipolygon members and upload together', () => {
  const sources = [square(1, 105, 21, 0.01), square(2, 105.002, 21.002)];
  for (const operation of ['hole', 'difference']) {
    const result = area(sources, operation), features = result.mutations.map(item => item.feature);
    assert.equal(result.selected.properties.tags.type, 'multipolygon');
    assert.deepEqual(result.selected.properties.members.map(member => member.role), ['outer', 'inner']);
    const geometry = areaGeometry(result.selected, features);
    assert.equal(geometry.length, 1); assert.equal(geometry[0].length, 2);
    const changes = result.mutations.map((item, id) => ({ id, key: item.key, label: operation, before: undefined, after: item.feature }));
    const upload = toUploadChanges(changes);
    assert.ok(upload.some(change => change.entity.type === 'relation' && change.entity.members.length === 2));
    let state = editorReducer(initialState, { type: 'hydrate', features: sources });
    state = editorReducer(state, { type: 'commit-many', mutations: result.mutations, label: operation });
    assert.equal(state.undoStack.length, 1);
    state = editorReducer(state, { type: 'undo' }); assert.deepEqual(state.overrides, {});
    state = editorReducer(state, { type: 'redo' }); assert.ok(visibleFeatures(state).some(feature => key(feature) === key(result.selected)));
  }
});

test('disjoint union produces multiple outers and can be used as another operation input', () => {
  const sources = [square(1, 105, 21), square(2, 105.01, 21)];
  const result = area(sources, 'union');
  assert.equal(result.selected.properties.entityType, 'relation');
  assert.deepEqual(result.selected.properties.members.map(member => member.role), ['outer', 'outer']);
  const available = result.mutations.map(item => item.feature);
  assert.equal(areaGeometry(result.selected, available).length, 2);
  assert.throws(() => areaGeometry(result.selected, []), /Thiếu/);
  const clip = square(3, 105.0005, 21.0005, 0.0005);
  const again = area([result.selected, clip], 'intersection', key(result.selected), [...available, clip]);
  assert.equal(again.selected.properties.entityType, 'way');
});

test('empty results, missing primary, exterior and touching holes fail without mutations', () => {
  const a = square(1, 105, 21), far = square(2, 105.01, 21), touching = square(3, 105, 21, 0.001);
  assert.throws(() => area([a, far], 'intersection'), /rỗng/);
  assert.throws(() => area([a, far], 'union', ''), /vùng chính/);
  assert.throws(() => area([a, far], 'hole'), /hoàn toàn/);
  assert.throws(() => area([a, touching], 'hole'), /chạm biên/);
});

test('locks block selection, tag edits, shared-node edits, keyboard transactions and undo until unlocked', () => {
  const a = way(1, [[105, 21], [105.001, 21]], ['1', '2'], false);
  const b = way(2, [[105.001, 21], [105.002, 21]], ['2', '3'], false);
  let state = editorReducer(initialState, { type: 'hydrate', features: [a, b] });
  state = editorReducer(state, { type: 'lock', keys: ['way/1'] });
  state = editorReducer(state, { type: 'select', key: 'way/1', mode: 'replace' }); assert.equal(state.selectedKey, null);
  const mutations = transformGeometry([b], [a, b], { operation: 'scale', value: 200 });
  assert.ok(lockViolation([a, b], ['way/1'], [], mutations));
  state = editorReducer(state, { type: 'commit-many', mutations, label: 'scale' }); assert.deepEqual(state.overrides, {});
  state = editorReducer(state, { type: 'hydrate', features: [b] });
  state = editorReducer(state, { type: 'commit', key: 'node/2', feature: node(2, [105, 22]), label: 'move' }); assert.deepEqual(state.overrides, {});
  state = editorReducer(state, { type: 'unlock-all' });
  state = editorReducer(state, { type: 'commit-many', mutations, label: 'scale' }); assert.equal(state.undoStack.length, 1);
  state = editorReducer(state, { type: 'lock', layers: ['lines'] });
  state = editorReducer(state, { type: 'undo' }); assert.equal(state.undoStack.length, 1);
  state = editorReducer(state, { type: 'unlock-all' }); state = editorReducer(state, { type: 'undo' }); assert.deepEqual(state.overrides, {});
});

test('layer locks cover future loaded objects and creation; relation lock protects member geometry', () => {
  const a = square(1, 105, 21);
  const relation = { type: 'Feature', properties: { entityType: 'relation', entityId: '50', version: 1, tags: { type: 'multipolygon' }, members: [{ type: 'way', ref: '1', role: 'outer', sequence: 0 }] }, geometry: { type: 'Point', coordinates: [105, 21] } };
  let state = editorReducer(initialState, { type: 'lock', layers: ['areas'] });
  state = editorReducer(state, { type: 'hydrate', features: [a] });
  state = editorReducer(state, { type: 'commit', key: 'way/1', feature: null, label: 'delete' }); assert.deepEqual(state.overrides, {});
  const result = area([a, square(2, 105.001, 21)], 'union');
  state = editorReducer(state, { type: 'commit-many', mutations: result.mutations, label: 'union' }); assert.deepEqual(state.overrides, {});
  assert.ok(lockViolation([a, relation], ['relation/50'], [], [{ key: 'node/1-0', feature: node('1-0', [106, 21]) }]));
});

test('multipolygon assembles reversed open members and rejects ambiguous or incomplete rings', () => {
  const first = way(1, [[105, 21], [105.002, 21], [105.002, 21.002]], ['1', '2', '3'], false);
  const second = way(2, [[105, 21], [105, 21.002], [105.002, 21.002]], ['1', '4', '3'], false);
  const relation = { type: 'Feature', properties: { entityType: 'relation', entityId: '50', version: 1, tags: { type: 'multipolygon' }, members: [first, second].map((feature, sequence) => ({ type: 'way', ref: feature.properties.entityId, role: 'outer', sequence })) }, geometry: { type: 'Point', coordinates: [105, 21] } };
  const result = areaGeometry(relation, [first, second]);
  assert.equal(result.length, 1); assert.equal(result[0][0].length, 5);
  assert.throws(() => areaGeometry(relation, [first]), /Thiếu/);
  const open = structuredClone(second); open.properties.nodeIds[0] = '99';
  assert.throws(() => areaGeometry(relation, [first, open]), /hở/);
});

test('boolean results obey canonical non-touching rings and reject invalid inputs', () => {
  const a = square(1, 105, 21), touching = square(2, 105.002, 21.002);
  assert.throws(() => area([a, touching], 'union'), /chạm nhau/);
  const bow = way(3, [[105, 21], [105.002, 21.002], [105, 21.002], [105.002, 21], [105, 21]]);
  assert.throws(() => area([a, bow], 'union'), /tự giao/);
  assert.throws(() => transformGeometry([a], [a], { operation: 'scale', value: 0.000001 }), /trùng|suy biến/);
});

test('difference honours explicit primary rather than selection order', () => {
  const a = square(1, 105, 21), b = square(2, 105.001, 21);
  const result = area([a, b], 'difference', key(b));
  const ring = result.selected.geometry.coordinates[0];
  near(Math.min(...ring.map(p => p[0])), 105.002);
  near(Math.max(...ring.map(p => p[0])), 105.003);
});

test('rotation expands a complete group once, rejects missing members and cycles', () => {
  const a = node(1, [105, 21]), b = node(2, [105.001, 21]);
  const group = { type: 'Feature', properties: { entityType: 'relation', entityId: '50', version: 1, tags: { type: 'collection' }, members: [a, b].map((f, sequence) => ({ type: 'node', ref: f.properties.entityId, role: '', sequence })) }, geometry: { type: 'Point', coordinates: [105, 21] } };
  const mutations = transformGeometry([group], [a, b, group], { operation: 'rotate', value: 180, center: [105.0005, 21] });
  assert.equal(mutations.length, 2); near(featureAt(mutations, 'node/1').geometry.coordinates[0], 105.001);
  assert.throws(() => transformGeometry([group], [a, group], { operation: 'scale', value: 100 }), /Chưa tải đủ/);
  const cycle = structuredClone(group); cycle.properties.members.push({ type: 'relation', ref: '50', role: '', sequence: 2 });
  assert.throws(() => transformGeometry([cycle], [a, b, cycle], { operation: 'scale', value: 100 }), /vòng lặp/);
});

test('clean locked geometry refreshes versions, and temporary locks remap to canonical IDs after save', async () => {
  const a = square(1, 105, 21);
  let state = editorReducer(initialState, { type: 'hydrate', features: [a] });
  state = editorReducer(state, { type: 'lock', keys: ['way/1'] });
  const newer = structuredClone(a); newer.properties.version = 2;
  newer.properties.nodes.filter(node => node.id === '1-0').forEach(node => { node.version = 2; });
  state = editorReducer(state, { type: 'hydrate', features: [newer] });
  assert.equal(state.baseFeatures['way/1'].properties.version, 2);
  assert.equal(state.baseFeatures['node/1-0'].properties.version, 2);
  state = editorReducer(state, { type: 'unlock-all' });
  state = editorReducer(state, { type: 'lock', keys: ['way/-1'] });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ changeset: { id: '1', status: 'committed' }, diffResult: [{ type: 'way', oldId: '-1', newId: '100', newVersion: 1 }] }), { status: 200 });
    const uploaded = await uploadChangeset('1', []);
    state = editorReducer(state, { type: 'remap-locks', mapping: Object.fromEntries(uploaded.diffResult.map(item => [`${item.type}/${item.oldId}`, `${item.type}/${item.newId}`])) });
    assert.deepEqual(state.lockedKeys, ['way/100']);
    const canonical = square(100, 105, 21);
    state = editorReducer(state, { type: 'hydrate', features: [canonical] });
    state = editorReducer(state, { type: 'select', key: 'way/100', mode: 'replace' });
    assert.equal(state.selectedKey, null);
  } finally { globalThis.fetch = originalFetch; }
});
