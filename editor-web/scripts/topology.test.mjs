import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './test-source.mjs';
const graph = await loadSource('../src/features/topology/graph.ts');
const operationsURL = await loadSource('../src/features/editor/topologyOperations.ts', { '../topology/graph': graph });
const operations = await import(operationsURL);
const drawingURL = await loadSource('../src/features/editor/drawing.ts', { '../topology/graph': graph });
const { planDrawing } = await import(await loadSource('../src/features/editor/drawingTransactions.ts', { '../topology/graph': graph, './drawing': drawingURL, './topologyOperations': operationsURL }));
const { editorReducer, initialState } = await import(await loadSource('../src/features/editor/EditorStore.tsx', {
  react: import.meta.resolve('react'), 'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
  './conflictResolution': await loadSource('../src/features/editor/conflictResolution.ts')
}));
const { toUploadChanges } = await import(await loadSource('../src/api/changeset.ts'));
const { splitFeature, mergeFeatures, reverseFeature, reverseWayTags, removeVertex, disconnectVertex, extendFeature, wayVertices } = operations;

function way(id, refs, tags = {}, parents = []) {
  const nodes = refs.map(ref => ({ id: String(ref), version: 1, tags: {}, coordinates: [Number(ref), 1] }));
  return { type: 'Feature', id: `way-${id}`, properties: { entityType: 'way', entityId: String(id), version: 1, tags, nodeIds: nodes.map(n => n.id), nodes, parents }, geometry: { type: 'LineString', coordinates: nodes.map(n => n.coordinates) } };
}
function relation(id, type, members) {
  return { type: 'Feature', properties: { entityType: 'relation', entityId: String(id), version: 1, tags: { type }, members: members.map(([ref, role = ''], sequence) => ({ type: 'way', ref: String(ref), role, sequence })) }, geometry: { type: 'Point', coordinates: [1, 1] } };
}
function changed(result, key) { return result.mutations.find(m => m.key === key)?.feature; }

