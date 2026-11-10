import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './test-source.mjs';
const graph = await loadSource('../src/features/topology/graph.ts');
const drawing = await loadSource('../src/features/editor/drawing.ts', { '../topology/graph': graph });
const duplicate = await loadSource('../src/features/editor/duplicateFeatures.ts', { './drawing': drawing });
const clipboardURL = await loadSource('../src/features/editor/geometryClipboard.ts', { './duplicateFeatures': duplicate });
const { captureGeometry, pasteGeometry, cutGeometry } = await import(clipboardURL);
const { planDeleteSelection, groupSelectionFeatures } = await import(await loadSource('../src/features/editor/selectionCommands.ts', { './geometryClipboard': clipboardURL }));
const { editorReducer, initialState, executeTransaction, samePersistedContent, visibleFeatures, capturePendingTags } = await import(await loadSource('../src/features/editor/EditorStore.tsx', {
  react: import.meta.resolve('react'), 'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  './geometryLocks': await loadSource('../src/features/editor/geometryLocks.ts'), './conflictResolution': await loadSource('../src/features/editor/conflictResolution.ts')
}));
const topology = await loadSource('../src/features/editor/topologyOperations.ts', { '../topology/graph': graph });
const { transformGeometry } = await import(await loadSource('../src/features/editor/geometryOperations.ts', { './topologyOperations': topology, 'polygon-clipping': import.meta.resolve('polygon-clipping') }));
const node = (id, coordinates = [105, 21], tags = {}) => ({ type: 'Feature', properties: { entityType: 'node', entityId: String(id), version: 1, tags }, geometry: { type: 'Point', coordinates } });
const way = (id, refs = ['1', '2']) => ({ type: 'Feature', properties: { entityType: 'way', entityId: String(id), version: 1, tags: { highway: 'service' }, parents: [], nodeIds: refs, nodes: refs.map((id, i) => ({ id, version: 1, tags: {}, coordinates: [105 + i / 1000, 21] })) }, geometry: { type: 'LineString', coordinates: refs.map((_, i) => [105 + i / 1000, 21]) } });
const group = (id, keys) => ({ type: 'Feature', properties: { entityType: 'relation', entityId: String(id), version: 1, tags: { type: 'collection' }, members: keys.map((key, sequence) => { const [type, ref] = key.split('/'); return { type, ref, role: '', sequence }; }) }, geometry: { type: 'Point', coordinates: [105, 21] } });
const hydrate = features => editorReducer(initialState, { type: 'hydrate', features });
const copy = (keys, available) => {
  const snapshot = captureGeometry(keys, available); let id = -1;
  return pasteGeometry(snapshot, () => String(id--), () => String(id--), () => String(id--), [0.001, 0.001]);
};

test('draft capture protects focused inspector text without mutating live state or undo granularity', () => {
  const live = hydrate([node('1', [105, 21], { name: 'Gốc' })]);
  const captured = capturePendingTags(live, { key: 'node/1', tags: { name: 'Đang nhập' } });
  assert.equal(captured.overrides['node/1'].properties.tags.name, 'Đang nhập');
  assert.equal(captured.undoStack.length, 1);
  assert.deepEqual(live.overrides, {}); assert.equal(live.undoStack.length, 0);
  assert.equal(capturePendingTags(live, { key: 'node/1', tags: { name: 'Gốc' } }), live);
  assert.equal(capturePendingTags(live, { key: 'node/999', tags: {} }), live);
});

test('zero rotation, 100% scale and unchanged tags produce no dirty data or undo entry', () => {
  const source = way(10), state = hydrate([source]);
  for (const options of [{ operation: 'rotate', value: 0 }, { operation: 'scale', value: 100 }]) {
    const command = executeTransaction(state, transformGeometry([source], [source], options), 'noop transform');
    assert.equal(command.result.status, 'noop'); assert.strictEqual(command.state, state);
    assert.deepEqual(command.state.overrides, {}); assert.equal(command.state.undoStack.length, 0);
  }
  const metadataOnly = structuredClone(source); metadataOnly.properties.name = ''; metadataOnly.properties.tags = { ...source.properties.tags };
  assert.equal(executeTransaction(state, [{ key: 'way/10', feature: metadataOnly }], 'tags').result.status, 'noop');
});

