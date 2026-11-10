import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './test-source.mjs';
const { inspectEncArchive, validateImportName, maxEncUploadBytes } = await import(await loadSource('../src/domains/enc/imports.ts'));

function archive(names, flags = 0) {
  const entries = names.map(name => {
    const text = Buffer.from(name), header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(flags,8); header.writeUInt16LE(text.length,28);
    return Buffer.concat([header,text]);
  });
  const directory = Buffer.concat(entries), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length,8); end.writeUInt16LE(names.length,10); end.writeUInt32LE(directory.length,12);
  return new File([directory,end], 'charts.zip');
}
test('ENC import names match the API contract and reject duplicates', () => {
  assert.equal(validateImportName('great-lakes',[]),'');
  for (const name of ['', '-abc','a b','a'.repeat(81)]) assert.ok(validateImportName(name,[]));
  assert.ok(validateImportName('existing',[{name:'existing'}]));
});
test('ENC ZIP inspection counts base cells and sequential updates', async () => {
  assert.deepEqual(await inspectEncArchive(archive(['ENC_ROOT/CATALOG.031','A/A.000','A/A.001','B/B.000'])),{cells:2,updates:1});
});
test('ENC ZIP inspection rejects invalid structure before upload', async () => {
  for (const paths of [['A/A.001'],['A/A.000','A/A.002'],['A/A.000','B/A.000'],['A/A.000','a/a.000'],['../A.000'],['notes.txt']]) {
    await assert.rejects(inspectEncArchive(archive(paths)));
  }
  await assert.rejects(inspectEncArchive(archive(['A.000'],1)));
  await assert.rejects(inspectEncArchive(new File(['broken'],'file.zip')));
  await assert.rejects(inspectEncArchive(new File(['x'],'file.pbf')));
  await assert.rejects(inspectEncArchive({ name:'huge.zip',size:maxEncUploadBytes+1 }));
});
