import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { Pool } from 'pg';

const root = process.cwd();
const envPath = join(root, '..', 'infra', '.env');
const types = { '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' };
let pool;

function localEnv() {
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
  }));
}

function canonicalPool() {
  if (!pool) {
    const env = localEnv();
    pool = new Pool({
      host: process.env.CANONICAL_DB_HOST || '127.0.0.1',
      port: Number(process.env.CANONICAL_DB_PORT || env.POSTGRES_PORT || 5432),
      database: process.env.CANONICAL_DB_NAME || 'canonical',
      user: process.env.CANONICAL_DB_USER || 'canonical_owner',
      password: process.env.CANONICAL_DB_PASSWORD || env.CANONICAL_DB_PASSWORD
    });
  }
  return pool;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2_000_000) throw new ApiError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON.');
  }
}

function entityType(value) {
  if (!['node', 'way', 'relation'].includes(value)) throw new ApiError(400, 'Entity type must be node, way, or relation.');
  return value;
}

function integer(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new ApiError(400, `${label} must be an integer.`);
  return parsed;
}

function version(value) {
  const parsed = integer(value, 'Entity version');
  if (parsed < 1) throw new ApiError(400, 'Entity version must be positive.');
  return parsed;
}

function tags(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new ApiError(400, 'Entity tags must be an object.');
  const entries = Object.entries(value);
  if (entries.length > 256 || entries.some(([key, item]) => !key || key.length > 255 || typeof item !== 'string' || item.length > 255)) {
    throw new ApiError(400, 'Tags contain an invalid key or value.');
  }
  return Object.fromEntries(entries);
}

function bboxForNode(lonE7, latE7) {
  const epsilon = 0.000000001;
  const lon = lonE7 / 10_000_000;
  const lat = latE7 / 10_000_000;
  return `POLYGON((${lon - epsilon} ${lat - epsilon},${lon + epsilon} ${lat - epsilon},${lon + epsilon} ${lat + epsilon},${lon - epsilon} ${lat + epsilon},${lon - epsilon} ${lat - epsilon}))`;
}

function normalizeChange(change, idMap) {
  if (!change || typeof change !== 'object') throw new ApiError(400, 'Each change must be an object.');
  const operation = change.operation;
  if (!['create', 'modify', 'delete'].includes(operation)) throw new ApiError(400, 'Change operation must be create, modify, or delete.');
  const entity = change.entity && typeof change.entity === 'object' ? change.entity : change;
  const type = entityType(entity.type || entity.entityType);
  const sourceId = integer(entity.id ?? entity.entityId, 'Entity id');
  const mappedId = idMap.get(`${type}:${sourceId}`);
  const id = operation === 'create' ? mappedId : sourceId;
  if (!id || (operation !== 'create' && id < 1)) throw new ApiError(400, 'Existing entity ids must be positive.');

  const normalized = {
    operation, type, id, sourceId, version: operation === 'create' ? null : version(entity.version),
    tags: operation === 'delete' && entity.tags === undefined ? null : tags(entity.tags || {})
  };
  if (type === 'node') {
    if (operation === 'delete' && entity.lon === undefined && entity.lat === undefined) return normalized;
    const lon = Number(entity.lon);
    const lat = Number(entity.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      throw new ApiError(400, 'Node lon and lat must be valid WGS84 coordinates.');
    }
    normalized.nodeLonE7 = Math.round(lon * 10_000_000);
    normalized.nodeLatE7 = Math.round(lat * 10_000_000);
  } else if (type === 'way') {
    const references = entity.nodeRefs || entity.nodes;
    if (operation === 'delete' && references === undefined) return normalized;
    if (!Array.isArray(references) || references.length < 2) throw new ApiError(400, 'Way nodeRefs must contain at least two nodes.');
    normalized.nodeRefs = references.map(reference => {
      const sourceReference = integer(typeof reference === 'object' ? reference.id : reference, 'Way node reference');
      return idMap.get(`node:${sourceReference}`) || sourceReference;
    });
  } else {
    if (operation === 'delete' && entity.members === undefined) return normalized;
    if (!Array.isArray(entity.members)) throw new ApiError(400, 'Relation members must be an array.');
    normalized.members = entity.members.map((member, sequence) => {
      if (!member || typeof member !== 'object') throw new ApiError(400, 'Relation member must be an object.');
      const memberType = entityType(member.type);
      const sourceReference = integer(member.ref, 'Relation member reference');
      return {
        type: memberType,
        ref: idMap.get(`${memberType}:${sourceReference}`) || sourceReference,
        role: typeof member.role === 'string' ? member.role : '',
        sequence
      };
    });
  }
  return normalized;
}

