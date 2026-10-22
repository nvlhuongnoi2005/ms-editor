import * as maplibregl from './node_modules/maplibre-gl/dist/maplibre-gl.mjs';

const entities = {
  'w-2001': { type: 'way', id: 2001, name: 'Đường Nguyễn Huệ', tags: { highway: 'pedestrian', name: 'Nguyễn Huệ', surface: 'paving_stones' }, geometry: '18 nodes · 612 m', layer: 'roads' },
  'w-3402': { type: 'way', id: 3402, name: 'Khách sạn Rex', tags: { building: 'hotel', name: 'Rex Hotel' }, geometry: '12 nodes · area 4,824 m²', layer: 'buildings' },
  'w-3403': { type: 'way', id: 3403, name: 'Trung tâm thương mại', tags: { building: 'retail', levels: '6' }, geometry: '9 nodes · area 2,108 m²', layer: 'buildings' },
  'w-3404': { type: 'way', id: 3404, name: 'Nhà phố', tags: { building: 'yes' }, geometry: '7 nodes · area 830 m²', layer: 'buildings' },
  'n-5520': { type: 'node', id: 5520, name: 'Nhà hát Thành phố', tags: { tourism: 'attraction', name: 'Nhà hát Thành phố' }, geometry: '10.77655, 106.70312', layer: 'pois' },
  'n-5521': { type: 'node', id: 5521, name: 'Trạm xe buýt', tags: { highway: 'bus_stop' }, geometry: '10.77482, 106.70005', layer: 'pois' },
  'n-5522': { type: 'node', id: 5522, name: 'Bưu điện Thành phố', tags: { amenity: 'post_office' }, geometry: '10.77923, 106.69968', layer: 'pois' },
  'n-1001': { type: 'node', id: 1001, name: 'Nút giao Nguyễn Huệ', tags: {}, geometry: '10.77596, 106.70231', layer: 'roads' }
};
const state = { selected: 'w-2001', changes: [], undo: [], redo: [], revision: 0, mode: 'select', saving: false };
let liveEditor;
const $ = s => document.querySelector(s);
const inspector = $('#inspector');

