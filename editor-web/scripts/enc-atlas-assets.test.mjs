import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './test-source.mjs';
const {atlasAssets,bundledEncAsset}=await import(await loadSource('../src/domains/enc/atlasAssets.ts'));
test('both sprite densities and all themes resolve to the bundled canonical atlas',()=>{
  for(const theme of ['day','dusk','night'])for(const density of ['', '@2x'])for(const type of ['png','json']){
    assert.equal(bundledEncAsset(`/enc/assets/sprites/${theme}_simplified${density}.${type}`),atlasAssets[theme][type]);
  }
  assert.equal(bundledEncAsset('/enc/assets/fonts/Roboto%20Bold/0-255.pbf'),bundledEncAsset('/enc/assets/fonts/Roboto Bold/0-255.pbf'));
  assert.ok(bundledEncAsset('/enc/assets/fonts/Roboto%20Bold/256-511.pbf'));
  for(const path of ['/api/enc/workspaces/id/tiles/1/1/1.pbf','/enc/assets/sprites/unknown.png','/enc/assets/fonts/Roboto%20Bold/512-767.pbf','/assets/other.png'])assert.equal(bundledEncAsset(path),undefined);
});