function rowPayload(row) {
  return {
    type: row.entity_type,
    id: String(row.entity_id),
    version: row.version,
    visible: row.visible,
    tags: row.tags,
    ...(row.entity_type === 'node' ? { lon: row.node_lon_e7 / 10_000_000, lat: row.node_lat_e7 / 10_000_000 } : {}),
    ...(row.entity_type === 'way' ? { nodeRefs: row.node_refs } : {}),
    ...(row.entity_type === 'relation' ? { members: row.members } : {})
  };
}

async function allocateId(db, datasetId, type) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${datasetId}:${type}`]);
  const result = await db.query(
    "SELECT COALESCE(MAX(entity_id), 0) + 1 AS id FROM editor.entity_current WHERE dataset_id = $1 AND entity_type = $2::editor.entity_type",
    [datasetId, type]
  );
  return Number(result.rows[0].id);
}

async function assertWayNodesExist(db, datasetId, nodeRefs) {
  const result = await db.query(
    "SELECT entity_id FROM editor.entity_current WHERE dataset_id = $1 AND entity_type = 'node'::editor.entity_type AND visible AND entity_id = ANY($2::bigint[])",
    [datasetId, nodeRefs]
  );
  if (result.rowCount !== new Set(nodeRefs).size) throw new ApiError(409, 'A way references a missing or deleted node.');
}

async function assertRelationMembersExist(db, datasetId, members) {
  for (const member of members) {
    const result = await db.query(
      'SELECT 1 FROM editor.entity_current WHERE dataset_id = $1 AND entity_type = $2::editor.entity_type AND entity_id = $3 AND visible',
      [datasetId, member.type, member.ref]
    );
    if (!result.rowCount) throw new ApiError(409, 'A relation references a missing or deleted entity.');
  }
}

async function writeEntity(db, datasetId, changesetId, entity, existing) {
  const values = [
    datasetId, entity.type, entity.id, existing ? existing.version + 1 : 1, entity.operation !== 'delete', entity.tags,
    entity.type === 'node' ? entity.nodeLonE7 : null,
    entity.type === 'node' ? entity.nodeLatE7 : null,
    entity.type === 'way' ? entity.nodeRefs : null,
    entity.type === 'relation' ? entity.members : null,
    entity.type === 'node' ? bboxForNode(entity.nodeLonE7, entity.nodeLatE7) : null,
    changesetId
  ];
  const result = await db.query(`
    INSERT INTO editor.entity_current (
      dataset_id, entity_type, entity_id, version, visible, tags,
      node_lon_e7, node_lat_e7, node_refs, members, bbox, changeset_id, updated_at
    ) VALUES ($1, $2::editor.entity_type, $3, $4, $5, $6, $7, $8, $9, $10, ST_GeomFromText($11, 4326), $12, now())
    ON CONFLICT (dataset_id, entity_type, entity_id) DO UPDATE SET
      version = EXCLUDED.version, visible = EXCLUDED.visible, tags = EXCLUDED.tags,
      node_lon_e7 = EXCLUDED.node_lon_e7, node_lat_e7 = EXCLUDED.node_lat_e7,
      node_refs = EXCLUDED.node_refs, members = EXCLUDED.members, bbox = EXCLUDED.bbox,
      changeset_id = EXCLUDED.changeset_id, updated_at = now()
    RETURNING entity_type, entity_id, version, visible, tags, node_lon_e7, node_lat_e7, node_refs, members`, values);
  return result.rows[0];
}

async function rebuildWayBboxes(db, datasetId, changedWayIds, changedNodeIds) {
  const result = await db.query(`
    WITH affected AS (
      SELECT entity_id
      FROM editor.entity_current
      WHERE dataset_id = $1 AND entity_type = 'way'::editor.entity_type AND visible
        AND (entity_id = ANY($2::bigint[]) OR node_refs && $3::bigint[])
    ), envelopes AS (
      SELECT way.entity_id,
             ST_Envelope(ST_Collect(ST_SetSRID(ST_MakePoint(node.node_lon_e7::double precision / 10000000, node.node_lat_e7::double precision / 10000000), 4326))) AS bbox
      FROM editor.entity_current way
      JOIN affected ON affected.entity_id = way.entity_id
      JOIN LATERAL unnest(way.node_refs) AS reference(node_id) ON TRUE
      JOIN editor.entity_current node
        ON node.dataset_id = way.dataset_id AND node.entity_type = 'node'::editor.entity_type
       AND node.entity_id = reference.node_id AND node.visible
      GROUP BY way.entity_id
    )
    UPDATE editor.entity_current way SET bbox = envelopes.bbox, updated_at = now()
    FROM envelopes
    WHERE way.dataset_id = $1 AND way.entity_type = 'way'::editor.entity_type AND way.entity_id = envelopes.entity_id`,
    [datasetId, [...changedWayIds], [...changedNodeIds]]
  );
  return result.rowCount;
}

async function createChangeset(request, response) {
  const body = await readJson(request);
  const datasetName = body.dataset;
  if (typeof datasetName !== 'string' || !/^[a-z0-9-]+$/i.test(datasetName)) throw new ApiError(400, 'A dataset name is required.');
  const comment = typeof body.comment === 'string' ? body.comment.slice(0, 255) : null;
  const db = canonicalPool();
  const dataset = await db.query("SELECT id, canonical_revision FROM editor.dataset WHERE name = $1 AND state = 'ready' ORDER BY created_at DESC LIMIT 1", [datasetName]);
  if (!dataset.rowCount) throw new ApiError(409, 'The requested canonical dataset is not ready.');
  const result = await db.query(
    "INSERT INTO editor.changeset (dataset_id, status, comment, author_id, base_revision) VALUES ($1, 'open', $2, 'local-admin', $3) RETURNING id, base_revision, created_at",
    [dataset.rows[0].id, comment, dataset.rows[0].canonical_revision]
  );
  sendJson(response, 201, { changeset: { id: String(result.rows[0].id), dataset: datasetName, status: 'open', baseRevision: result.rows[0].base_revision, createdAt: result.rows[0].created_at } });
}

async function uploadChangeset(request, response, changesetId) {
  const body = await readJson(request);
  if (!Array.isArray(body.changes) || !body.changes.length || body.changes.length > 500) throw new ApiError(400, 'changes must contain between 1 and 500 items.');
  const db = await canonicalPool().connect();
  try {
    await db.query('BEGIN');
    const changeset = await db.query(`
      SELECT changeset.id, changeset.dataset_id, changeset.status, dataset.canonical_revision
      FROM editor.changeset changeset JOIN editor.dataset dataset ON dataset.id = changeset.dataset_id
      WHERE changeset.id = $1 FOR UPDATE`, [changesetId]);
    if (!changeset.rowCount) throw new ApiError(404, 'Changeset was not found.');
    const current = changeset.rows[0];
    if (current.status !== 'open') throw new ApiError(409, 'Changeset is not open for upload.');

    const idMap = new Map();
    const nextIds = new Map();
    for (const change of body.changes) {
      const raw = change?.entity && typeof change.entity === 'object' ? change.entity : change;
      if (change?.operation === 'create') {
        const type = entityType(raw?.type || raw?.entityType);
        const sourceId = integer(raw?.id ?? raw?.entityId, 'Entity id');
        const key = `${type}:${sourceId}`;
        if (idMap.has(key)) throw new ApiError(400, 'A created entity id appears more than once.');
        if (!nextIds.has(type)) nextIds.set(type, await allocateId(db, current.dataset_id, type));
        idMap.set(key, nextIds.get(type));
        nextIds.set(type, nextIds.get(type) + 1);
      }
    }
    const changes = body.changes.map(change => normalizeChange(change, idMap));
    const changedWayIds = new Set();
    const changedNodeIds = new Set();
    const audit = [];
    const diffResult = [];

    for (const change of changes) {
      const existingResult = await db.query(
        'SELECT entity_type, entity_id, version, visible, tags, node_lon_e7, node_lat_e7, node_refs, members FROM editor.entity_current WHERE dataset_id = $1 AND entity_type = $2::editor.entity_type AND entity_id = $3 FOR UPDATE',
        [current.dataset_id, change.type, change.id]
      );
      const existing = existingResult.rows[0];
      if (change.operation === 'create' && existing) throw new ApiError(409, 'Entity id already exists.');
      if (change.operation !== 'create' && !existing) throw new ApiError(404, 'Entity was not found.');
      if (existing && (existing.version !== change.version || !existing.visible)) throw new ApiError(409, 'Entity version conflict. Reload the entity before saving.');
      if (change.type === 'way' && change.operation !== 'delete') await assertWayNodesExist(db, current.dataset_id, change.nodeRefs);
      if (change.type === 'relation' && change.operation !== 'delete') await assertRelationMembersExist(db, current.dataset_id, change.members);

      const effectiveChange = change.operation === 'delete'
        ? {
            ...change,
            tags: existing.tags,
            ...(change.type === 'node' ? { nodeLonE7: existing.node_lon_e7, nodeLatE7: existing.node_lat_e7 } : {}),
            ...(change.type === 'way' ? { nodeRefs: existing.node_refs } : {}),
            ...(change.type === 'relation' ? { members: existing.members } : {})
          }
        : change;

      const after = await writeEntity(db, current.dataset_id, current.id, effectiveChange, existing);
      if (change.type === 'way') changedWayIds.add(change.id);
      if (change.type === 'node') changedNodeIds.add(change.id);
      audit.push({ operation: change.operation, before: existing ? rowPayload(existing) : null, after: rowPayload(after) });
      diffResult.push({ type: change.type, oldId: String(change.sourceId), newId: String(change.id), newVersion: after.version });
    }

    await rebuildWayBboxes(db, current.dataset_id, changedWayIds, changedNodeIds);
    const revision = await db.query('UPDATE editor.dataset SET canonical_revision = canonical_revision + 1 WHERE id = $1 RETURNING canonical_revision', [current.dataset_id]);
    const committedRevision = revision.rows[0].canonical_revision;
    for (const [sequence, item] of audit.entries()) {
      await db.query(`
        INSERT INTO editor.entity_change (changeset_id, sequence, entity_type, entity_id, operation, before_payload, after_payload)
        VALUES ($1, $2, $3::editor.entity_type, $4, $5, $6, $7)`,
        [current.id, sequence, item.after.type, Number(item.after.id), item.operation, item.before, item.after]
      );
    }
    await db.query("UPDATE editor.changeset SET status = 'committed', committed_revision = $2 WHERE id = $1", [current.id, committedRevision]);
    await db.query('INSERT INTO editor.dataset_revision (dataset_id, revision, changeset_id) VALUES ($1, $2, $3)', [current.dataset_id, committedRevision, current.id]);
    await db.query("INSERT INTO editor.outbox_event (dataset_id, revision, type, payload) VALUES ($1, $2, 'canonical.changeset.committed', $3)", [
      current.dataset_id, committedRevision, { changesetId: String(current.id), changes: diffResult }
    ]);
    await db.query('COMMIT');
    sendJson(response, 200, { changeset: { id: String(current.id), status: 'committed', committedRevision }, diffResult });
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

async function closeChangeset(response, changesetId) {
  const db = canonicalPool();
  const result = await db.query(`
    UPDATE editor.changeset SET status = 'closed', closed_at = now()
    WHERE id = $1 AND status IN ('open', 'committed')
    RETURNING id, status, committed_revision, closed_at`, [changesetId]);
  if (!result.rowCount) throw new ApiError(409, 'Changeset cannot be closed.');
  const row = result.rows[0];
  sendJson(response, 200, { changeset: { id: String(row.id), status: row.status, committedRevision: row.committed_revision, closedAt: row.closed_at } });
}

async function serveChangesetApi(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'PUT' && url.pathname === '/api/0.6/changeset/create') return createChangeset(request, response);
  const match = url.pathname.match(/^\/api\/0\.6\/changeset\/(\d+)\/(upload|close)$/);
  if (!match) throw new ApiError(404, 'API route was not found.');
  const changesetId = integer(match[1], 'Changeset id');
  if (match[2] === 'upload' && request.method === 'POST') return uploadChangeset(request, response, changesetId);
  if (match[2] === 'close' && request.method === 'PUT') return closeChangeset(response, changesetId);
  throw new ApiError(405, 'Method is not allowed for this API route.');
}

function parseBbox(value) {
  const values = String(value || '').split(',').map(Number);
  if (values.length !== 4 || values.some(value => !Number.isFinite(value))) return null;
  const [west, south, east, north] = values;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  if (east - west > 0.3 || north - south > 0.3) return null;
  return values;
}

async function serveGraph(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  const datasetName = url.searchParams.get('dataset') || 'vietnam-260901';
  const bbox = parseBbox(url.searchParams.get('bbox'));
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 260, 1), 1200);
  if (!bbox || !/^[a-z0-9-]+$/i.test(datasetName)) {
    sendJson(response, 400, { error: 'A valid, compact bbox and dataset are required.' });
    return;
  }

  try {
    const db = canonicalPool();
    const datasetResult = await db.query(
      "SELECT id FROM editor.dataset WHERE name = $1 AND state = 'ready' ORDER BY created_at DESC LIMIT 1",
      [datasetName]
    );
    if (!datasetResult.rowCount) {
      sendJson(response, 409, { error: 'The requested canonical dataset is not ready.' });
      return;
    }
    const datasetId = datasetResult.rows[0].id;
    const [west, south, east, north] = bbox;
    const waysResult = await db.query(`
      WITH viewport_ways AS (
        SELECT entity_id, version, tags, node_refs
        FROM editor.entity_current
        WHERE dataset_id = $1
          AND entity_type = 'way'::editor.entity_type
          AND visible
          AND bbox && ST_MakeEnvelope($2, $3, $4, $5, 4326)
        ORDER BY bbox <-> ST_SetSRID(ST_MakePoint(($2 + $4) / 2, ($3 + $5) / 2), 4326)
        LIMIT $6
      )
      SELECT way.entity_id, way.version, way.tags,
             jsonb_agg(jsonb_build_object(
               'id', node.entity_id,
               'version', node.version,
               'tags', node.tags,
               'coordinates', jsonb_build_array(
                 node.node_lon_e7::double precision / 10000000,
                 node.node_lat_e7::double precision / 10000000
               )
             ) ORDER BY reference.position) AS nodes
      FROM viewport_ways way
      JOIN LATERAL unnest(way.node_refs) WITH ORDINALITY AS reference(node_id, position) ON TRUE
      JOIN editor.entity_current node
        ON node.dataset_id = $1
       AND node.entity_type = 'node'::editor.entity_type
       AND node.entity_id = reference.node_id
       AND node.visible
      GROUP BY way.entity_id, way.version, way.tags
      ORDER BY way.entity_id`, [datasetId, west, south, east, north, limit]);

    const features = waysResult.rows
      .filter(way => Array.isArray(way.nodes) && way.nodes.length > 1)
      .map(way => {
        const coordinates = way.nodes.map(node => node.coordinates);
        const closed = coordinates.length > 3 && coordinates[0][0] === coordinates.at(-1)[0] && coordinates[0][1] === coordinates.at(-1)[1];
        return {
          type: 'Feature',
          id: `way-${way.entity_id}`,
          properties: {
            entityType: 'way', entityId: String(way.entity_id), version: way.version,
            name: way.tags?.name || '', tags: way.tags || {}, nodeIds: way.nodes.map(node => String(node.id)), nodes: way.nodes
          },
          geometry: closed ? { type: 'Polygon', coordinates: [coordinates] } : { type: 'LineString', coordinates }
        };
      });
    const wayIds = features.map(feature => Number(feature.properties.entityId));
    let relations = [];
    if (wayIds.length) {
      const relationResult = await db.query(`
        SELECT relation.entity_id, relation.tags,
               array_agg(DISTINCT (member ->> 'ref')::bigint) AS way_ids
        FROM editor.entity_current relation
        CROSS JOIN LATERAL jsonb_array_elements(relation.members) AS member
        WHERE relation.dataset_id = $1
          AND relation.entity_type = 'relation'::editor.entity_type
          AND relation.visible
          AND member ->> 'type' = 'way'
          AND (member ->> 'ref')::bigint = ANY($2::bigint[])
        GROUP BY relation.entity_id, relation.tags
        ORDER BY relation.entity_id
        LIMIT 60`, [datasetId, wayIds]);
      relations = relationResult.rows.map(relation => ({
        id: String(relation.entity_id), tags: relation.tags || {}, wayIds: relation.way_ids.map(String)
      }));
    }
    sendJson(response, 200, { type: 'FeatureCollection', dataset: datasetName, features, relations });
  } catch (error) {
    console.error('Canonical graph request failed:', error.message);
    sendJson(response, 500, { error: 'Unable to read the canonical graph.' });
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith('/api/graph')) {
      await serveGraph(request, response);
      return;
    }
    if (request.url?.startsWith('/api/0.6/')) {
      await serveChangesetApi(request, response);
      return;
    }
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status === 500) console.error('Editor API request failed:', error);
    sendJson(response, status, { error: error.message || 'Internal server error.' });
    return;
  }
  const path = normalize(join(root, request.url === '/' ? 'index.html' : request.url.split('?')[0]));
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': `${types[extname(path)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
  createReadStream(path).pipe(response);
});

const requestedPort = Number(process.env.PORT || 4173);
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    server.listen(0, '127.0.0.1');
    return;
  }
  throw error;
});
server.on('listening', () => {
  const { port } = server.address();
  console.log(`Map Service Editor: http://127.0.0.1:${port}`);
});
server.listen(requestedPort, '127.0.0.1');
