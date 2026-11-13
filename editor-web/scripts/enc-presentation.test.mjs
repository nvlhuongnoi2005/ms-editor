import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpression, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { loadSource } from './test-source.mjs';

const profile = await import(await loadSource('../../Presentation_Library/runtime/profile.ts'));
const { localEncStyle } = await import(await loadSource('../src/domains/enc/style.ts'));
const defaults = profile.defaultPresentationSettings;
globalThis.window = { location: { origin: 'http://localhost' } };

test('viewer defaults include every category, names, soundings and positional quality', () => {
  assert.equal(defaults.category, 'other');
  assert.ok(defaults.names && defaults.soundings && defaults.quality);
  const style = localEncStyle('', '', 'day', 0, false, 6, 6, defaults.category, defaults);
  for (const id of ['enc-names', 'enc-soundings', 'enc-position-quality-enc']) {
    const layer = style.layers.find(layer => layer.id === id);
    assert.ok(layer, id);
    assert.notEqual(layer.layout?.visibility, 'none', id);
    assert.ok(!JSON.stringify(layer.filter).includes('s52_display_category'), id);
  }
});

test('presentation settings reject unsafe ordering and malformed storage, keeping defaults independent', () => {
  for (const patch of [{ shallowContour: 7 }, { deepContour: 5 }, { safetyDepth: NaN }, { safetyDepth: -1 }, { shades: 3 }, { category: 'invalid' }, { names: 'true' }]) {
    assert.throws(() => profile.validatePresentationSettings({ ...defaults, ...patch }));
  }
  for (const getItem of [() => '{', () => JSON.stringify({ ...defaults, deepContour: 1 }), () => { throw Error('denied'); }]) {
    assert.deepEqual(profile.readPresentationSettings({ getItem }), defaults);
  }
  const restored = profile.readPresentationSettings({ getItem: () => JSON.stringify({ ...defaults, safetyDepth: 9 }) });
  assert.equal(restored.safetyDepth, 9);
  restored.names = false;
  assert.equal(defaults.names, true);
});

test('applied settings produce valid styles, updated safety tile context and explicit visibility', () => {
  for (const theme of ['day', 'dusk', 'night']) for (const shades of [2, 4]) {
    const settings = { ...defaults, shades, names: false, soundings: false, quality: false, safetyDepth: 9, safetyContour: 10 };
    const style = localEncStyle('cellset', 'TEST', theme, 5, false, 6, 6, 'other', settings);
    assert.deepEqual(validateStyleMin(style).map(error => error.message), []);
    const url = new URL(style.sources.enc.tiles[0]);
    assert.equal(url.searchParams.get('safetyDepth'), '9');
    assert.equal(url.searchParams.get('safetyContour'), '10');
    assert.equal(url.searchParams.get('portrayal'), String(profile.presentationLibrary.rendererVersion));
    assert.equal(style.layers.find(layer => layer.id === 'enc-soundings').layout.visibility, 'none');
    assert.equal(style.layers.find(layer => layer.id === 'enc-names').layout.visibility, 'none');
    assert.equal(style.metadata['presentation:status'], 'partial');
  }
});

test('two and four shade modes use configured depths and next available safety contour', () => {
  const colours = shades => {
    const style = localEncStyle('', '', 'day', 0, false, 6, 6, 'other', { ...defaults, shades });
    const layer = style.layers.find(layer => layer.paint?.['fill-color'] && layer.id.includes('depth'));
    assert.ok(layer);
    const expression = createExpression(layer.paint['fill-color'], 'depth-colour', { type: 'color' });
    assert.equal(expression.result, 'success');
    return depth => JSON.stringify(expression.value.evaluate({ zoom: 12 }, { properties: { DRVAL1: depth, s52_safety_contour: 10 } }));
  };
  const two = colours(2), four = colours(4);
  assert.equal(two(1), two(8));
  assert.notEqual(two(8), two(11));
  assert.notEqual(four(1), four(8));
  assert.notEqual(four(8), four(11));
  assert.notEqual(four(11), four(40));
});
