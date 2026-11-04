import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './test-source.mjs';

const datasets = await import(await loadSource('../src/api/datasets.ts'));
const graphURL = await loadSource('../src/api/graph.ts');
const { loadGraph } = await import(graphURL);
const { loadEntitySnapshots } = await import(await loadSource('../src/api/conflicts.ts', { './graph': graphURL }));
const { createChangeset } = await import(await loadSource('../src/api/changeset.ts'));
const dataset = { id: '1', name: 'new-pbf', state: 'ready', bounds: [106, 20, 107, 21], canonicalRevision: 0, renderRevision: 0 };

test('dataset parsing accepts a one-point extract but rejects invalid or unfinished bounds', () => {
  assert.deepEqual(datasets.parseDataset(dataset), dataset);
  assert.equal(datasets.parseDataset({ ...dataset, bounds: null }).bounds, null);
  assert.deepEqual(datasets.parseDataset({ ...dataset, bounds: [106,20,106,20] }).bounds, [106,20,106,20]);
  for (const value of [{ ...dataset, state: 'importing' }, { ...dataset, bounds: [107,20,106,21] }, { ...dataset, bounds: [106,20,107,NaN] }, { ...dataset, bounds: [106,20] }]) assert.throws(() => datasets.parseDataset(value));
});

test('job parsing distinguishes queued/import stages from ready and failed', () => {
  const job = { id: '1', dataset: 'new-pbf', filename: 'data.osm.pbf', state: 'queued', bytes: 500, nodes: 0, ways: 0, relations: 0, attempts: 0, error: null, createdAt: '2026-10-28T00:00:00Z' };
  for (const state of ['queued','canonical','render','indexing','ready','failed']) assert.equal(datasets.parseImportStatus({ jobs: [{...job,state}], workerOnline: true, maxUploadBytes: 1000 }).jobs[0].state, state);
  assert.throws(() => datasets.parseImportStatus({ jobs: [{...job,state:'finished'}], workerOnline: true, maxUploadBytes: 1000 }));
});

test('graph, snapshots and changesets consistently target the selected dataset', async () => {
  const previous = globalThis.fetch, calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push([url, options]);
      return { ok: true, json: async () => url.includes('/api/graph') ? { features: [], canonicalRevision: 0 }
        : url.includes('/snapshots') ? { snapshots: [{ key:'node/1', version:1, visible:false, feature:null }], support:[] }
        : { changeset: { id:'1',status:'open' } } };
    };
    await loadGraph([106,20,106.01,20.01], undefined, 'geometry', 'new-pbf');
    await loadEntitySnapshots(['node/1'], 'new-pbf');
    await createChangeset('new-pbf', 'Test');
    assert.equal(new URL(calls[0][0], 'http://localhost').searchParams.get('dataset'), 'new-pbf');
    assert.equal(JSON.parse(calls[1][1].body).dataset, 'new-pbf');
    assert.equal(JSON.parse(calls[2][1].body).dataset, 'new-pbf');
  } finally { globalThis.fetch = previous; }
});

test('admin requests send the token and explicit non-simple header for mutations', async () => {
  const previous = globalThis.fetch, calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push([url, options]);
      return { ok:true, json:async()=>url==='/api/imports' ? {jobs:[],workerOnline:false,maxUploadBytes:1000} : {id:'1',state:'queued'} };
    };
    await datasets.loadImports('secret');
    await datasets.retryImport('abc', 'secret');
    assert.equal(calls[0][1].headers['X-Import-Token'], 'secret');
    assert.equal(calls[1][1].headers['X-Editor-Import'], '1');
    assert.equal(calls[1][1].headers['X-Import-Token'], 'secret');
  } finally { globalThis.fetch = previous; }
});

test('upload streams multipart with progress and does not mark an import ready', async () => {
  const previous = globalThis.XMLHttpRequest;
  let request;
  class XHR {
    headers = {}; upload = {}; status = 202; responseText = '{"state":"queued"}';
    constructor() { request = this; }
    open(method,url) { this.method=method;this.url=url; }
    setRequestHeader(key,value) { this.headers[key]=value; }
    send(body) { this.body=body; this.upload.onprogress({lengthComputable:true,loaded:5,total:10}); queueMicrotask(()=>this.onload()); }
  }
  try {
    globalThis.XMLHttpRequest = XHR;
    const file = new File(['fixture'], 'sample.osm.pbf'), progress = [];
    await datasets.uploadPBF(file, 'new-pbf', 'secret', value=>progress.push(value));
    assert.equal(request.method,'POST');
    assert.equal(new URL(request.url,'http://localhost').searchParams.get('dataset'),'new-pbf');
    assert.equal(request.headers['X-Editor-Import'],'1');
    assert.equal(request.headers['X-Import-Token'],'secret');
    assert.equal(request.body.get('file').name,file.name);
    assert.deepEqual(progress,[50]);
  } finally { globalThis.XMLHttpRequest=previous; }
});

test('upload rejection reports backend failure rather than claiming success', async () => {
  const previous = globalThis.XMLHttpRequest;
  class XHR { upload={}; status=409; responseText='{"error":"Dataset already exists"}'; open(){} setRequestHeader(){} send(){queueMicrotask(()=>this.onload());} }
  try {
    globalThis.XMLHttpRequest=XHR;
    await assert.rejects(datasets.uploadPBF(new File(['test'],'sample.pbf'),'duplicate','',()=>{}), /already exists/);
  } finally { globalThis.XMLHttpRequest=previous; }
});