function entityIcon(entity) { return entity.type === 'node' ? '●' : '▱'; }
function makeSnapshot() { return JSON.stringify({ entities, graph: liveEditor?.snapshot() || null }); }
function restore(snapshot) {
  const saved = JSON.parse(snapshot);
  Object.keys(entities).forEach(key => delete entities[key]);
  Object.assign(entities, saved.entities);
  liveEditor?.restore(saved.graph);
  render();
}
function registerChange(message, before = makeSnapshot()) { state.undo.push(before); state.redo = []; state.changes.push(message); render(); }
function renderInspector() {
  const e = entities[state.selected];
  if (!e) { inspector.innerHTML = '<div class="empty"><div><b>⌁</b><p>Chọn một đối tượng trên bản đồ để xem thuộc tính và chỉnh sửa tags.</p></div></div>'; return; }
  const tags = Object.entries(e.tags).map(([key, value]) => `<div class="tag"><input value="${key}" data-key="${key}" readonly><input value="${value}" data-value="${key}"><button data-remove="${key}" title="Xóa tag">×</button></div>`).join('') || '<p class="entity-id">Chưa có tag</p>';
  inspector.innerHTML = `<div class="inspect-head"><span class="entity-kind">${entityIcon(e)} ${e.type}</span><h1 class="entity-title">${e.name}</h1><span class="entity-id">OSM ${e.type} #${e.id} · version ${e.version ?? '–'}</span></div><div class="inspector-section"><h3>THẺ DỮ LIỆU</h3>${tags}<button class="add-tag" id="add-tag">＋ Thêm thẻ</button></div><div class="inspector-section"><h3>HÌNH HỌC</h3><div class="geometry"><div><span>Topology</span><b>${e.geometry}</b></div><div><span>Trạng thái</span><b>Hợp lệ</b></div></div></div><div class="inspector-section"><div class="warning"><b>◒</b><span>Preview nằm trong Graph của session. Chỉ refresh từ DB sau khi lưu thành công.</span></div></div><div class="inspector-section"><button class="delete" id="delete-entity">Xóa đối tượng</button></div>`;
  inspector.querySelectorAll('[data-value]').forEach(input => input.addEventListener('change', event => {
    const key = event.target.dataset.value;
    const before = makeSnapshot();
    e.tags[key] = event.target.value;
    if (key === 'name') e.name = event.target.value || `${e.type} ${e.id}`;
    liveEditor?.syncEntity(e);
    registerChange(`Cập nhật ${key} của ${e.name}`, before);
  }));
  $('#add-tag').onclick = () => { const before = makeSnapshot(); e.tags.new_tag = 'value'; liveEditor?.syncEntity(e); registerChange(`Thêm tag cho ${e.name}`, before); };
  inspector.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => { const before = makeSnapshot(); const key = button.dataset.remove; delete e.tags[key]; if (key === 'name') e.name = `${e.type} ${e.id}`; liveEditor?.syncEntity(e); registerChange(`Xóa tag của ${e.name}`, before); });
  $('#delete-entity').onclick = () => toast('Xóa sẽ được gửi như một thao tác changeset.');
}
function renderRecent() { $('#recent-list').innerHTML = state.changes.slice(-3).reverse().map(c => `<div class="recent-item"><i></i><div>${c}<small>Chưa lưu · local-admin</small></div></div>`).join('') || '<div class="recent-item"><i style="background:#b9c6c8"></i><div>Chưa có chỉnh sửa trong phiên này<small>Preview cục bộ</small></div></div>'; }
function renderChanges() {
  const n = state.changes.length;
  $('#change-count').textContent=n; $('#change-count').classList.toggle('dirty',!!n);
  $('#change-title').textContent = state.saving ? 'Đang ghi changeset vào Canonical DB…' : n ? `${n} thay đổi chưa lưu` : 'Không có thay đổi chưa lưu';
  $('#change-subtitle').textContent = n ? 'Graph session đang là preview; dữ liệu DB chưa thay đổi.' : 'Các thay đổi chỉ tồn tại trong trình duyệt đến khi bạn lưu.';
  $('#save').innerHTML = state.saving ? 'Đang lưu changeset…' : `Lưu changeset${n ? ` (${n})` : ''} <span>→</span>`;
  $('#save').disabled=!n || state.saving; $('#discard').disabled=!n || state.saving;
}
function render(){ renderInspector(); renderRecent(); renderChanges(); }
function toast(message){ const t=$('#toast'); t.textContent=message;t.classList.add('show');window.clearTimeout(toast.timer);toast.timer=window.setTimeout(()=>t.classList.remove('show'),2800); }
function select(id){ state.selected=id; document.querySelectorAll('.selected').forEach(x=>x.classList.remove('selected')); render(); }
document.querySelectorAll('[data-entity]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();select(el.dataset.entity)}));
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{state.mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===button));toast(`Công cụ: ${button.querySelector('span')?.textContent || button.title}`)});
document.querySelectorAll('[data-layer]').forEach(input=>input.onchange=()=>{const id=`feature-${input.dataset.layer}`;const feature=$(`#${id}`);if(feature)feature.classList.toggle('hidden',!input.checked)});
$('#undo').onclick=()=>{if(!state.undo.length)return;state.redo.push(makeSnapshot());restore(state.undo.pop());state.changes.pop();toast('Đã hoàn tác thay đổi gần nhất.');};
$('#redo').onclick=()=>{if(!state.redo.length)return;state.undo.push(makeSnapshot());restore(state.redo.pop());state.changes.push('Làm lại thay đổi');toast('Đã làm lại thay đổi.');};
$('#discard').onclick=()=>{if(!state.changes.length)return;liveEditor?.discard();state.changes=[];state.undo=[];state.redo=[];render();toast('Đã bỏ preview session và tải lại Graph từ DB.');};
$('#save').onclick=async()=>{
  const changes = liveEditor?.changesForSave() || [];
  if (!changes.length) return toast('Chưa có thay đổi Graph để lưu.');
  state.saving = true; render();
  try {
  const create = await fetch('/api/0.6/changeset/create', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset: 'vietnam-260901', comment: 'Editor session' }) });
    const created = await create.json();
    if (!create.ok) throw new Error(created.error || 'Không thể tạo changeset.');
    const id = created.changeset.id;
    const upload = await fetch(`/api/0.6/changeset/${id}/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) });
    const committed = await upload.json();
    if (!upload.ok) throw new Error(committed.error || 'Không thể lưu changeset.');
    const close = await fetch(`/api/0.6/changeset/${id}/close`, { method: 'PUT' });
    if (!close.ok) throw new Error('Changeset đã lưu nhưng chưa thể đóng.');
    state.revision = committed.changeset.committedRevision;
    $('#revision').textContent = state.revision;
    state.changes=[]; state.undo=[]; state.redo=[];
    state.selected = null;
    liveEditor.commitAndRefresh();
    toast(`Changeset #${id} đã lưu · revision ${state.revision}`);
  } catch (error) {
    toast(`Lưu thất bại: ${error.message}`);
  } finally { state.saving = false; render(); }
};
$('#zoom-in').onclick=()=>toast('Đã phóng to tới zoom 17');$('#zoom-out').onclick=()=>toast('Đã thu nhỏ tới zoom 15');
$('#map').onclick=()=>select(null);
render();