test('E7 equality, tag order and derived metadata do not create changes; actual tag/coordinate does', () => {
  const a = node(1, [105, 21], { name: 'A', amenity: 'bench' });
  const same = node(1, [105 + 1e-9, 21], { amenity: 'bench', name: 'A' });
  same.properties.name = 'Derived'; same.properties.topologyNode = true;
  assert.ok(samePersistedContent(a, same));
  assert.equal(executeTransaction(hydrate([a]), [{ key: 'node/1', feature: same }], 'noop').result.status, 'noop');
  assert.equal(executeTransaction(hydrate([a]), [{ key: 'node/1', feature: node(1, [105.000001, 21], a.properties.tags) }], 'move').result.status, 'applied');
  assert.equal(executeTransaction(hydrate([a]), [{ key: 'node/1', feature: node(1, [105, 21], { ...a.properties.tags, name: 'B' }) }], 'rename').result.status, 'applied');
});

test('coalesced transaction compares final content, retains redo and commits one undo entry', () => {
  const a = node(1), b = node(1, [105.001, 21]); let state = hydrate([a]);
  assert.equal(executeTransaction(state, [{ key: 'node/1', feature: b }, { key: 'node/1', feature: a }], 'net zero').result.status, 'noop');
  state = executeTransaction(state, [{ key: 'node/1', feature: a }, { key: 'node/1', feature: b }], 'move').state;
  assert.equal(state.undoStack.length, 1); assert.equal(state.undoStack[0].changes.length, 1);
  state = editorReducer(state, { type: 'undo' });
  const noop = executeTransaction(state, [{ key: 'node/1', feature: a }], 'noop');
  assert.equal(noop.state.redoStack.length, 1); assert.equal(noop.result.status, 'noop');
  state = editorReducer(noop.state, { type: 'redo' }); assert.deepEqual(state.overrides['node/1'].geometry.coordinates, [105.001, 21]);
});

test('one locked object blocks the entire multi-object transaction and preserves selection/history', () => {
  let state = hydrate([node(1), node(2)]);
  state = editorReducer(state, { type: 'select', key: 'node/2', mode: 'replace' });
  state = { ...state, lockedKeys: ['node/1'] };
  const command = executeTransaction(state, [{ key: 'node/1', feature: node(1, [105.001, 21]) }, { key: 'node/2', feature: node(2, [105.002, 21]) }], 'move both');
  assert.equal(command.result.status, 'blocked'); assert.match(command.result.message, /khóa/);
  assert.deepEqual(command.state.overrides, state.overrides); assert.deepEqual(command.state.selectedKeys, ['node/2']);
  assert.equal(command.state.nextChangeId, state.nextChangeId); assert.equal(command.state.undoStack.length, 0);
});

test('multi-selection duplicate copies every object, standalone POIs remain visible, and undo is atomic', () => {
  const available = [node(1), node(2, [105.001, 21]), node(3, [105.002, 21])];
  const result = copy(['node/1', 'node/2', 'node/3'], available);
  assert.equal(result.features.length, 3); assert.ok(result.features.every(feature => !feature.properties.topologyNode));
  const command = executeTransaction(hydrate(available), result.mutations, 'duplicate');
  assert.equal(command.result.status, 'applied'); assert.equal(command.state.undoStack.length, 1);
  assert.equal(visibleFeatures(command.state).length, 6);
  assert.equal(visibleFeatures(editorReducer(command.state, { type: 'undo' })).length, 3);
});

test('direct group and nested-group duplicates preserve independent member refs and shared topology', () => {
  const a = way(10), b = way(20, ['2', '3']), inner = group(30, ['way/10', 'way/20']), outer = group(40, ['relation/30']);
  const available = [a, b, outer, inner];
  for (const keys of [['relation/40'], ['way/10', 'way/20']]) {
    const result = copy(keys, available);
    assert.equal(result.features.length, 2);
    const copiedInner = result.copies.get('relation/30'), copiedOuter = result.copies.get('relation/40');
    assert.ok(copiedInner && copiedOuter);
    assert.equal(copiedOuter.properties.members[0].ref, copiedInner.properties.entityId);
    assert.equal(result.features[0].properties.nodeIds[1], result.features[1].properties.nodeIds[0]);
    assert.notEqual(result.features[0].properties.nodeIds[1], '2');
  }
  assert.throws(() => copy(['relation/40'], [outer, inner, a]), /chưa được tải/);
});

test('single member selection does not implicitly duplicate its whole group', () => {
  const a = node(1), b = node(2), together = group(3, ['node/1', 'node/2']), singleton = group(4, ['node/1']);
  const snapshot = captureGeometry(['node/1'], [a, b, together, singleton]);
  assert.equal(snapshot.sources.length, 1); assert.equal(snapshot.groups.length, 0);
  assert.equal(groupSelectionFeatures(a, [a, b, together]).length, 2);
  assert.throws(() => groupSelectionFeatures(a, [a, together]), /chưa được tải/);
});

