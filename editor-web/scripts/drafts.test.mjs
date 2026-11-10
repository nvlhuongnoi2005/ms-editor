import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './test-source.mjs';
const { validateDraft, nextTemporaryIds, compactDraftState } = await import(await loadSource('../src/features/editor/drafts.ts', { '../../api/graph': await loadSource('../src/api/graph.ts') }));
const node = id => ({ type: 'Feature', properties: { entityType: 'node', entityId: id, version: 0, tags: { name: 'Tọa độ gốc' } }, geometry: { type: 'Point', coordinates: [105.1234567, 21.1234567] } });
const state = () => ({ baseFeatures: {}, viewportKeys: [], overrides: { 'node/-1': node('-1') }, undoStack: [{ id: 1, label: 'Tạo', changes: [{ id: 1, key: 'node/-1', label: 'Tạo', before: undefined, after: node('-1') }] }], redoStack: [], selectedKeys: ['node/-1'], selectedKey: 'node/-1', lockedKeys: [], lockedLayers: [], nextChangeId: 2, error: null, loading: false });
const draft = () => ({ schema: 1, dataset: 'dataset-a', revision: 'revision', savedAt: Date.now(), state: state() });

test('draft roundtrip preserves exact coordinates, IDs, tags and undo history without shared references', () => {
  const original = draft();
  const restored = validateDraft(JSON.parse(JSON.stringify(original)), 'dataset-a');
  assert.deepEqual(restored.state.overrides, original.state.overrides);
  assert.equal(restored.state.undoStack[0].changes[0].before, undefined);
  restored.state.overrides['node/-1'].properties.tags.name = 'Changed';
  assert.equal(original.state.overrides['node/-1'].properties.tags.name, 'Tọa độ gốc');
});

test('deleted existing entity restores its original baseline and null override/history', () => {
  const value = draft();
  value.state.baseFeatures = { 'node/1': { ...node('1'), properties: { ...node('1').properties, version: 7 } } };
  value.state.overrides = { 'node/1': null }; value.state.selectedKey = null; value.state.selectedKeys = [];
  value.state.undoStack[0].changes = [{ id: 1, key: 'node/1', label: 'Xóa', after: null }];
  const restored = validateDraft(value, 'dataset-a');
  assert.equal(restored.state.overrides['node/1'], null); assert.equal(restored.state.baseFeatures['node/1'].properties.version, 7);
});

test('wrong dataset/schema, broken keys, missing baseline for deletion and malformed history never restore partially', () => {
  for (const mutate of [d => d.dataset = 'other', d => d.schema = 2, d => d.state.overrides['node/-1'].properties.entityId = '-2', d => d.state.overrides['node/8'] = null, d => d.state.undoStack[0].changes = null, d => d.state.nextChangeId = 0]) {
    const value = draft(); mutate(value); assert.throws(() => validateDraft(value, 'dataset-a'));
  }
});

test('temporary ID allocation reserves IDs in redo and referenced nodes, not just visible overrides', () => {
  const value = state();
  value.redoStack = [{ id: 2, label: 'Redo', changes: [{ key: 'node/-8', after: node('-8') }] }];
  value.overrides['way/-5'] = { ...node('-5'), properties: { entityId: '-5', entityType: 'way', tags: {}, version: 0, nodeIds: ['-21', '-22'] } };
  assert.deepEqual(nextTemporaryIds(value), { node: -23, way: -6, relation: -1 });
});

test('workspace validates coordinates/camera/IDs and pending upload before restoration', () => {
  const value = draft();
  value.pendingUpload = '123';
  value.workspace = { mode: 'line', vertices: [{ nodeId: '-8', coordinate: [105, 21] }], extension: null, nextIds: { node: -9, way: -1, relation: -1 }, camera: { center: [105, 21], zoom: 18, bearing: 40, pitch: 20 } };
  assert.deepEqual(validateDraft(value, 'dataset-a'), value);
  for (const mutate of [d => d.workspace.vertices[0].coordinate[1] = 91, d => d.workspace.nextIds.node = 0, d => d.workspace.camera.zoom = Infinity, d => d.pendingUpload = 'wrong']) {
    const malformed = structuredClone(value); mutate(malformed); assert.throws(() => validateDraft(malformed, 'dataset-a'));
  }
});

test('compact drafts retain baseline/support/history/snapping dependencies, not unrelated viewport cache', () => {
  const value = state();
  value.baseFeatures = { 'node/1': node('1'), 'node/2': node('2'), 'node/3': node('3'), 'node/999': node('999') };
  value.baseFeatures['way/10'] = { ...node('10'), properties: { entityType: 'way', entityId: '10', version: 1, tags: {}, nodeIds: ['1', '2'] } };
  value.viewportKeys = Object.keys(value.baseFeatures);
  const workspace = { vertices: [{ nodeId: '3', coordinate: [105, 21], segment: { wayId: '10' } }] };
  const compact = compactDraftState(value, workspace);
  assert.ok(compact.baseFeatures['way/10']); assert.ok(compact.baseFeatures['node/1']); assert.ok(compact.baseFeatures['node/2']); assert.ok(compact.baseFeatures['node/3']);
  assert.equal(compact.baseFeatures['node/999'], undefined);
  assert.deepEqual(compact.overrides, value.overrides);
  assert.deepEqual(compact.undoStack, value.undoStack);
});
