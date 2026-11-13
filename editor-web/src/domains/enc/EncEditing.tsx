import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Box, Button, CircularProgress, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { Clipboard, Copy, Download, Files, LocateFixed, MapPinPlus, Move, Redo2, RotateCcw, Save, Scissors, SquarePen, Trash2, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Marker, type Map as EncMap, type MapMouseEvent, type SymbolLayerSpecification } from 'maplibre-gl';
import { PointTypePicker } from './PointTypePicker';
import { EncAttributeFields } from './EncAttributeFields';
import { pointChoices, pointProperties, markerElement, pointRotation } from './pointSymbols';
import { encSpriteLayers } from './sprites';
import { createDraftWriter } from './draftWriter';
import { createEditPreview } from './editPreview';
import { EncTransformBox } from './EncTransformBox';
import { EncContextMenu, type EncMenuAction } from './EncContextMenu';
import { pickEncFeature } from './featurePicking';
import { createEncPoint, copyEncPoint, canCopyEncPoint } from './editCommands';
import { geometryCenter, geometryPositions, symbolScale, transformGeometry } from './geometryTransform';
import type { EncTheme } from './style';
import { readDraft, writeDraft } from '../../features/editor/drafts';
import { acknowledgeCommit, changeFeature, commitChanges, createEncWorkspace, draftKey, EncEditingError, initialEditing, loadEncFeature, loadEncWorkspace, saveEncWorkspace, travelHistory, validateEditingDraft, sameDocument,
  type EncCredentials, type EncEditFeature, type EncEditState, type EncWorkspace } from './editing';

type Props = {
  map: EncMap | null; selected: Record<string, unknown> | null;
  cell?: { name: string; revisionId?: string }; sidebarOpen: boolean; enabled: boolean; theme?:EncTheme;
  onActive: (workspace: EncCredentials | null) => void;
  onClearSelection: () => void;
  selectionPending?: boolean;
};
const activeKey = 'enc:active-editing';
const emptyCollection = { type: 'FeatureCollection' as const, features: [] };

