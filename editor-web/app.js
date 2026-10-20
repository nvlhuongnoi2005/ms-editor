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
const state = { selected: 'w-2001', changes: [], undo: [], redo: [], revision: 207, mode: 'select' };
const $ = s => document.querySelector(s);
const inspector = $('#inspector');

function entityIcon(entity) { return entity.type === 'node' ? '●' : '▱'; }
function makeSnapshot() { return JSON.stringify(entities); }
function registerChange(message) { state.undo.push(makeSnapshot()); state.redo = []; state.changes.push(message); render(); }
function restore(snapshot) { Object.assign(entities, JSON.parse(snapshot)); render(); }
function renderInspector() {
  const e = entities[state.selected];
  if (!e) { inspector.innerHTML = '<div class="empty"><div><b>⌁</b><p>Chọn một đối tượng trên bản đồ để xem thuộc tính và chỉnh sửa tags.</p></div></div>'; return; }
  const tags = Object.entries(e.tags).map(([key, value]) => `<div class="tag"><input value="${key}" data-key="${key}" readonly><input value="${value}" data-value="${key}"><button data-remove="${key}" title="Xóa tag">×</button></div>`).join('') || '<p class="entity-id">Chưa có tag</p>';
  inspector.innerHTML = `<div class="inspect-head"><span class="entity-kind">${entityIcon(e)} ${e.type}</span><h1 class="entity-title">${e.name}</h1><span class="entity-id">OSM ${e.type} #${e.id} · version ${state.revision}</span></div><div class="inspector-section"><h3>THẺ DỮ LIỆU</h3>${tags}<button class="add-tag" id="add-tag">＋ Thêm thẻ</button></div><div class="inspector-section"><h3>HÌNH HỌC</h3><div class="geometry"><div><span>Topology</span><b>${e.geometry}</b></div><div><span>Trạng thái</span><b>Hợp lệ</b></div></div></div><div class="inspector-section"><div class="warning"><b>◒</b><span>Preview hiện nằm trong iD-style Graph cục bộ. Dữ liệu máy chủ chưa thay đổi.</span></div></div><div class="inspector-section"><button class="delete" id="delete-entity">Xóa đối tượng</button></div>`;
  inspector.querySelectorAll('[data-value]').forEach(input => input.addEventListener('change', event => { const key = event.target.dataset.value; const before = makeSnapshot(); e.tags[key] = event.target.value; state.undo.push(before); state.redo=[]; state.changes.push(`Cập nhật ${key} của ${e.name}`); render(); }));
  $('#add-tag').onclick = () => { const before = makeSnapshot(); e.tags['new_tag'] = 'value'; state.undo.push(before); state.redo=[]; state.changes.push(`Thêm tag cho ${e.name}`); render(); };
  inspector.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => { const before = makeSnapshot(); delete e.tags[button.dataset.remove]; state.undo.push(before); state.redo=[]; state.changes.push(`Xóa tag của ${e.name}`); render(); });
  $('#delete-entity').onclick = () => toast('Xóa sẽ được gửi như một thao tác changeset.');
}
function renderRecent() { $('#recent-list').innerHTML = state.changes.slice(-3).reverse().map(c => `<div class="recent-item"><i></i><div>${c}<small>Chưa lưu · local-admin</small></div></div>`).join('') || '<div class="recent-item"><i style="background:#b9c6c8"></i><div>Chưa có chỉnh sửa trong phiên này<small>Preview cục bộ</small></div></div>'; }
function renderChanges() { const n = state.changes.length; $('#change-count').textContent=n; $('#change-count').classList.toggle('dirty',!!n); $('#change-title').textContent=n ? `${n} thay đổi chưa lưu` : 'Không có thay đổi chưa lưu'; $('#change-subtitle').textContent=n ? 'Graph cục bộ · kiểm tra trước khi phát hành.' : 'Các thay đổi chỉ tồn tại trong trình duyệt đến khi bạn lưu.'; $('#save').disabled=!n; $('#discard').disabled=!n; }
function render(){ renderInspector(); renderRecent(); renderChanges(); }
function toast(message){ const t=$('#toast'); t.textContent=message;t.classList.add('show');window.clearTimeout(toast.timer);toast.timer=window.setTimeout(()=>t.classList.remove('show'),2800); }
function select(id){ state.selected=id; document.querySelectorAll('.selected').forEach(x=>x.classList.remove('selected')); render(); }
document.querySelectorAll('[data-entity]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();select(el.dataset.entity)}));
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{state.mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===button));toast(`Công cụ: ${button.querySelector('span')?.textContent || button.title}`)});
document.querySelectorAll('[data-layer]').forEach(input=>input.onchange=()=>{const id=`feature-${input.dataset.layer}`;const feature=$(`#${id}`);if(feature)feature.classList.toggle('hidden',!input.checked)});
$('#undo').onclick=()=>{if(!state.undo.length)return;state.redo.push(makeSnapshot());restore(state.undo.pop());state.changes.pop();toast('Đã hoàn tác thay đổi gần nhất.');};
$('#redo').onclick=()=>{if(!state.redo.length)return;state.undo.push(makeSnapshot());restore(state.redo.pop());state.changes.push('Làm lại thay đổi');toast('Đã làm lại thay đổi.');};
$('#discard').onclick=()=>{if(!state.changes.length)return;state.changes=[];state.undo=[];state.redo=[];render();toast('Đã bỏ toàn bộ preview cục bộ.');};
$('#save').onclick=()=>{const n=state.changes.length;state.revision+=1;$('#revision').textContent=state.revision;state.changes=[];state.undo=[];state.redo=[];render();toast(`Changeset đã commit · ${n} thay đổi · render job đang xếp hàng`);};
$('#zoom-in').onclick=()=>toast('Đã phóng to tới zoom 17');$('#zoom-out').onclick=()=>toast('Đã thu nhỏ tới zoom 15');
$('#map').onclick=()=>select(null);
render();