test('multi-delete includes only selected geometry, deletes complete wrappers, and refuses external references', () => {
  const a = node(1), b = node(2), c = node(3), together = group(4, ['node/1', 'node/2']);
  const available = [a, b, c, together];
  assert.throws(() => planDeleteSelection(['node/1'], available), /quan hệ/);
  const mutations = planDeleteSelection(['node/1', 'node/2'], available);
  assert.deepEqual(new Set(mutations.map(item => item.key)), new Set(['node/1', 'node/2', 'relation/4']));
  const command = executeTransaction(hydrate(available), mutations, 'delete');
  assert.equal(command.result.status, 'applied'); assert.deepEqual(visibleFeatures(command.state).map(feature => feature.properties.entityId), ['3']);
  assert.equal(visibleFeatures(editorReducer(command.state, { type: 'undo' })).length, 4);
  assert.throws(() => planDeleteSelection(['relation/4'], [a, together]), /Chưa tải đủ/);
  const external = way(10);
  assert.throws(() => planDeleteSelection(['node/1', 'node/2'], [...available, external]), /đường/);
});

test('generic transactions cannot delete a node used by a newly-created or existing final way', () => {
  const a = node(1), b = node(2), source = way(10), state = hydrate([a, b]);
  const command = executeTransaction(state, [{ key: 'node/1', feature: null }, { key: 'way/10', feature: source }], 'bad references');
  assert.equal(command.result.status, 'blocked'); assert.deepEqual(command.state.overrides, {});
  const invalidKey = executeTransaction(state, [{ key: 'node/999', feature: a }], 'bad key');
  assert.equal(invalidKey.result.status, 'blocked');
});

test('deleting explicit collection is different from ungrouping its wrapper', () => {
  const a = node(1), b = node(2), together = group(3, ['node/1', 'node/2']), available = [a, b, together];
  assert.equal(planDeleteSelection(['relation/3'], available).length, 3);
  const ungroup = executeTransaction(hydrate(available), [{ key: 'relation/3', feature: null }], 'ungroup');
  assert.equal(ungroup.result.status, 'applied'); assert.equal(visibleFeatures(ungroup.state).length, 2);
  const cut = cutGeometry(captureGeometry(['relation/3'], available), available);
  assert.equal(executeTransaction(hydrate(available), cut, 'cut').result.status, 'applied');
});

test('whole-group selection is atomic when a member is locked or missing', () => {
  let state = hydrate([node(1), node(2), node(3)]);
  state = editorReducer(state, { type: 'select', key: 'node/3', mode: 'replace' });
  const locked = { ...state, lockedKeys: ['node/2'] };
  const rejected = editorReducer(locked, { type: 'select-set', keys: ['node/1', 'node/2'], active: 'node/1' });
  assert.deepEqual(rejected.selectedKeys, ['node/3']); assert.match(rejected.error, /khóa/);
  const missing = editorReducer(state, { type: 'select-set', keys: ['node/1', 'node/99'], active: 'node/1' });
  assert.deepEqual(missing.selectedKeys, ['node/3']);
  const accepted = editorReducer(state, { type: 'select-set', keys: ['node/1', 'node/2'], active: 'node/2' });
  assert.deepEqual(accepted.selectedKeys, ['node/1', 'node/2']); assert.equal(accepted.selectedKey, 'node/2');
});

test('local ungroup membership overrides stale parent metadata for subsequent delete/cut', () => {
  const a = node(1), b = node(2), relation = group(3, ['node/2']);
  a.properties.parents = [{ id: '3', version: 1, tags: { type: 'collection' } }];
  assert.equal(planDeleteSelection(['node/1'], [a, b, relation]).length, 1);
  assert.equal(cutGeometry(captureGeometry(['node/1'], [a, b, relation]), [a, b, relation]).length, 1);
});

test('no-op transforms return no mutations before costly geometry validation', () => {
  const source = way(10);
  assert.deepEqual(transformGeometry([source], [source], { operation: 'rotate', value: 360 }), []);
  assert.deepEqual(transformGeometry([source], [source], { operation: 'scale', value: 100 }), []);
  assert.equal(executeTransaction(hydrate([source]), [], 'noop').result.status, 'noop');
  const previousFailure = { ...hydrate([source]), error: 'Old failure', lockedKeys: ['way/10'] };
  const noop = executeTransaction(previousFailure, [{ key: 'way/10', feature: source }], 'unchanged');
  assert.equal(noop.result.status, 'noop'); assert.equal(noop.state.error, null);
  assert.deepEqual(noop.state.overrides, {}); assert.equal(noop.state.undoStack.length, 0);
});