test('split keeps original ID/version and creates a new way, with consistent geometry', () => {
  const input = way(10, [1, 2, 3], { highway: 'residential' });
  const before = structuredClone(input);
  const result = splitFeature(input, '2', '-1', [input]);
  assert.deepEqual(changed(result, 'way/10').properties.nodeIds, ['1', '2']);
  assert.deepEqual(changed(result, 'way/-1').properties.nodeIds, ['2', '3']);
  assert.equal(changed(result, 'way/-1').properties.version, 0);
  assert.equal(changed(result, 'way/10').properties.version, 1);
  assert.deepEqual(input, before);
});
test('split updates every occurrence in a multipolygon and resequences members', () => {
  const input = way(10, [1, 2, 3], {}, [{ id: '30', version: 1, tags: { type: 'multipolygon' } }]);
  const rel = relation(30, 'multipolygon', [[10, 'outer'], [20, 'inner']]);
  const members = changed(splitFeature(input, '2', '-1', [input, rel]), 'relation/30').properties.members;
  assert.deepEqual(members.map(m => [m.ref, m.role, m.sequence]), [['10', 'outer', 0], ['-1', 'outer', 1], ['20', 'inner', 2]]);
});
test('split respects backward route traversal', () => {
  const input = way(10, [1, 2, 3]);
  const rel = relation(30, 'route', [[10, 'backward']]);
  assert.deepEqual(changed(splitFeature(input, '2', '-1', [input, rel]), 'relation/30').properties.members.map(m => m.ref), ['-1', '10']);
});
test('split rejects endpoints, ambiguous repeated nodes and closed ways', () => {
  const input = way(10, [1, 2, 3]);
  assert.throws(() => splitFeature(input, '1', '-1', [input]));
  assert.throws(() => splitFeature(way(10, [1, 2, 3, 2, 4]), '2', '-1', []));
  assert.throws(() => splitFeature(way(10, [1, 2, 3, 1]), '2', '-1', []));
});
test('editing fails safely when a parent is missing or a restriction needs manual handling', () => {
  const input = way(10, [1, 2, 3], {}, [{ id: '30', version: 1, tags: {} }]);
  assert.throws(() => splitFeature(input, '2', '-1', [input]), /30/);
  assert.throws(() => reverseFeature(input, [input, relation(30, 'restriction', [[10, 'from']])]), /thủ công/);
});
test('merge handles all four endpoint orientations and preserves first way identity', () => {
  for (const [a, b, expected] of [
    [[1, 2], [2, 3], ['1', '2', '3']],
    [[1, 2], [3, 2], ['1', '2', '3']],
    [[2, 3], [1, 2], ['1', '2', '3']],
    [[2, 3], [2, 1], ['1', '2', '3']]
  ]) {
    const first = way(10, a), second = way(20, b);
    const result = mergeFeatures(first, second, [first, second]);
    assert.equal(changed(result, 'way/20'), null);
    assert.deepEqual(result.selected.properties.nodeIds, expected);
    assert.equal(result.selected.properties.entityId, '10');
  }
});
test('merge refuses tag conflicts, different one-way meaning and branches', () => {
  assert.throws(() => mergeFeatures(way(10, [1, 2], { name: 'A' }), way(20, [2, 3], { name: 'B' }), []), /name/);
  assert.throws(() => mergeFeatures(way(10, [1, 2], { oneway: 'yes' }), way(20, [2, 3]), []), /oneway/);
  assert.throws(() => mergeFeatures(way(10, [1, 2], { bridge: 'yes' }), way(20, [2, 3]), []), /bridge/);
  assert.throws(() => mergeFeatures(way(10, [1, 2, 3]), way(20, [2, 4]), []), /endpoint/);
});
test('merge replaces consecutive relation members and preserves traversal', () => {
  const a = way(10, [1, 2]), b = way(20, [2, 3]);
  const rel = relation(30, 'route', [[10, 'forward'], [20, 'forward']]);
  const members = changed(mergeFeatures(a, b, [a, b, rel]), 'relation/30').properties.members;
  assert.deepEqual(members.map(m => [m.ref, m.role, m.sequence]), [['10', 'forward', 0]]);
  assert.throws(() => mergeFeatures(a, b, [a, b, relation(30, 'route', [[10, 'forward']])]), /liền kề/);
});
test('reverse maintains directional tags and route roles', () => {
  const input = way(10, [1, 2, 3], { oneway: 'yes', incline: '10%', 'lanes:forward': '2', 'sidewalk:left': 'yes' });
  const rel = relation(30, 'route', [[10, 'forward']]);
  const result = reverseFeature(input, [input, rel]);
  assert.deepEqual(result.selected.properties.nodeIds, ['3', '2', '1']);
  assert.deepEqual(result.selected.properties.tags, { oneway: '-1', incline: '-10%', 'lanes:backward': '2', 'sidewalk:right': 'yes' });
  assert.equal(changed(result, 'relation/30').properties.members[0].role, 'backward');
  assert.throws(() => reverseWayTags({ 'oneway:conditional': 'yes @ (Mo-Fr)' }), /thủ công/);
  assert.throws(() => reverseWayTags({ waterway: 'river' }), /thủ công/);
  assert.throws(() => reverseWayTags({ highway: 'motorway' }), /oneway/);
  assert.throws(() => reverseWayTags({ 'turn:lanes': 'left|through' }), /thủ công/);
});
test('disconnect clones only geometry, preserves original POI and closes polygon refs', () => {
  const input = way(10, [1, 2, 3, 1]);
  input.geometry = { type: 'Polygon', coordinates: [input.geometry.coordinates] };
  input.properties.nodes[0].tags = { amenity: 'cafe' };
  const result = disconnectVertex(input, '1', '-1');
  assert.deepEqual(result.selected.properties.nodeIds, ['-1', '2', '3', '-1']);
  assert.deepEqual(changed(result, 'node/-1').properties.tags, {});
  assert.deepEqual(input.properties.nodes[0].tags, { amenity: 'cafe' });
  assert.equal(result.mutations.length, 2);
});
test('remove vertex preserves closure, minimum size, and original node entity', () => {
  const input = way(10, [1, 2, 3, 4, 1]);
  input.geometry = { type: 'Polygon', coordinates: [input.geometry.coordinates] };
  const result = removeVertex(input, '1');
  assert.deepEqual(result.selected.properties.nodeIds, ['2', '3', '4', '2']);
  assert.equal(result.mutations.length, 1);
  assert.throws(() => removeVertex(result.selected, '2'), /đủ đỉnh/);
  assert.throws(() => removeVertex(way(10, [1, 2]), '2'), /đủ đỉnh/);
});
test('continue from either endpoint keeps identity, direction, tags and node metadata', () => {
  const input = way(10, [1, 2], { name: 'Road' });
  const start = extendFeature(input, [{ id: '1', coordinates: [1, 1] }, { id: '-1', coordinates: [0, 1] }], '1');
  const end = extendFeature(input, [{ id: '2', coordinates: [2, 1] }, { id: '-2', coordinates: [3, 1] }], '2');
  assert.deepEqual(start.properties.nodeIds, ['-1', '1', '2']);
  assert.deepEqual(end.properties.nodeIds, ['1', '2', '-2']);
  assert.equal(start.properties.version, 1);
  assert.deepEqual(start.properties.tags, input.properties.tags);
  assert.equal(wayVertices(start)[1].version, 1);
});
test('atomic split Undo/Redo restores all way and relation changes', () => {
  const input = way(10, [1, 2, 3]);
  const rel = relation(30, 'multipolygon', [[10, 'outer']]);
  let state = editorReducer(initialState, { type: 'hydrate', features: [input, rel] });
  const result = splitFeature(input, '2', '-1', [input, rel]);
  state = editorReducer(state, { type: 'commit-many', mutations: result.mutations, label: 'Split' });
  assert.equal(state.undoStack.length, 1);
  assert.equal(Object.keys(state.overrides).length, 3);
  state = editorReducer(state, { type: 'undo' });
  assert.deepEqual(state.overrides, {});
  state = editorReducer(state, { type: 'redo' });
  assert.deepEqual(state.overrides['way/-1'].properties.nodeIds, ['2', '3']);
  assert.equal(state.overrides['relation/30'].properties.members.length, 2);
});
test('pan/refresh preserves original versions of edited/deleted entities and undo history', () => {
  const input = way(10, [1, 2, 3]);
  let state = editorReducer(initialState, { type: 'hydrate', features: [input] });
  state = editorReducer(state, { type: 'commit-many', label: 'Edit', mutations: removeVertex(input, '2').mutations });
  state = editorReducer(state, { type: 'hydrate', features: [] });
  assert.equal(state.baseFeatures['way/10'].properties.version, 1);
  const serverNewer = { ...input, properties: { ...input.properties, version: 2 } };
  state = editorReducer(state, { type: 'hydrate', features: [serverNewer] });
  assert.equal(state.baseFeatures['way/10'].properties.version, 1);
  state = editorReducer(state, { type: 'undo' });
  state = editorReducer(state, { type: 'hydrate', features: [] });
  state = editorReducer(state, { type: 'redo' });
  assert.deepEqual(state.overrides['way/10'].properties.nodeIds, ['1', '3']);
});
test('merge upload includes modify/delete and split upload includes modify/create', () => {
  const a = way(10, [1, 2, 3]), b = way(20, [3, 4]);
  for (const [result, expected] of [
    [splitFeature(a, '2', '-1', [a]), ['modify', 'create']],
    [mergeFeatures(a, b, [a, b]), ['modify', 'delete']]
  ]) {
    const byKey = new Map([a, b].map(f => [`way/${f.properties.entityId}`, f]));
    const payload = toUploadChanges(result.mutations.map((m, id) => ({ ...m, id, before: byKey.get(m.key), after: m.feature, label: 'Topology' })));
    assert.deepEqual(payload.map(p => p.operation), expected);
    assert.equal(payload[0].entity.version, 1);
  }
});