const SATELLITE_TILEJSON = 'http://localhost:8081/datas/satellite.json';
const DATASET_NAME = 'vietnam-260901';
const VIETNAM_CENTER = [108.0, 15.8];
const VIETNAM_ZOOM = 5.2;

const satelliteStyle = {
  version: 8,
  name: 'Satellite base map',
  sources: {
    satellite: { type: 'raster', url: SATELLITE_TILEJSON, tileSize: 256 }
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f7eeee' } },
    { id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-saturation': -0.12, 'raster-contrast': 0.04 } }
  ]
};

function tileCoordinate(lng, lat, zoom) {
  const scale = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * scale);
  const y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * scale);
  return `${zoom}/${x}/${y}`;
}

function installLiveMap() {
  const mapRoot = $('#map');
  const mapArea = document.querySelector('.map-area');
  mapRoot.onclick = null;
  mapRoot.replaceChildren();
  mapRoot.classList.add('live-map');
  const mapNode = document.createElement('div');
  mapNode.id = 'live-map';
  mapRoot.append(mapNode);

  const observer = document.createElement('section');
  observer.className = 'map-observer';
  observer.innerHTML = `<div class="observer-title"><span>LIVE TILE / GRAPH</span><b>Vietnam OSM</b></div><div class="observer-grid"><div><small>Zoom</small><strong id="live-zoom">–</strong></div><div><small>Center tile</small><strong id="live-tile">–</strong></div><div><small>Tile source</small><strong id="tile-state">Đang kết nối</strong></div><div><small>Render graph</small><strong id="graph-state">Đang chờ DB</strong></div></div>`;
  mapArea.append(observer);

  const map = new maplibregl.Map({ container: mapNode, style: satelliteStyle, center: VIETNAM_CENTER, zoom: VIETNAM_ZOOM, minZoom: 0, maxZoom: 20, attributionControl: true });
  const meta = document.querySelector('.map-meta');
  const updateReadout = () => {
    const center = map.getCenter();
    const zoom = Math.round(map.getZoom() * 10) / 10;
    meta.innerHTML = `<span>${center.lat.toFixed(5)}° N</span><span>${center.lng.toFixed(5)}° E</span><b>z ${zoom}</b>`;
    $('#live-zoom').textContent = `z ${zoom}`;
    const nativeZoom = Math.min(Math.round(map.getZoom()), 14);
    $('#live-tile').textContent = `${tileCoordinate(center.lng, center.lat, nativeZoom)}${map.getZoom() > 14 ? ' · overscale' : ''}`;
  };
  let graphAbort;
  let graphTimer;
  let graphFeatures = [];
  let graphRelations = [];
  let graphRelationFeatures = [];
  let selectedGraphFeature;
  let clickAbort;
  let selectionPulseTimer;
  let nextLocalNodeId = -1;
  let dirtyWayIds = new Set();
  let dirtyNodes = new Map();
  const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });
  const wayCoordinates = feature => feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates;
  const decorateFeature = feature => {
    const tags = feature.properties.tags || {};
    feature.properties.renderKind = tags.building ? 'building' : 'road';
    feature.properties.roadClass = tags.highway || '';
    feature.properties.nodes ||= [];
    return feature;
  };
  const selectedVertices = feature => {
    const coordinates = wayCoordinates(feature);
    const nodeIds = feature.properties.nodeIds || [];
    const count = feature.geometry.type === 'Polygon' && nodeIds[0] === nodeIds.at(-1) ? coordinates.length - 1 : coordinates.length;
    return coordinates.slice(0, count).map((coordinates, index) => ({
      type: 'Feature', properties: { index, nodeId: nodeIds[index] || '' }, geometry: { type: 'Point', coordinates }
    }));
  };
  const publishGraph = () => {
    map.getSource('editor-way-overlay')?.setData({ type: 'FeatureCollection', features: graphFeatures });
    map.getSource('editor-relation-overlay')?.setData({ type: 'FeatureCollection', features: graphRelationFeatures });
  };
  const publishSelection = () => {
    const selectedCollection = selectedGraphFeature ? { type: 'FeatureCollection', features: [selectedGraphFeature] } : emptyCollection();
    map.getSource('editor-selected-way')?.setData(selectedCollection);
    map.getSource('editor-session-preview')?.setData(selectedCollection);
    map.getSource('editor-selected-node')?.setData(selectedGraphFeature ? { type: 'FeatureCollection', features: selectedVertices(selectedGraphFeature) } : emptyCollection());
  };
  const findFeature = id => graphFeatures.find(feature => String(feature.properties.entityId) === String(id));
  const findNode = id => selectedGraphFeature?.properties.nodes?.find(node => String(node.id) === String(id))
    || graphFeatures.flatMap(feature => feature.properties.nodes || []).find(node => String(node.id) === String(id));
  const markWayDirty = feature => { dirtyWayIds.add(String(feature.properties.entityId)); decorateFeature(feature); publishGraph(); publishSelection(); };
  const markNodeDirty = (id, node = findNode(id)) => { if (node) dirtyNodes.set(String(id), node); publishGraph(); publishSelection(); };
  liveEditor = {
    snapshot: () => ({
      graphFeatures, graphRelations, graphRelationFeatures,
      selectedId: selectedGraphFeature?.properties.entityId || null,
      dirtyWayIds: [...dirtyWayIds], dirtyNodes: [...dirtyNodes.entries()], nextLocalNodeId
    }),
    restore: snapshot => {
      if (!snapshot) return;
      graphFeatures = snapshot.graphFeatures || [];
      graphRelations = snapshot.graphRelations || [];
      graphRelationFeatures = snapshot.graphRelationFeatures || [];
      selectedGraphFeature = snapshot.selectedId === null ? undefined : findFeature(snapshot.selectedId);
      dirtyWayIds = new Set(snapshot.dirtyWayIds || []);
      dirtyNodes = new Map(snapshot.dirtyNodes || []);
      nextLocalNodeId = snapshot.nextLocalNodeId ?? -1;
      publishGraph(); publishSelection();
    },
    syncEntity: entity => {
      if (entity.type === 'way') {
        const feature = findFeature(entity.id);
        if (!feature) return;
        feature.properties.tags = entity.tags;
        feature.properties.name = entity.tags.name || '';
        markWayDirty(feature);
      } else if (entity.type === 'node') {
        const node = findNode(entity.id);
        if (!node) return;
        node.tags = entity.tags;
        markNodeDirty(entity.id);
      }
    },
    changesForSave: () => {
      const nodeChanges = [...dirtyNodes.values()].map(node => ({
        operation: Number(node.id) < 0 ? 'create' : 'modify',
        entity: { type: 'node', id: Number(node.id), version: node.version || 1, tags: node.tags || {}, lon: node.coordinates[0], lat: node.coordinates[1] }
      }));
      const wayChanges = [...dirtyWayIds].map(findFeature).filter(Boolean).map(feature => ({
        operation: 'modify',
        entity: {
          type: 'way', id: Number(feature.properties.entityId), version: feature.properties.version,
          tags: feature.properties.tags || {}, nodeRefs: (feature.properties.nodes || []).map(node => Number(node.id))
        }
      }));
      return [...nodeChanges, ...wayChanges];
    },
    discard: () => { dirtyWayIds.clear(); dirtyNodes.clear(); selectedGraphFeature = undefined; refreshGraph(); },
    commitAndRefresh: () => { dirtyWayIds.clear(); dirtyNodes.clear(); selectedGraphFeature = undefined; refreshGraph(); }
  };
  const setSelectionPulse = enabled => {
    window.clearInterval(selectionPulseTimer);
    if (!map.getLayer('editor-selected-way')) return;
    const paint = opacity => {
      map.setPaintProperty('editor-selected-way', 'line-opacity', opacity);
      map.setPaintProperty('editor-selected-node', 'circle-opacity', opacity);
      map.setPaintProperty('editor-selected-node', 'circle-stroke-opacity', opacity);
    };
    if (!enabled) { paint(1); return; }
    let bright = true;
    paint(1);
    selectionPulseTimer = window.setInterval(() => {
      bright = !bright;
      paint(bright ? 1 : 0.22);
    }, 520);
  };
  const showSelectedWay = feature => {
    decorateFeature(feature);
    const id = String(feature.properties.entityId);
    const tags = feature.properties.tags || {};
    selectedGraphFeature = feature;
    const vertices = selectedVertices(feature);
    entities[`w-${id}`] = {
      type: 'way', id, name: tags.name || `Way ${id}`, tags,
      version: feature.properties.version, geometry: `${vertices.length} graph nodes · ${dirtyWayIds.has(id) ? 'Session preview' : 'Canonical DB'}`,
      layer: feature.properties.renderKind === 'building' ? 'buildings' : 'roads'
    };
    state.selected = `w-${id}`;
    publishSelection();
    if (map.getZoom() >= 17 && map.getZoom() < 18) setSelectionPulse(true);
    render();
  };
  const closestSegmentIndex = (coordinates, point) => {
    let bestIndex = 1;
    let bestDistance = Infinity;
    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const [ax, ay] = coordinates[index]; const [bx, by] = coordinates[index + 1];
      const dx = bx - ax; const dy = by - ay;
      const ratio = Math.max(0, Math.min(1, ((point.lng - ax) * dx + (point.lat - ay) * dy) / (dx * dx + dy * dy || 1)));
      const x = ax + ratio * dx; const y = ay + ratio * dy;
      const distance = (point.lng - x) ** 2 + (point.lat - y) ** 2;
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index + 1; }
    }
    return bestIndex;
  };
  const insertVertex = lngLat => {
    if (!selectedGraphFeature) return;
    const before = makeSnapshot();
    const coordinates = wayCoordinates(selectedGraphFeature);
    const index = closestSegmentIndex(coordinates, lngLat);
    const node = { id: nextLocalNodeId--, version: 0, tags: {}, coordinates: [lngLat.lng, lngLat.lat] };
    coordinates.splice(index, 0, node.coordinates);
    selectedGraphFeature.properties.nodeIds.splice(index, 0, String(node.id));
    selectedGraphFeature.properties.nodes.splice(index, 0, node);
    const entity = { type: 'node', id: String(node.id), name: `Node ${node.id}`, version: 0, tags: node.tags, geometry: `${lngLat.lat.toFixed(7)}, ${lngLat.lng.toFixed(7)}`, layer: 'roads' };
    entities[`n-${node.id}`] = entity;
    markNodeDirty(node.id);
    markWayDirty(selectedGraphFeature);
    showSelectedWay(selectedGraphFeature);
    registerChange(`Thêm node ${node.id} để bẻ way ${selectedGraphFeature.properties.entityId}`, before);
  };
  const showSelectedRelation = wayId => {
    const relation = graphRelations.find(item => item.wayIds.includes(String(wayId)));
    if (!relation) return;
    selectedGraphFeature = undefined;
    entities[`r-${relation.id}`] = {
      type: 'relation', id: relation.id, name: relation.tags.name || `Relation ${relation.id}`,
      tags: relation.tags, geometry: `${relation.wayIds.length} member ways in viewport · Canonical DB`, layer: 'boundaries'
    };
    state.selected = `r-${relation.id}`;
    map.getSource('editor-selected-way').setData(emptyCollection());
    map.getSource('editor-session-preview').setData(emptyCollection());
    map.getSource('editor-selected-node').setData(emptyCollection());
    render();
  };
  const selectNearestGraphWay = async lngLat => {
    if (map.getZoom() < 17) return;
    clickAbort?.abort();
    clickAbort = new AbortController();
    const delta = 0.00035;
    const bbox = [lngLat.lng - delta, lngLat.lat - delta, lngLat.lng + delta, lngLat.lat + delta].map(value => value.toFixed(6)).join(',');
    try {
      const response = await fetch(`/api/graph?dataset=${DATASET_NAME}&bbox=${bbox}&limit=40`, { signal: clickAbort.signal });
      const data = await response.json();
      if (!response.ok || !data.features.length) return;
      const feature = data.features[0];
      if (map.getZoom() >= 18 && !graphFeatures.some(item => item.properties.entityId === feature.properties.entityId)) {
        graphFeatures.push(feature);
        publishGraph();
      }
      showSelectedWay(feature);
    } catch (error) {
      if (error.name !== 'AbortError') toast('Không thể chọn graph tại vị trí này.');
    }
  };
  const refreshGraph = async () => {
    if (dirtyWayIds.size || dirtyNodes.size) {
      $('#graph-state').textContent = `Session preview · ${dirtyNodes.size + dirtyWayIds.size} primitive chờ lưu`;
      publishGraph(); publishSelection();
      return;
    }
    if (map.getZoom() < 17) {
      graphFeatures = [];
      graphRelationFeatures = [];
      map.getSource('editor-way-overlay')?.setData(emptyCollection());
      map.getSource('editor-relation-overlay')?.setData(emptyCollection());
      setSelectionPulse(false);
      $('#graph-state').textContent = 'Phóng to z17 để chọn chỉnh sửa';
      return;
    }
    setSelectionPulse(false);
    graphAbort?.abort();
    graphAbort = new AbortController();
    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].map(value => value.toFixed(6)).join(',');
    try {
      $('#graph-state').textContent = 'Đang tải Canonical graph';
      const response = await fetch(`/api/graph?dataset=${DATASET_NAME}&bbox=${bbox}&limit=800`, { signal: graphAbort.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Graph request failed');
      graphFeatures = data.features.map(decorateFeature);
      graphRelations = data.relations;
      const relationWays = new Map();
      data.relations.forEach(relation => relation.wayIds.forEach(wayId => {
        const current = relationWays.get(wayId) || [];
        current.push(relation.id);
        relationWays.set(wayId, current);
      }));
      graphRelationFeatures = data.features
        .filter(feature => relationWays.has(feature.properties.entityId))
        .map(feature => ({ ...feature, properties: { ...feature.properties, relationIds: relationWays.get(feature.properties.entityId) } }));
      publishGraph();
      $('#graph-state').textContent = `${data.features.length} ways · ${data.relations.length} relations`;
    } catch (error) {
      if (error.name !== 'AbortError') {
        $('#graph-state').textContent = 'Graph chưa tải được';
        toast(`Canonical graph: ${error.message}`);
      }
    }
  };
  const scheduleGraphRefresh = () => {
    window.clearTimeout(graphTimer);
    graphTimer = window.setTimeout(refreshGraph, 180);
  };

  map.on('load', () => {
    map.addSource('editor-way-overlay', { type: 'geojson', data: emptyCollection() });
    map.addSource('editor-relation-overlay', { type: 'geojson', data: emptyCollection() });
    map.addSource('editor-selected-way', { type: 'geojson', data: emptyCollection() });
    map.addSource('editor-session-preview', { type: 'geojson', data: emptyCollection() });
    map.addSource('editor-selected-node', { type: 'geojson', data: emptyCollection() });
    const roadColor = ['match', ['get', 'roadClass'], 'motorway', '#df8f70', 'trunk', '#df8f70', 'primary', '#e4ae80', 'secondary', '#edc294', '#f7f3ee'];
    const roadWidth = ['interpolate', ['linear'], ['zoom'], 6, 0.7, 11, 2, 14, 5];
    const graphColor = ['case', ['==', ['get', 'renderKind'], 'building'], '#fff8f6', roadColor];
    const graphWidth = ['case', ['==', ['get', 'renderKind'], 'building'], 1.4, roadWidth];
    map.addLayer({ id: 'editor-relation-overlay', type: 'line', source: 'editor-relation-overlay', minzoom: 18, paint: { 'line-color': '#7d3c8d', 'line-width': 3.2, 'line-opacity': 0.75, 'line-dasharray': [1.2, 1.4] } });
    map.addLayer({ id: 'editor-way-hit-area', type: 'fill', source: 'editor-way-overlay', minzoom: 18, paint: { 'fill-color': '#d12626', 'fill-opacity': 0.01 } });
    map.addLayer({ id: 'editor-way-fill', type: 'fill', source: 'editor-way-overlay', minzoom: 18, filter: ['==', ['get', 'renderKind'], 'building'], paint: { 'fill-color': '#cbb7b3', 'fill-opacity': 0.82 } });
    map.addLayer({ id: 'editor-way-overlay', type: 'line', source: 'editor-way-overlay', minzoom: 18, paint: { 'line-color': graphColor, 'line-width': graphWidth, 'line-opacity': 1 } });
    map.addLayer({ id: 'editor-way-name', type: 'symbol', source: 'editor-way-overlay', minzoom: 17, layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-size': 12, 'text-max-angle': 30 }, paint: { 'text-color': '#745c5e', 'text-halo-color': '#fffafa', 'text-halo-width': 1.2 } });
    map.addLayer({ id: 'editor-selected-fill', type: 'fill', source: 'editor-selected-way', filter: ['==', ['get', 'renderKind'], 'building'], paint: { 'fill-color': '#cbb7b3', 'fill-opacity': 0.96 } });
    map.addLayer({ id: 'editor-selected-way', type: 'line', source: 'editor-selected-way', paint: { 'line-color': graphColor, 'line-width': graphWidth, 'line-opacity': 1 } });
    map.addLayer({ id: 'editor-session-preview-fill', type: 'fill', source: 'editor-session-preview', filter: ['==', ['get', 'renderKind'], 'building'], paint: { 'fill-color': '#b51010', 'fill-opacity': 0.08 } });
    map.addLayer({ id: 'editor-session-preview-line', type: 'line', source: 'editor-session-preview', paint: { 'line-color': '#b51010', 'line-width': 3, 'line-opacity': 0.95 } });
    map.addLayer({ id: 'editor-selected-node', type: 'circle', source: 'editor-selected-node', minzoom: 17, paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#b51010', 'circle-stroke-width': 2.5 } });
    const selectWayAt = event => {
      const feature = graphFeatures.find(item => String(item.properties.entityId) === String(event.features[0].properties.entityId));
      if (feature) showSelectedWay(feature);
    };
    map.on('click', 'editor-way-overlay', selectWayAt);
    map.on('click', 'editor-way-hit-area', selectWayAt);
    map.on('click', 'editor-selected-node', event => {
      const vertex = event.features[0].properties;
      const selected = selectedVertices(selectedGraphFeature).find(item => item.properties.index === Number(vertex.index));
      if (!selected) return;
      const node = selectedGraphFeature.properties.nodes?.[Number(vertex.index)] || {};
      entities[`n-${vertex.nodeId}`] = {
        type: 'node', id: vertex.nodeId, name: node.tags?.name || `Node ${vertex.nodeId}`, version: node.version || 0, tags: node.tags || {},
        geometry: `${selected.geometry.coordinates[1].toFixed(7)}, ${selected.geometry.coordinates[0].toFixed(7)}`, layer: 'roads'
      };
      state.selected = `n-${vertex.nodeId}`;
      render();
    });
    map.on('mousedown', 'editor-selected-node', event => {
      event.preventDefault();
      const before = makeSnapshot();
      const index = Number(event.features[0].properties.index);
      const nodeId = event.features[0].properties.nodeId;
      let moved = false;
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
      const moveVertex = moveEvent => {
        moved = true;
        const coordinates = wayCoordinates(selectedGraphFeature);
        coordinates[index] = [moveEvent.lngLat.lng, moveEvent.lngLat.lat];
        if (selectedGraphFeature.geometry.type === 'Polygon' && index === 0) coordinates[coordinates.length - 1] = [...coordinates[0]];
        const node = selectedGraphFeature.properties.nodes?.[index];
        if (node) node.coordinates = [...coordinates[index]];
        if (selectedGraphFeature.geometry.type === 'Polygon' && index === 0 && selectedGraphFeature.properties.nodes?.length) selectedGraphFeature.properties.nodes[selectedGraphFeature.properties.nodes.length - 1].coordinates = [...coordinates[0]];
        publishSelection();
        publishGraph();
      };
      const finishVertex = () => {
        map.off('mousemove', moveVertex);
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
        if (moved) {
          const entity = entities[`n-${nodeId}`];
          if (entity) entity.geometry = `${selectedGraphFeature.properties.nodes[index].coordinates[1].toFixed(7)}, ${selectedGraphFeature.properties.nodes[index].coordinates[0].toFixed(7)}`;
          markNodeDirty(nodeId, selectedGraphFeature.properties.nodes?.[index]);
          registerChange(`Di chuyển node ${nodeId} (preview session)`, before);
        }
      };
      map.on('mousemove', moveVertex);
      map.once('mouseup', finishVertex);
    });
    map.on('mouseenter', 'editor-way-overlay', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'editor-way-overlay', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'editor-way-hit-area', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'editor-way-hit-area', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'editor-selected-node', () => { map.getCanvas().style.cursor = 'grab'; });
    map.on('dblclick', 'editor-selected-way', event => {
      event.preventDefault();
      event.originalEvent?.preventDefault();
      insertVertex(event.lngLat);
    });
    map.on('click', event => {
      if (!map.isStyleLoaded()) return;
      const interactiveLayers = ['editor-way-overlay', 'editor-way-hit-area', 'editor-selected-node'].filter(id => map.getLayer(id));
      const graphHit = interactiveLayers.length ? map.queryRenderedFeatures(event.point, { layers: interactiveLayers }) : [];
      if (!graphHit.length) selectNearestGraphWay(event.lngLat);
    });
    updateReadout();
    document.querySelector('.dataset-card strong').textContent = `${DATASET_NAME}.osm.pbf`;
    document.querySelector('.dataset-card small').textContent = 'Canonical DB · đang tải graph';
    document.querySelector('.crumb strong').textContent = 'Vietnam OSM — Canonical graph';
    $('#zoom-in').onclick = () => map.zoomIn({ duration: 180 });
    $('#zoom-out').onclick = () => map.zoomOut({ duration: 180 });
    document.querySelector('.map-controls button:last-child').onclick = () => map.flyTo({ center: VIETNAM_CENTER, zoom: VIETNAM_ZOOM, duration: 450 });
    $('#tile-state').textContent = 'Đã kết nối';
    scheduleGraphRefresh();
  });
  map.on('move', updateReadout);
  map.on('moveend', scheduleGraphRefresh);
  map.on('idle', () => {
    $('#tile-state').textContent = map.isSourceLoaded('satellite') ? 'Đã tải viewport' : 'Đang tải viewport';
  });
  map.on('error', event => {
    const message = event.error?.message || '';
    if (event.sourceId === 'satellite') {
      $('#tile-state').textContent = 'Tile lỗi';
      toast(`Tile source: ${message}`);
    } else if (message && !message.includes("does not exist in the map's style")) {
      console.error('MapLibre graph error:', event.error);
    }
  });
}

installLiveMap();
