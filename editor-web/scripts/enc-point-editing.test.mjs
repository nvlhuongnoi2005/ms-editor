import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadSource } from './test-source.mjs';
const schema = JSON.parse(await readFile(new URL('../../editor-api/internal/enc/editing_schema.generated.json',import.meta.url),'utf8'));
// Bare module imports need a file URL when executing TypeScript through data URLs.
const specURL = import.meta.resolve('@maplibre/maplibre-gl-style-spec');
const symbols = await import(await loadSource('../src/domains/enc/pointSymbols.ts',{'@maplibre/maplibre-gl-style-spec':specURL}));
const {parseAttributeInput,selectedAttributeOptions} = await import(await loadSource('../src/domains/enc/editingAttributes.ts'));
const classes=['BOYLAT','BOYCAR','BOYISD','BOYSAW','BOYSPP','BCNLAT','BCNCAR','BCNISD','BCNSAW','BCNSPP','LIGHTS','LNDMRK','OBSTRN','UWTROC','WRECKS'];

test('point presets resolve real sprites with valid class-specific S-57 attributes',()=>{
  const choices=symbols.pointChoices(classes);
  assert.ok(choices.length>classes.length);
  for(const option of choices){
    assert.equal(symbols.pointSymbol(option.objectClass,option.attributes),option.symbol);
    for(const [key,value] of Object.entries(option.attributes)){
      assert.ok(schema.classes[option.objectClass].attributes.includes(key),`${option.id}: ${key}`);
      const definition=schema.attributes[key];
      if(definition.options){
        const values=Array.isArray(value)?value:[value];
        for(const item of values)assert.ok(definition.options.some(choice=>choice.value===item),`${option.id}: ${key}=${item}`);
      }
    }
  }
  const red=choices.find(option=>option.symbol==='BOYLAT14');
  assert.ok(red);
  assert.equal(symbols.pointSymbol('BOYLAT',red.attributes),'BOYLAT14');
  assert.equal(symbols.pointSymbol('BOYLAT',{BOYSHP:1,COLOUR:[4]}),'BOYLAT13');
  assert.equal(symbols.normalizeSymbolSearch('ĐÈN'),'den');
});
test('attribute parsing retains signed fractional depth and rejects invalid numeric data',()=>{
  assert.deepEqual(selectedAttributeOptions(schema.attributes.COLOUR,[6,2,6]).map(option=>option.value),[6,2,6]);
  assert.equal(parseAttributeInput(schema.attributes.VALSOU,'-1.25'),-1.25);
  assert.equal(parseAttributeInput(schema.attributes.OBJNAM,'Hải đăng'),'Hải đăng');
  assert.equal(parseAttributeInput(schema.attributes.VALSOU,''),undefined);
  for(const value of ['NaN','Infinity','abc'])assert.throws(()=>parseAttributeInput(schema.attributes.VALSOU,value));
  for(const value of ['-1','1.5'])assert.throws(()=>parseAttributeInput(schema.attributes.SCAMIN,value));
  assert.throws(()=>parseAttributeInput(schema.attributes.ORIENT,'360'));
});