test('drawing extension reuses a local tagged endpoint without overwriting its entity', () => {
  const input = way(10, [-1, 2]);
  const point = { type: 'Feature', properties: { entityType: 'node', entityId: '-1', version: 0, tags: { shop: 'motorcycle_repair', name: 'Shop' } }, geometry: { type: 'Point', coordinates: [-1, 1] } };
  const result = planDrawing([input, point], [{ nodeId: '-1', coordinate: [-1, 1] }, { nodeId: '-2', coordinate: [-2, 1] }], 'line', () => { throw new Error('Must keep original way id'); }, { key: 'way/10', endpoint: '-1' });
  assert.deepEqual(result.mutations.map(m => m.key), ['node/-2', 'way/10']);
  assert.deepEqual(result.way.properties.nodes[1].tags, point.properties.tags);
  assert.equal(result.way.properties.nodes[1].version, 0);
  assert.deepEqual(result.way.properties.nodeIds, ['-2', '-1', '2']);
});
test('snapping into later then earlier segments keeps node references ordered', () => {
  const input = way(10, [1, 2, 3, 4]);
  const snap = (nodeId, x, segmentIndex) => ({ nodeId, coordinate: [x, 1], segment: { wayId: '10', segmentIndex, coordinate: [x, 1], distanceSquared: 0 } });
  const result = planDrawing([input], [snap('-1', 3.5, 2), snap('-2', 1.5, 0), snap('-3', 3.25, 2)], 'line', () => '-10');
  assert.deepEqual(result.mutations.find(m => m.key === 'way/10').feature.properties.nodeIds, ['1', '-2', '2', '3', '-3', '-1', '4']);
  assert.equal(new Set(result.mutations.map(m => m.key)).size, result.mutations.length);
});
test('dependency hydration keeps dirty relation baseline and undo restores a deleted local way', () => {
  const a = way(10, [1, 2]), b = way(20, [2, 3]);
  const rel = relation(30, 'multipolygon', [[10, 'outer'], [20, 'outer']]);
  let state = editorReducer(initialState, { type: 'hydrate', features: [a, b] });
  state = editorReducer(state, { type: 'hydrate-support', features: [rel] });
  state = editorReducer(state, { type: 'commit-many', label: 'Merge', mutations: mergeFeatures(a, b, [a, b, rel]).mutations });
  const newer = { ...rel, properties: { ...rel.properties, version: 8 } };
  state = editorReducer(state, { type: 'hydrate-support', features: [newer] });
  assert.equal(state.baseFeatures['relation/30'].properties.version, 1);
  state = editorReducer(state, { type: 'hydrate', features: [] });
  assert.equal(state.baseFeatures['way/20'].properties.version, 1);
  state = editorReducer(state, { type: 'undo' });
  assert.deepEqual(state.overrides, {});
  state = editorReducer(state, { type: 'redo' });
  assert.equal(state.overrides['way/20'], null);
});

test('undo reverses repeated edits to the same entity inside one transaction', () => {
  const input = way(10, [1, 2, 3, 4]);
  const first = removeVertex(input, '2').selected;
  const second = removeVertex(first, '3').selected;
  let state = editorReducer(initialState, { type: 'hydrate', features: [input] });
  state = editorReducer(state, { type: 'commit-many', label: 'Batch', mutations: [{ key: 'way/10', feature: first }, { key: 'way/10', feature: second }] });
  state = editorReducer(state, { type: 'undo' });
  assert.deepEqual(state.overrides, {});
  state = editorReducer(state, { type: 'redo' });
  assert.deepEqual(state.overrides['way/10'].properties.nodeIds, ['1', '4']);
});

test('store snapshots are isolated from subsequent caller geometry mutations', () => {
  const input = way(10, [1, 2, 3]);
  const state = editorReducer(initialState, { type: 'hydrate', features: [input] });
  input.geometry.coordinates[0][0] = 999;
  assert.deepEqual(state.baseFeatures['way/10'].geometry.coordinates[0], [1, 1]);
});