export function EncEditing({ map, selected, cell, sidebarOpen, enabled, theme='day', onActive, onClearSelection, selectionPending=false }: Props) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [controlHost, setControlHost] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useState<EncEditState | null>(null);
  const current = useRef(state); current.current = state;
  const [config, setConfig] = useState<EncWorkspace | null>(null);
  const [focused, setFocused] = useState<EncEditFeature | null>(null);
  const originals = useRef<Record<string, EncEditFeature>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [context,setContext]=useState<{top:number;left:number;coordinate:[number,number];feature:EncEditFeature|null;loading:boolean}|null>(null);
  const [clipboard,setClipboard]=useState<EncEditFeature|null>(null);
  const contextGeneration=useRef(0);
  const closeContext=useCallback(()=>{contextGeneration.current++;setContext(null);},[]);
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [newPoint, setNewPoint] = useState(() => pointChoices(['LNDMRK'])[0]);
  const [attributeInvalid, setAttributeInvalid] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [coordinates, setCoordinates] = useState(['', '']);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const backup = useRef<unknown>(null);
  const [restoreRevision, setRestoreRevision] = useState('');
  const draftRevision = useRef<string | null>(null);
  const generation = useRef(0);
  const renderPreview = useRef<() => void>(() => {});
  const locked = busy || storageBlocked || Boolean(state?.pending);
  const effective = useMemo(()=>{
    const feature=focused&&state?state.documents[focused.key]??originals.current[focused.key]??null:focused;
    const source=focused&&originals.current[focused.key];
    return feature&&source&&(feature.canMove!==source.canMove||feature.canDelete!==source.canDelete)
      ?{...feature,canMove:source.canMove,canDelete:source.canDelete}:feature;
  },[focused,state?.documents]);
  const dirty = useMemo(()=>state ? commitChanges(state).length : 0,[state?.documents,state?.saved]);
  const attributeSchema = effective ? config?.attributesByClass?.[effective.objectClass] ?? config?.attributes ?? [] : [];
  useEffect(()=>{
    if(deleteOpen)map?.getContainer().querySelector('[data-enc-delete-confirmation]')?.scrollIntoView({block:'nearest'});
  },[deleteOpen,effective?.key,map]);

  // Register after the navigator so the compact launcher follows it on every viewport.
  useEffect(() => {
    if (!map || (!enabled && !state)) return;
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group enc-edit-control';
    const control = { onAdd: () => container, onRemove: () => container.remove() };
    map.addControl(control, 'top-right');
    setControlHost(container);
    return () => { map.removeControl(control); setControlHost(null); };
  }, [map, enabled, Boolean(state)]);

  const writer = useMemo(()=>createDraftWriter<EncEditState>(async next=>{
      // Editing state is immutable. IndexedDB takes its own snapshot at store.put.
      const record = { ...next, revision:crypto.randomUUID() };
      await writeDraft(draftKey(record.workspace.baseRevision), draftRevision.current, record);
      draftRevision.current = record.revision;
    },reason=>{setStorageBlocked(true);setError(reason instanceof Error ? reason.message : 'Không ghi được bản nháp. Hãy xuất bản sao.');}),[]);
  const persist = useCallback((next: EncEditState) => {writer.schedule(next);return writer.flush();},[writer]);
  const update = useCallback((next: EncEditState) => {
    current.current = next; setState(next); setNotice('');
    writer.schedule(next);
  }, [writer]);
  useEffect(()=>()=>{void writer.flush().catch(()=>{});},[writer]);

  const open = useCallback(async (revision: string, resumeOnly = false) => {
    if (busy || current.current) return;
    setBusy(true); setError('');
    try {
      const stored = await readDraft(draftKey(revision));
      backup.current = stored; setHasBackup(Boolean(stored));
      let draft: EncEditState;
      if (stored) { draft = validateEditingDraft(stored, revision); draftRevision.current = draft.revision; }
      else {
        if (resumeOnly) throw new Error('Không tìm thấy bản nháp. Chọn cell để mở không gian biên tập.');
        draftRevision.current = null;
        const workspace = { id: crypto.randomUUID(), token: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''), baseRevision: revision };
        draft = initialEditing(workspace, { id: workspace.id, baseRevision: revision, version: 0, cellName: cell?.name ?? '', features: [], attributes: [], pointClasses: [], sourceChanged: false });
        // Keep the same credentials if the create response is lost.
        await persist(draft);
      }
      localStorage.setItem(activeKey, revision);
      originals.current={};generation.current++;setFocused(null);
      current.current = draft; setState(draft); onActive(draft.workspace);
      await createEncWorkspace(draft.workspace);
      const server = await loadEncWorkspace(draft.workspace);
      setConfig(server);
      if (server.bounds) map?.fitBounds([[server.bounds[0], server.bounds[1]], [server.bounds[2], server.bounds[3]]], { padding: 80, maxZoom: 15, duration: 0 });
      if (draft.pending) {
        setNotice('Lần lưu trước chưa được xác nhận. Bấm Lưu để kiểm tra và tiếp tục đúng lần lưu đó.');
      } else if (server.version !== draft.version) {
        if (commitChanges(draft).length) {
          setStorageBlocked(true); setError('Không gian biên tập đã thay đổi ở tab khác. Xuất bản sao trước khi tải lại.');
        } else {
          draft = initialEditing(draft.workspace, server); current.current = draft; setState(draft); await persist(draft);
        }
      }
      setRestoreRevision(''); setHasBackup(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }, [busy, cell?.name, map, onActive, persist]);

  useEffect(() => {
    try { setRestoreRevision(localStorage.getItem(activeKey) ?? ''); } catch { setError('Trình duyệt đang chặn lưu trữ. Cho phép lưu trữ trước khi biên tập.'); }
  }, []);
  useEffect(() => { onActive(state?.workspace ?? null); }, [state?.workspace.id, onActive]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (current.current && (commitChanges(current.current).length || current.current.pending || writer.hasPending())) { event.preventDefault(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [writer]);

  useEffect(() => {
    if (!state || !selected?.edit_key || creating || busy) return;
    if (selected.revision_id && selected.revision_id !== state.workspace.baseRevision) return;
    const id = ++generation.current;
    const key = String(selected.edit_key);
    setError(''); setDeleteOpen(false);
    const cached = current.current?.documents[key] ?? originals.current[key];
    if (cached && (cached.sourceId.startsWith('new:')||originals.current[key])) { setFocused(cached); return; }
    void loadEncFeature(state.workspace, key).then(feature => {
      if (id !== generation.current) return;
      originals.current[key] = feature; setFocused(feature);
    }).catch(reason => { if (id === generation.current) setError(reason.message); });
    return () => { generation.current++; };
  }, [selected, state?.workspace.id, creating, busy]);

  useEffect(() => {
    if (effective?.geometry.type === 'Point') setCoordinates((effective.geometry.coordinates as number[]).slice(0, 2).map(String));
  }, [effective]);

  useEffect(()=>{
    if(!map||!state)return;
    const openMenu=(event:MapMouseEvent & {editKey?:string})=>{
      event.originalEvent.preventDefault();
      const workspace=current.current?.workspace;if(!workspace)return;
      const hit=event.editKey?undefined:pickEncFeature(map,event.point);
      const key=event.editKey??(hit?.properties.edit_key as string|undefined);
      const valid=key&&(!hit?.properties.revision_id||hit.properties.revision_id===workspace.baseRevision);
      const id=++contextGeneration.current;
      const position={top:event.originalEvent.clientY,left:event.originalEvent.clientX,coordinate:[event.lngLat.lng,event.lngLat.lat] as [number,number]};
      const document=valid?current.current?.documents[key]:undefined;
      const source=valid?originals.current[key]:undefined;
      const value=document??source;
      const cached=value&&(source||value.sourceId.startsWith('new:'))?(source?{...value,canMove:source.canMove,canDelete:source.canDelete}:value):undefined;
      setContext({...position,feature:cached??null,loading:Boolean(valid&&!cached)});
      if(!valid)return;
      generation.current++;onClearSelection();
      if(cached){setFocused(cached);setDeleteOpen(false);return;}
      void loadEncFeature(workspace,key).then(feature=>{
        if(id!==contextGeneration.current||current.current?.workspace.id!==workspace.id)return;
        originals.current[key]=feature;setFocused(feature);setDeleteOpen(false);
        const document=current.current?.documents[key];
        setContext({...position,feature:document?{...document,canMove:feature.canMove,canDelete:feature.canDelete}:feature,loading:false});
      }).catch(reason=>{if(id===contextGeneration.current){setContext({...position,feature:null,loading:false});setError(reason.message);setToolsOpen(true);}});
    };
    map.on('contextmenu',openMenu);map.on('movestart',closeContext);map.on('style.load',closeContext);
    return()=>{map.off('contextmenu',openMenu);map.off('movestart',closeContext);map.off('style.load',closeContext);closeContext();};
  },[map,state?.workspace.id,onClearSelection,closeContext]);
  useEffect(()=>{
    if(!map||context||innerWidth>700||effective?.geometry.type!=='Point')return;
    const point=map.project(effective.geometry.coordinates as [number,number]);
    const canvasRect=map.getCanvas().getBoundingClientRect();
    const inspectorTop=map.getContainer().querySelector('.enc-edit-properties')?.getBoundingClientRect().top;
    const target=inspectorTop===undefined?canvasRect.height*.5:inspectorTop-canvasRect.top-40;
    if(point.y>target+20)map.panBy([0,point.y-target],{duration:0});
  },[map,effective?.key,Boolean(context)]);

  const mutate = useCallback((after: EncEditFeature | undefined, key?: string) => {
    const value = current.current;
    if (!value || locked) return;
    const featureKey = key ?? after?.key;
    if (!featureKey) return;
    try {
      // Returning to the source removes the override rather than creating a net change.
      const original = originals.current[featureKey];
      const next = after && original && sameDocument(after,original) ? undefined : after;
      update(changeFeature(value, featureKey, next)); setDeleteOpen(false);
    } catch (reason) { setError((reason as Error).message); }
  }, [locked, update]);
  const changeAttributes=useCallback((attributes:Record<string,unknown>)=>{if(effective)mutate({...effective,attributes});},[effective,mutate]);

  useEffect(() => {
    if (!map || !state) return;
    const preview = createEditPreview(map,()=>current.current?.documents??{},()=>{
        map.addSource('enc-edits', { type: 'geojson', data: emptyCollection });
        map.addLayer({ id: 'enc-edits-areas', type: 'fill', source: 'enc-edits', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#8b2235', 'fill-opacity': 0.14 } });
        map.addLayer({ id: 'enc-edits-lines', type: 'line', source: 'enc-edits', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#8b2235', 'line-width': 3 } });
        const prototype = encSpriteLayers('#172a32','#fbfaf5',theme).find(layer=>layer.id==='enc-objects') as SymbolLayerSpecification;
        map.addLayer({ id: 'enc-edits-points', type: 'symbol', source: 'enc-edits', filter: ['==', ['geometry-type'], 'Point'], layout: { ...prototype.layout, 'icon-size':['*',prototype.layout!['icon-size'] as number,['coalesce',['get','editor_symbol_scale'],1]], 'icon-allow-overlap':true, 'icon-ignore-placement':true } });
    },f=>({...pointProperties(f.objectClass,f.attributes),editor_symbol_scale:f.symbolScale??1}),reason=>setError(reason instanceof Error?reason.message:String(reason)));
    renderPreview.current = preview.schedule;
    return () => {
      renderPreview.current = () => {};
      preview.stop();
    };
  }, [map, state?.workspace.id, theme]);
  useEffect(() => { renderPreview.current(); }, [state?.documents]);

  useEffect(() => {
    if (!map || !state) return;
    const click = (event: MapMouseEvent) => {
      if (creating && !locked) {
        const feature=createEncPoint(newPoint.objectClass,newPoint.attributes,[event.lngLat.lng,event.lngLat.lat]);
        mutate(feature); setFocused(feature); onClearSelection(); setCreating(false); return;
      }
    };
    map.on('click', click);
    if (creating) map.getCanvas().style.cursor = 'crosshair';
    return () => {
      map.off('click', click);
      if (creating) map.getCanvas().style.cursor = '';
    };
  }, [map, state?.workspace.id, creating, newPoint, locked, mutate, onClearSelection]);

  useEffect(()=>{
    if (!map || !creating || locked) return;
    const element=markerElement(newPoint.objectClass,newPoint.attributes,theme);
    element.classList.add('enc-edit-placement-preview');
    const marker=new Marker({element,anchor:'center',rotationAlignment:'map',rotation:pointRotation(newPoint.objectClass,newPoint.attributes)}).setLngLat(map.getCenter()).addTo(map);
    const move=(event:MapMouseEvent)=>marker.setLngLat(event.lngLat);
    const leave=()=>{element.style.visibility='hidden';};
    const enter=()=>{element.style.visibility='visible';};
    map.on('mousemove',move); map.getCanvas().addEventListener('mouseleave',leave);map.getCanvas().addEventListener('mouseenter',enter);
    return ()=>{map.off('mousemove',move);map.getCanvas().removeEventListener('mouseleave',leave);map.getCanvas().removeEventListener('mouseenter',enter);marker.remove();};
  },[map,creating,newPoint,theme,locked]);


  const save = async () => {
    let value = current.current;
    if (!value || busy || storageBlocked || attributeInvalid) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!config) { await createEncWorkspace(value.workspace); setConfig(await loadEncWorkspace(value.workspace)); }
      if (!value.pending) {
        const changes = commitChanges(value);
        if (!changes.length) { setNotice('Các thay đổi đã được lưu.'); return; }
        if (changes.length > 500) throw new Error('Mỗi lần lưu tối đa 500 đối tượng. Hoàn tác bớt thay đổi rồi lưu theo từng đợt.');
        value = { ...value, pending: { requestId: crypto.randomUUID(), expectedVersion: value.version, changes } };
        current.current = value; setState(value);
      }
      await persist(value);
      const result = await saveEncWorkspace(value.workspace, value.pending!);
      if (result.requestId !== value.pending!.requestId) throw new Error('Phản hồi lưu không khớp yêu cầu. Bấm Lưu để kiểm tra lại.');
      value = acknowledgeCommit(value, result.version); current.current = value; setState(value);
      await persist(value); setNotice('Đã lưu thay đổi vào không gian biên tập.');
    } catch (reason) {
      if (reason instanceof EncEditingError && reason.status >= 400 && reason.status < 500 && current.current) {
        // A definite rejection did not commit; an interrupted response keeps the exact request.
        const next = { ...current.current, pending: undefined }; current.current = next; setState(next);
        try { await persist(next); } catch { setStorageBlocked(true); }
        if (reason.code === 'version_conflict' || reason.code === 'request_conflict') setStorageBlocked(true);
      }
      setError(reason instanceof Error ? reason.message : 'Chưa xác nhận được lần lưu. Bấm Lưu để kiểm tra lại.');
    } finally { setBusy(false); }
  };
  const exportCopy = () => {
    const value = current.current;
    const copy = value ? { ...value, revision: draftRevision.current ?? value.revision } : backup.current;
    if (!copy) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `enc-draft-${value?.workspace.id ?? 'backup'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const target=context?.feature;
  const canCopy=canCopyEncPoint(target,config?.pointClasses??[]);
  const addFromMenu=(feature:EncEditFeature)=>{mutate(feature);generation.current++;onClearSelection();setFocused(feature);setCreating(false);};
  const clonePoint=(feature:EncEditFeature,coordinates?:[number,number])=>copyEncPoint(feature,config?.pointClasses??[],config?.attributesByClass?.[feature.objectClass]??config?.attributes??[],coordinates);
  const resizeTarget=(factor:number)=>{
    if(!target)return;
    try{mutate(target.geometry.type==='Point'?{...target,symbolScale:symbolScale((target.symbolScale??1)*factor)}:{...target,geometry:transformGeometry(target.geometry,geometryCenter(target.geometry),[0,0],factor)});}catch(reason){setError((reason as Error).message);setToolsOpen(true);}
  };
  const canResize=Boolean(target&&!target.deleted&&target.objectClass!=='SOUNDG'&&(target.geometry.type==='Point'||target.canMove));
  const menuActions:EncMenuAction[]=[
    {id:'inspect',label:'Chỉnh sửa thuộc tính',icon:SquarePen,disabled:!target,run:()=>{if(target)setFocused(target);}},
    {id:'move',label:'Di chuyển / đổi kích thước',icon:Move,disabled:locked||!target||(!target.canMove&&!canResize),run:()=>{if(target){setFocused(target);requestAnimationFrame(()=>map?.getContainer().querySelector<HTMLElement>('.enc-transform-box')?.focus());}}},
    {id:'copy',label:'Sao chép điểm',icon:Copy,disabled:locked||!canCopy,separator:true,run:()=>{if(target)setClipboard(clonePoint(target));}},
    {id:'paste',label:'Dán điểm tại đây',icon:Clipboard,disabled:locked||!clipboard||!context||!config?.pointClasses.includes(clipboard.objectClass),run:()=>{if(clipboard&&context)addFromMenu(clonePoint(clipboard,context.coordinate));}},
    {id:'duplicate',label:'Nhân bản điểm',icon:Files,disabled:locked||!canCopy,run:()=>{if(target&&map){const p=map.project(target.geometry.coordinates as [number,number]),location=map.unproject([p.x+24,p.y+24]);addFromMenu(clonePoint(target,[location.lng,location.lat]));}}},
    {id:'cut',label:'Cắt điểm…',icon:Scissors,disabled:locked||!canCopy||!target?.canDelete,run:()=>{if(target){setClipboard(clonePoint(target));setFocused(target);setDeleteOpen(true);}}},
    {id:'add',label:`Thêm ${newPoint.objectClass} tại đây`,icon:MapPinPlus,disabled:locked||!config,run:()=>{if(context)addFromMenu(createEncPoint(newPoint.objectClass,newPoint.attributes,context.coordinate));}},
    {id:'larger',label:'Tăng kích thước 10%',icon:ZoomIn,disabled:locked||!canResize||(target?.geometry.type==='Point'&&(target.symbolScale??1)>=4),separator:true,run:()=>resizeTarget(1.1)},
    {id:'smaller',label:'Giảm kích thước 10%',icon:ZoomOut,disabled:locked||!canResize||(target?.geometry.type==='Point'&&(target.symbolScale??1)<=.5),run:()=>resizeTarget(1/1.1)},
    {id:'reset-size',label:'Khôi phục kích thước ký hiệu',icon:RotateCcw,disabled:locked||!target||target.geometry.type!=='Point'||(target.symbolScale??1)===1,run:()=>{if(target)mutate({...target,symbolScale:undefined});}},
    {id:'locate',label:'Xem toàn bộ đối tượng',icon:LocateFixed,disabled:!target,run:()=>{if(!target||!map)return;try{const p=geometryPositions(target.geometry);let w=Infinity,s=Infinity,e=-Infinity,n=-Infinity;for(const v of p){w=Math.min(w,v[0]);s=Math.min(s,v[1]);e=Math.max(e,v[0]);n=Math.max(n,v[1]);}map.fitBounds([[w,s],[e,n]],{padding:100,maxZoom:18,duration:0});}catch(reason){setError((reason as Error).message);}}},
    {id:'undo',label:'Hoàn tác',icon:Undo2,disabled:locked||!state?.undo.length,separator:true,run:()=>{if(current.current)update(travelHistory(current.current,'undo'));}},
    {id:'redo',label:'Làm lại',icon:Redo2,disabled:locked||!state?.redo.length,run:()=>{if(current.current)update(travelHistory(current.current,'redo'));}},
    {id:'save',label:state?.pending?'Kiểm tra lần lưu':'Lưu thay đổi',icon:Save,disabled:busy||storageBlocked||attributeInvalid||(!dirty&&!state?.pending),run:()=>void save()},
    {id:'delete',label:'Xóa điểm…',icon:Trash2,danger:true,separator:true,disabled:locked||!target?.canDelete||target.deleted,run:()=>{if(target){setFocused(target);setDeleteOpen(true);}}},
    {id:'deselect',label:'Bỏ chọn',icon:X,disabled:!focused,run:()=>{generation.current++;onClearSelection();setFocused(null);}},
  ];

  if (!enabled && !state) return null;
  return <>
    <EncContextMenu position={context} title={target?`${target.objectClass} · ${String(target.attributes.OBJNAM??'Đối tượng đang chọn')}`:'Công cụ biên tập ENC'} loading={context?.loading} actions={menuActions} onClose={closeContext} onError={message=>{setError(message);setToolsOpen(true);}}/>
    {!selectionPending && map && state && effective && !creating && !effective.deleted && <EncTransformBox map={map} feature={effective} theme={theme} disabled={locked} onChange={mutate} onError={setError} />}
    {controlHost && createPortal(<Tooltip title="Biên tập ENC" placement="left"><IconButton aria-label="Mở công cụ biên tập ENC" aria-expanded={toolsOpen} aria-controls={toolsOpen ? 'enc-edit-tools' : undefined} onClick={() => setToolsOpen(value => !value)} className={toolsOpen ? 'enc-edit-control-active' : ''}><SquarePen size={18} /></IconButton></Tooltip>, controlHost)}
    {toolsOpen && <Paper id="enc-edit-tools" component="section" aria-label="Biên tập ENC" elevation={0} className={`enc-edit-toolbar${!state ? ' enc-edit-start' : ''}${effective&&!creating?' has-selection':''}`} sx={state ? { left: sidebarOpen && innerWidth > 700 ? 336 : 16, right: 'auto' } : undefined} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setToolsOpen(false); controlHost?.querySelector('button')?.focus(); } }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}><Typography sx={{ fontSize: 14, fontWeight: 600 }}>Công cụ biên tập</Typography><IconButton aria-label="Thu gọn công cụ biên tập ENC" onClick={() => setToolsOpen(false)}><X size={18} /></IconButton></Stack>
      {!state ? <Stack spacing={1}>
        <Button variant="contained" disabled={busy || !cell?.revisionId || !enabled} onClick={() => cell?.revisionId && void open(cell.revisionId)}>{busy ? 'Đang mở…' : 'Biên tập cell'}</Button>
        {!cell && <Typography variant="caption">Chọn một cell trong Phạm vi hiển thị để biên tập.</Typography>}
        {restoreRevision && <Button disabled={busy} onClick={() => void open(restoreRevision, true)}>Tiếp tục bản biên tập</Button>}
        {hasBackup && <Button startIcon={<Download size={16} />} onClick={exportCopy}>Xuất bản sao bản nháp</Button>}
      </Stack> : <Stack spacing={1}>
        <Typography component="h2" sx={{ fontSize: 14, fontWeight: 600 }}>Biên tập {config?.cellName || cell?.name || 'ENC'}</Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <IconButton aria-label="Hoàn tác ENC" disabled={locked || !state.undo.length} onClick={() => update(travelHistory(state, 'undo'))}><Undo2 size={18} /></IconButton>
          <IconButton aria-label="Làm lại ENC" disabled={locked || !state.redo.length} onClick={() => update(travelHistory(state, 'redo'))}><Redo2 size={18} /></IconButton>
          <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} disabled={busy || storageBlocked || attributeInvalid || (!dirty && !state.pending && Boolean(config))} onClick={() => void save()}>{busy ? 'Đang lưu…' : state.pending ? 'Kiểm tra lần lưu' : 'Lưu'}</Button>
          <IconButton aria-label="Xuất bản sao bản nháp ENC" onClick={exportCopy}><Download size={18} /></IconButton>
        </Stack>
        <Stack spacing={1} className="enc-edit-create-tools">
          <PointTypePicker classes={config?.pointClasses??['LNDMRK']} labels={config?.classLabels} value={newPoint} onChange={setNewPoint} disabled={locked || !config} theme={theme}/>
          <Button startIcon={<MapPinPlus size={17} />} disabled={locked || !config} aria-pressed={creating} onClick={() => setCreating(value => !value)}>{creating ? 'Hủy đặt điểm' : 'Thêm điểm'}</Button>
        </Stack>
        <Typography role="status" aria-live="polite" sx={{ fontSize: 12 }}>{creating ? 'Bấm lên bản đồ để đặt điểm.' : `${dirty} thay đổi chưa lưu · ${Object.keys(state.documents).length} đối tượng trong bản biên tập`}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Lưu riêng bản biên tập; hải đồ công bố giữ nguyên.</Typography>
        {Object.keys(state.documents).length > 0 && <TextField select label="Đối tượng trong bản biên tập" size="small" value={effective && state.documents[effective.key] ? effective.key : ''} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} onChange={event => {
          const feature = state.documents[event.target.value]; if (!feature) return;
          generation.current++;onClearSelection(); setFocused(feature); setDeleteOpen(false);
          if(!feature.sourceId.startsWith('new:')&&!originals.current[feature.key]){
            const id=generation.current;
            void loadEncFeature(state.workspace,feature.key).then(source=>{if(id===generation.current){originals.current[feature.key]=source;setFocused(source);}}).catch(reason=>{if(id===generation.current)setError(reason.message);});
          }
          if (feature.geometry.type === 'Point') map?.easeTo({ center: feature.geometry.coordinates as [number, number], duration: 0 });
        }}><MenuItem value="">Chọn đối tượng</MenuItem>{Object.values(state.documents).map(feature => <MenuItem key={feature.key} value={feature.key}>{feature.objectClass} · {String(feature.attributes.OBJNAM || feature.sourceId)}{feature.deleted ? ' · Đã xóa' : ''}</MenuItem>)}</TextField>}
        {config?.sourceChanged && <Alert severity="warning">Nguồn đã có phiên bản khác. Bản biên tập vẫn giữ phiên bản ban đầu để đối soát.</Alert>}
        {dirty > 0 && !locked && (discardOpen ? <Alert severity="warning" action={<Button color="inherit" onClick={() => { update({ ...state, documents: structuredClone(state.saved), undo: [], redo: [] }); setFocused(null); setDiscardOpen(false); }}>Bỏ thay đổi</Button>}>Trở về lần lưu gần nhất? <Button color="inherit" onClick={() => setDiscardOpen(false)}>Hủy</Button></Alert> : <Button onClick={() => setDiscardOpen(true)}>Bỏ thay đổi chưa lưu</Button>)}
        {!busy && !dirty && !state.pending && !storageBlocked && <Button onClick={() => { void writer.flush().then(() => { generation.current++; setRestoreRevision(state.workspace.baseRevision); setState(null); current.current = null; setConfig(null); setFocused(null); setCreating(false); onActive(null); }).catch(reason => setError(reason.message)); }}>Về chế độ xem</Button>}
      </Stack>}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mt: 1 }}>{notice}</Alert>}
    </Paper>}
    {!selectionPending && state && effective && !creating && <Paper component="section" aria-label="Chỉnh sửa đối tượng ENC" className="enc-properties enc-edit-properties" elevation={0}>
      <Box className="enc-properties-header"><Box><Typography component="h2">Biên tập đối tượng</Typography><Typography component="h3" className="enc-properties-name">{effective.objectClass}</Typography></Box><IconButton aria-label="Đóng biên tập đối tượng" onClick={() => { generation.current++;onClearSelection(); setFocused(null); }}><X size={20} /></IconButton></Box>
      <Stack spacing={2} className="enc-properties-body" sx={{ pt: '20px !important' }}>
        {effective.deleted ? <><Alert severity="info">Đối tượng đã được đánh dấu xóa trong bản biên tập.</Alert><Button disabled={locked} onClick={() => mutate({ ...effective, deleted: false })}>Khôi phục đối tượng</Button></> : <>
          {effective.objectClass === 'SOUNDG' && <Alert severity="info">Độ sâu: {String(effective.attributes.DEPTH ?? (effective.geometry.coordinates as number[])[2] ?? '—')} m. SOUNDG được bảo vệ để giữ nhóm điểm nguồn.</Alert>}
          <EncAttributeFields key={effective.key} schema={attributeSchema} attributes={effective.attributes} disabled={locked || effective.objectClass === 'SOUNDG'} onValidityChange={setAttributeInvalid} onChange={changeAttributes}/>
          {effective.canMove && effective.geometry.type === 'Point' ? <>
            <TextField size="small" label="Kinh độ" value={coordinates[0]} disabled={locked} onChange={event => setCoordinates([event.target.value, coordinates[1]])} />
            <TextField size="small" label="Vĩ độ" value={coordinates[1]} disabled={locked} onChange={event => setCoordinates([coordinates[0], event.target.value])} />
            <Button disabled={locked} onClick={() => {
              const point = coordinates.map(Number);
              if (coordinates.some(c => !c.trim()) || point.some(n => !Number.isFinite(n)) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) { setError('Kinh độ phải từ -180 đến 180; vĩ độ từ -90 đến 90.'); return; }
              mutate({ ...effective, geometry: { type: 'Point', coordinates: point } });
            }}>Áp dụng tọa độ</Button>
          <Typography variant="caption">Kéo ký hiệu để đổi vị trí; kéo góc khung để đổi kích thước hiển thị.</Typography>
          </> : <Typography variant="caption">{effective.canMove?'Kéo đối tượng để đổi vị trí; kéo góc khung để đổi tỷ lệ đồng đều.':'Hình học có liên kết hoặc chưa đủ dữ liệu để biến đổi độc lập.'}</Typography>}
          {effective.geometry.type==='Point'&&effective.objectClass!=='SOUNDG'&&<>
            <Typography variant="caption">Kích thước ký hiệu chỉ áp dụng trong bản biên tập, từ 50% đến 400%.</Typography>
            {(effective.symbolScale??1)!==1&&<Button disabled={locked} onClick={()=>mutate({...effective,symbolScale:undefined})}>Khôi phục kích thước chuẩn</Button>}
          </>}
          {effective.canDelete && (deleteOpen ? <Alert data-enc-delete-confirmation severity="warning" action={<Button color="inherit" disabled={locked} onClick={() => { if (effective.sourceId.startsWith('new:')) { mutate(undefined, effective.key); setFocused(null); } else mutate({ ...effective, deleted: true }); }}>Xóa</Button>}>Xóa điểm khỏi bản biên tập? <Button color="inherit" onClick={() => setDeleteOpen(false)}>Hủy</Button></Alert> : <Button color="error" startIcon={<Trash2 size={16} />} disabled={locked} onClick={() => setDeleteOpen(true)}>Xóa điểm</Button>)}
          <Box component="details"><Box component="summary" sx={{ cursor: 'pointer', py: 1, fontSize: 13 }}>Thuộc tính nguồn khác</Box><Box component="dl" className="enc-properties-list">{Object.entries(effective.attributes).filter(([key]) => !attributeSchema.some(attribute => attribute.key === key)).map(([key, value]) => <Box className="enc-properties-row" key={key}><Box component="dt">{key}</Box><Box component="dd">{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</Box></Box>)}</Box></Box>
        </>}
      </Stack>
    </Paper>}
  </>;
}
