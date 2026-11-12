import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './test-source.mjs';
const { initialEditing, changeFeature, travelHistory, commitChanges, acknowledgeCommit, validateEditingDraft } = await import(await loadSource('../src/domains/enc/editing.ts'));
const workspace = { id: '20000000-0000-4000-8000-000000000002', token: 'a'.repeat(64), baseRevision: 'TEST-E1-U0-R1' };
const feature = () => ({ key: 'LNDMRK/new:30000000-0000-4000-8000-000000000003', sourceId: 'new:30000000-0000-4000-8000-000000000003', objectClass: 'LNDMRK', attributes: { OBJNAM: 'Tên gốc' }, geometry: { type: 'Point', coordinates: [105.123456789, 21.987654321] }, canMove: true, canDelete: true, deleted: false });
const initial = features => initialEditing(workspace, { version: 0, features: features ?? [] });
test('ENC drafts preserve exact coordinates and undo/redo after reload', () => {
  const point = feature();
  let state = changeFeature(initial(), point.key, point);
  state = changeFeature(state, point.key, { ...point, attributes: { OBJNAM: 'Tên mới' } });
  state = travelHistory(state, 'undo');
  const restored = validateEditingDraft(JSON.parse(JSON.stringify(state)), workspace.baseRevision);
  assert.deepEqual(restored.documents[point.key], point);
  assert.equal(travelHistory(restored, 'redo').documents[point.key].attributes.OBJNAM, 'Tên mới');
  restored.documents[point.key].geometry.coordinates[0] = 0;
  assert.equal(state.documents[point.key].geometry.coordinates[0], 105.123456789);
});
test('create then undo leaves no upload; deleting a saved override sends an explicit reset', () => {
  const point = feature();
  assert.deepEqual(commitChanges(travelHistory(changeFeature(initial(), point.key, point), 'undo')), []);
  assert.deepEqual(commitChanges(changeFeature(initial([point]), point.key, undefined)), [{ key: point.key, after: null }]);
});
test('lost commit responses retain the exact payload and block further edits until acknowledged', () => {
  const point = feature();
  let state = changeFeature(initial(), point.key, point);
  state.pending = { requestId: crypto.randomUUID(), expectedVersion: state.version, changes: commitChanges(state) };
  const restored = validateEditingDraft(JSON.parse(JSON.stringify(state)), workspace.baseRevision);
  assert.deepEqual(restored.pending, state.pending);
  assert.throws(() => changeFeature(restored, point.key, undefined));
  assert.throws(() => acknowledgeCommit(restored, 12));
  state = acknowledgeCommit(restored, 1);
  assert.deepEqual(commitChanges(state), []);
  assert.equal(state.pending, undefined);
  assert.equal(commitChanges(travelHistory(state, 'undo'))[0].after, null);
});
test('wrong cell, broken history, changed pending payload and invalid coordinates never restore', () => {
  const point = feature();
  const state = changeFeature(initial(), point.key, point);
  for (const mutate of [s => s.workspace.baseRevision = 'another-cell', s => s.undo[0].key = 'wrong', s => s.documents[point.key].geometry.coordinates[0] = 181, s => s.documents[point.key].canMove = 'yes', s => s.pending = { requestId: crypto.randomUUID(), expectedVersion: 0, changes: [] }]) {
    const malformed = structuredClone(state); mutate(malformed); assert.throws(() => validateEditingDraft(malformed, workspace.baseRevision));
  }
});
test('attribute key order creates no false changes and history stays bounded', () => {
  const point = feature(); point.attributes = { OBJNAM: 'A', INFORM: 'B' };
  let state = initial([point]);
  assert.deepEqual(commitChanges(changeFeature(state, point.key, { ...point, attributes: { INFORM: 'B', OBJNAM: 'A' } })), []);
  for (let i = 0; i < 200; i++) state = changeFeature(state, point.key, { ...point, attributes: { OBJNAM: String(i) } });
  assert.equal(state.undo.length, 150);
});
