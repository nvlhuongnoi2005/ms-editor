import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './test-source.mjs';
const { toolBlockReason, summarizeGeometryImpact } = await import(await loadSource('../src/features/editor/geometryToolPresentation.ts'));
const form = { group: 'transform', operation: 'rotate', count: 1, polygonCount: 0, circularizable: false, primary: '', center: 'selection', longitude: '', latitude: '', angle: '90', scale: '100', radius: '' };

test('tool UI explains each incomplete selection and explicit primary requirement', () => {
  assert.match(toolBlockReason({ ...form, group: 'align', operation: 'align' }), /thêm 1/);
  assert.match(toolBlockReason({ ...form, group: 'align', operation: 'distribute' }), /thêm 2/);
  assert.match(toolBlockReason({ ...form, group: 'area', count: 2, polygonCount: 1 }), /không phải vùng/);
  assert.match(toolBlockReason({ ...form, group: 'area', count: 2, polygonCount: 2 }), /vùng chính/);
  assert.equal(toolBlockReason({ ...form, group: 'area', count: 2, polygonCount: 2, primary: 'way/1' }), null);
});
test('tool UI validates numeric inputs without changing the geometry command', () => {
  assert.equal(toolBlockReason(form), null);
  assert.match(toolBlockReason({ ...form, operation: 'circle' }), /khép kín/);
  assert.match(toolBlockReason({ ...form, operation: 'scale', scale: '0' }), /lớn hơn 0/);
  assert.match(toolBlockReason({ ...form, angle: '' }), /giá trị số/);
  assert.match(toolBlockReason({ ...form, center: 'custom' }), /Nhập đủ/);
  assert.match(toolBlockReason({ ...form, center: 'custom', longitude: '181', latitude: '21' }), /kinh độ/);
  assert.equal(toolBlockReason({ ...form, operation: 'circle', circularizable: true }), null);
  assert.match(toolBlockReason({ ...form, operation: 'circle', circularizable: true, radius: '-1' }), /Bán kính/);
});
test('impact summary deduplicates group nodes and distinguishes external loaded ways', () => {
  const first = { properties: { entityType: 'way', entityId: '1', nodeIds: ['10', '11'] } };
  const second = { properties: { entityType: 'way', entityId: '2', nodeIds: ['11', '12'] } };
  const group = { properties: { entityType: 'relation', entityId: '3', members: [{ type: 'way', ref: '1' }] } };
  assert.deepEqual(summarizeGeometryImpact(['relation/3'], [first, second, group]), { nodes: 2, relatedWays: 1, complete: true });
  assert.deepEqual(summarizeGeometryImpact(['way/1', 'way/2'], [first, second]), { nodes: 3, relatedWays: 0, complete: true });
  assert.equal(summarizeGeometryImpact(['relation/3'], [group]).complete, false);
});
