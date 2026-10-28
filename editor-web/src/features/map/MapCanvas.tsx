import { createElement, useEffect, useMemo, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { Map, MapLayerMouseEvent, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import { Banknote, BusFront, Fuel, GraduationCap, Hospital, Hotel, Landmark, MapPin, ShoppingBag, TreePine, Utensils, type LucideIcon } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildTopologyGraph, snapCoordinate, type DrawMode, type SnappedVertex } from '../editor/drawing';
import type { Coordinate, EntityType, GraphFeature, SelectedEntity } from '../../types/osm';
import type { PointIconName } from './styleRules';
import { GraphTileHandoff, renderCollection, renderFeature } from './graphRendering';

export interface MapViewport {
  bbox: [number, number, number, number];
  zoom: number;
}

interface MapCanvasProps {
  features: GraphFeature[];
  pinpoint: Coordinate | null;
  drawMode: DrawMode;
  drawVertices: SnappedVertex[];
  selected: SelectedEntity | null;
  selectedVertexId: string | null;
  changedKeys: ReadonlySet<string>;
  onSelectVertex: (nodeId: string) => void;
  onBoundsChange: (viewport: MapViewport) => void;
  onSelect: (feature: GraphFeature) => void;
  onSelectEntity: (type: EntityType, id: string) => void;
  onDrawVertex: (vertex: SnappedVertex) => void;
  onFinishDrawing: () => void;
  onCancelDrawing: () => void;
  onMoveNode: (nodeId: string, coordinate: Coordinate) => void;
  onPointerStatus: (status: MapPointerStatus) => void;
}

export interface MapPointerStatus {
  longitude: number;
  latitude: number;
  zoom: number;
}

const tileStyle: StyleSpecification = {
  version: 8,
  sources: {
    satellite2: { type: 'raster', url: "http://localhost:8081/datas/satellite2.json"},
    canonicalMvt: { type: 'vector', tiles: ['/api/mvt/{z}/{x}/{y}.pbf?dataset=vietnam-260901'], minzoom: 16, maxzoom: 22 }
  },
  layers: [{ id: 'satellite2', type: 'raster', source: 'satellite2' }]
};

maplibregl.setWorkerUrl(mapLibreWorkerUrl);

function featureCollection(features: Feature[] = []): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

const emptyCollection = (): FeatureCollection => featureCollection();

function geoJsonSource(map: Map, id: string) {
  const source = map.getSource(id);
  return source instanceof maplibregl.GeoJSONSource ? source : null;
}

function coordinatesOfWay(feature: GraphFeature): Coordinate[] {
  if (feature.geometry.type === 'LineString') return feature.geometry.coordinates.map(([longitude, latitude]) => [longitude, latitude]);
  if (feature.geometry.type === 'Polygon') return (feature.geometry.coordinates[0] ?? []).map(([longitude, latitude]) => [longitude, latitude]);
  return [];
}

function selectedVertexCollection(selected: SelectedEntity | null, features: GraphFeature[]): FeatureCollection {
  if (!selected) return emptyCollection();
  const feature = features.find(item => item.properties.entityType === selected.type && item.properties.entityId === selected.id);
  if (!feature) return emptyCollection();
  if (feature.properties.entityType === 'node' && feature.geometry.type === 'Point') {
    return featureCollection([{ type: 'Feature', properties: { nodeId: feature.properties.entityId }, geometry: { type: 'Point', coordinates: feature.geometry.coordinates } }]);
  }
  if (feature.properties.entityType !== 'way' || !feature.properties.nodeIds) return emptyCollection();
  const coordinates = coordinatesOfWay(feature);
  const nodeIds = feature.properties.nodeIds;
  const count = feature.geometry.type === 'Polygon' && nodeIds.at(0) === nodeIds.at(-1) ? nodeIds.length - 1 : nodeIds.length;
  return featureCollection(nodeIds.slice(0, count).flatMap((nodeId, index) => {
      const coordinate = coordinates[index];
      return coordinate ? [{ type: 'Feature', properties: { nodeId, index }, geometry: { type: 'Point', coordinates: coordinate } }] : [];
    }));
}

function selectedFeatureCollection(selected: SelectedEntity | null, features: GraphFeature[]): FeatureCollection {
  if (!selected) return emptyCollection();
  const feature = features.find(item => item.properties.entityType === selected.type && item.properties.entityId === selected.id);
  if (!feature) return emptyCollection();
  const styled = renderFeature(feature);
  return featureCollection([{
    type: 'Feature',
    properties: styled.properties,
    geometry: styled.geometry
  }]);
}

function draftCollection(mode: DrawMode, vertices: SnappedVertex[], pointer?: SnappedVertex): FeatureCollection {
  if (mode === 'select' || !vertices.length) return emptyCollection();
  const coordinates = [...vertices.map(vertex => vertex.coordinate), ...(pointer ? [pointer.coordinate] : [])];
  const features: Feature[] = vertices.map((vertex, index) => ({
    type: 'Feature',
    properties: { first: index === 0, snapped: Boolean(vertex.nodeId || vertex.segment) },
    geometry: { type: 'Point', coordinates: vertex.coordinate }
  }));
  if (coordinates.length > 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
  if (mode === 'area' && coordinates.length > 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] } });
  return featureCollection(features);
}

function pinpointCollection(coordinate: Coordinate | null): FeatureCollection {
  return coordinate
    ? featureCollection([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coordinate } }])
    : emptyCollection();
}

const pointIconComponents = {
  generic: MapPin,
  hotel: Hotel,
  school: GraduationCap,
  hospital: Hospital,
  shop: ShoppingBag,
  food: Utensils,
  fuel: Fuel,
  bus: BusFront,
  tree: TreePine,
  atm: Banknote,
  landmark: Landmark
} satisfies Record<string, LucideIcon>;

const pointPinImageWidth = 96;
const pointPinImageHeight = 120;

function pointPinDataURI(icon: LucideIcon, variant: 'normal' | 'selection' = 'normal'): string {
  const lucideSVG = variant === 'normal'
    ? renderToStaticMarkup(createElement(icon, {
        x: 14,
        y: 12,
        width: 20,
        height: 20,
        color: '#334155',
        strokeWidth: 2.4
      }))
    : '';
  const pin = variant === 'normal'
    ? '<path d="M24 3C12 3 5 12 5 24c0 14 19 32 19 32s19-18 19-32C43 12 36 3 24 3Z" fill="#fff" stroke="#64748b" stroke-width="2" filter="url(#s)"/>'
    : '<path d="M24 3C12 3 5 12 5 24c0 14 19 32 19 32s19-18 19-32C43 12 36 3 24 3Z" fill="#dc2626" fill-opacity=".12" stroke="#dc2626" stroke-width="3.4"/>';
  const filter = variant === 'normal' ? '<defs><filter id="s" x="-30%" y="-20%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="#0f172a" flood-opacity=".34"/></filter></defs>' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pointPinImageWidth}" height="${pointPinImageHeight}" viewBox="0 0 48 60">${filter}${pin}${lucideSVG}</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function rasterizePointPin(dataURI: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = pointPinImageWidth;
      canvas.height = pointPinImageHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Không thể tạo canvas biểu tượng điểm.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.onerror = () => reject(new Error('Không thể giải mã SVG biểu tượng điểm.'));
    image.src = dataURI;
  });
}

function fallbackPointPin(): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = pointPinImageWidth;
  canvas.height = pointPinImageHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Không thể tạo biểu tượng điểm dự phòng.');
  context.scale(2, 2);
  context.beginPath();
  context.moveTo(24, 3);
  context.bezierCurveTo(12, 3, 5, 12, 5, 24);
  context.bezierCurveTo(5, 38, 24, 56, 24, 56);
  context.bezierCurveTo(24, 56, 43, 38, 43, 24);
  context.bezierCurveTo(43, 12, 36, 3, 24, 3);
  context.closePath();
  context.fillStyle = '#ffffff';
  context.fill();
  context.strokeStyle = '#64748b';
  context.lineWidth = 2;
  context.stroke();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

async function loadPointPinImages(map: Map, isDisposed: () => boolean): Promise<void> {
  const pinVariants: Array<{ name: string; icon: LucideIcon; variant: 'normal' | 'selection' }> = Object.entries(pointIconComponents).flatMap(([name, icon]) => [
    { name, icon, variant: 'normal' as const },
    { name, icon, variant: 'selection' as const }
  ]);
  await Promise.all(pinVariants.map(async ({ name, icon, variant }) => {
    const imageName = `editor-point-${variant === 'normal' ? 'pin' : 'halo'}-${name}`;
    if (map.hasImage(imageName)) {
      return;
    }
    const image = await rasterizePointPin(pointPinDataURI(icon, variant)).catch(() => fallbackPointPin());
    if (!isDisposed() && !map.hasImage(imageName)) map.addImage(imageName, image, { pixelRatio: 2 });
  }));
}

export function MapCanvas({ features, pinpoint, drawMode, drawVertices, selected, selectedVertexId, changedKeys, onSelectVertex, onBoundsChange, onSelect, onSelectEntity, onDrawVertex, onFinishDrawing, onCancelDrawing, onMoveNode, onPointerStatus }: MapCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const featuresRef = useRef(features);
  const drawModeRef = useRef(drawMode);
  const drawVerticesRef = useRef(drawVertices);
  const pinpointRef = useRef(pinpoint);
  const selectedRef = useRef(selected);
  const changedKeysRef = useRef(changedKeys);
  const callbacksRef = useRef({ onSelect, onSelectVertex, onSelectEntity, onDrawVertex, onFinishDrawing, onCancelDrawing, onMoveNode, onPointerStatus, onBoundsChange });
  const topology = useMemo(() => buildTopologyGraph(features), [features]);
  const topologyRef = useRef(topology);
  topologyRef.current = topology;
  const updateDraftRef = useRef<(pointer?: SnappedVertex) => void>(() => undefined);
  const updateGraphRef = useRef<() => void>(() => undefined);
  featuresRef.current = features;
  drawModeRef.current = drawMode;
  drawVerticesRef.current = drawVertices;
  pinpointRef.current = pinpoint;
  selectedRef.current = selected;
  changedKeysRef.current = changedKeys;
  callbacksRef.current = { onSelect, onSelectVertex, onSelectEntity, onDrawVertex, onFinishDrawing, onCancelDrawing, onMoveNode, onPointerStatus, onBoundsChange };

  useEffect(() => { updateDraftRef.current(); }, [drawMode, drawVertices]);
  useEffect(() => {
    mapRef.current?.getCanvas().style.setProperty('cursor', drawMode === 'select' ? '' : 'crosshair');
  }, [drawMode]);

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({ container: container.current, style: tileStyle, center: [104.50728, 21.59988], zoom: 16 });
    mapRef.current = map;
    let disposed = false;
    const handoff = new GraphTileHandoff(map);
    const finishGraphHandoff = () => {
      if (handoff.waiting && map.getSource('canonical-graph')) handoff.rendered(map.isSourceLoaded('canonical-graph'));
    };
    const updateGraph = () => {
      const source = geoJsonSource(map, 'canonical-graph');
      if (!source) return;
      const nextFeatures = featuresRef.current;
      const revision = handoff.begin(changedKeysRef.current);
      void source.setData(renderCollection(nextFeatures)).then(() => {
        if (disposed) return;
        handoff.settled(revision, nextFeatures);
        map.triggerRepaint();
      }).catch(error => { if (!disposed) console.error('Không thể cập nhật lớp graph:', error); });
    };
    updateGraphRef.current = updateGraph;
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container.current);
    let pointer = map.getCenter();
    let animationFrame: number | undefined;
    let selectionPulseTimer: number | undefined;
    let pointIconLoadStarted = false;
    const publishPointerStatus = () => {
      animationFrame = undefined;
      callbacksRef.current.onPointerStatus({ longitude: pointer.lng, latitude: pointer.lat, zoom: map.getZoom() });
    };
    const schedulePointerStatus = () => {
      if (animationFrame === undefined) animationFrame = window.requestAnimationFrame(publishPointerStatus);
    };
    const updateBounds = () => {
      const bounds = map.getBounds();
      callbacksRef.current.onBoundsChange({
        bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        zoom: map.getZoom()
      });
    };
    const snap = (lngLat: maplibregl.LngLat): SnappedVertex => {
      const pixel = map.project(lngLat);
      const draftNode = drawVerticesRef.current.find(vertex => map.project(vertex.coordinate).dist(pixel) <= 12);
      if (draftNode) return { coordinate: draftNode.coordinate, nodeId: draftNode.nodeId };
      const adjacent = map.unproject([pixel.x + 12, pixel.y + 12]);
      const maxDistance = Math.max(Math.abs(adjacent.lng - lngLat.lng), Math.abs(adjacent.lat - lngLat.lat));
      const coordinate: Coordinate = [lngLat.lng, lngLat.lat];
      return snapCoordinate(topologyRef.current, coordinate, maxDistance);
    };
    const updateDraft = (draftPointer?: SnappedVertex) => {
      const source = geoJsonSource(map, 'editor-draw-preview');
      source?.setData(draftCollection(drawModeRef.current, drawVerticesRef.current, draftPointer));
    };
    updateDraftRef.current = updateDraft;
    const canFinish = () => drawModeRef.current === 'area' ? drawVerticesRef.current.length >= 3 : drawVerticesRef.current.length >= 2;
    const isNearFirstVertex = (lngLat: maplibregl.LngLat) => {
      const first = drawVerticesRef.current[0];
      if (!first) return false;
      return map.project(first.coordinate).dist(map.project(lngLat)) <= 12;
    };
    const selectableFeatureAt = (point: maplibregl.Point) => {
      const layers = ['graph-fill', 'graph-line', 'graph-point-preview', 'graph-point', 'graph-relation-point', 'mvt-way-line', 'mvt-point'].filter(layer => map.getLayer(layer));
      return layers.length ? map.queryRenderedFeatures(point, { layers }).find(feature => {
        const entityId = feature.properties?.entityId ?? feature.properties?.entity_id;
        const entityType = feature.properties?.entityType ?? feature.properties?.entity_type;
        return Boolean(entityId) && (entityType === 'node' || entityType === 'way' || entityType === 'relation');
      }) : undefined;
    };
    const setSelectCursor = (point: maplibregl.Point) => {
      if (drawModeRef.current !== 'select') return;
      map.getCanvas().style.cursor = selectableFeatureAt(point) ? 'pointer' : '';
    };
    const onMapClick = (event: MapMouseEvent) => {
      if (performance.now() < suppressClickUntil) return;
      const mode = drawModeRef.current;
      if (mode === 'select') {
        const vertex = map.getLayer('editor-vertex-handles') ? map.queryRenderedFeatures(event.point, { layers: ['editor-vertex-handles'] })[0] : undefined;
        if (vertex?.properties?.nodeId) {
          callbacksRef.current.onSelectVertex(String(vertex.properties.nodeId));
          return;
        }
        const hit = selectableFeatureAt(event.point);
        const entityId = hit?.properties?.entityId ?? hit?.properties?.entity_id;
        const entityType = hit?.properties?.entityType ?? hit?.properties?.entity_type;
        if (!entityId || (entityType !== 'node' && entityType !== 'way' && entityType !== 'relation')) return;
        const feature = featuresRef.current.find(item => item.properties.entityType === entityType && item.properties.entityId === String(entityId));
        if (feature) callbacksRef.current.onSelect(feature);
        else callbacksRef.current.onSelectEntity(entityType, String(entityId));
        return;
      }
      if (mode !== 'point' && canFinish() && isNearFirstVertex(event.lngLat)) {
        callbacksRef.current.onFinishDrawing();
        return;
      }
      callbacksRef.current.onDrawVertex(snap(event.lngLat));
    };
    let draggingNodeId: string | null = null;
    let dragStart: maplibregl.Point | null = null;
    let suppressClickUntil = 0;
    const setDragPreview = (coordinate?: Coordinate) => {
      geoJsonSource(map, 'editor-node-drag')?.setData(coordinate
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coordinate } }] }
        : emptyCollection());
    };
    const onVertexDown = (event: MapLayerMouseEvent) => {
      if (drawModeRef.current !== 'select' || event.originalEvent.button !== 0) return;
      const nodeId = event.features?.[0]?.properties?.nodeId;
      if (typeof nodeId !== 'string') return;
      event.preventDefault();
      draggingNodeId = nodeId;
      dragStart = event.point;
      callbacksRef.current.onSelectVertex(nodeId);
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
      setDragPreview([event.lngLat.lng, event.lngLat.lat]);
    };
    const onMouseMove = (event: MapMouseEvent) => {
      pointer = event.lngLat;
      schedulePointerStatus();
      if (draggingNodeId) {
        setDragPreview([event.lngLat.lng, event.lngLat.lat]);
        return;
      }
      if (drawModeRef.current !== 'select') updateDraft(snap(event.lngLat));
      else setSelectCursor(event.point);
    };
    const onMouseUp = (event: MapMouseEvent) => {
      if (!draggingNodeId) return;
      const nodeId = draggingNodeId;
      draggingNodeId = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = drawModeRef.current === 'select' ? '' : 'crosshair';
      setDragPreview();
      if (dragStart && dragStart.dist(event.point) > 3) {
        suppressClickUntil = performance.now() + 150;
        callbacksRef.current.onMoveNode(nodeId, [event.lngLat.lng, event.lngLat.lat]);
      }
      dragStart = null;
    };
    const onMouseOut = () => {
      if (!draggingNodeId && drawModeRef.current === 'select') map.getCanvas().style.cursor = '';
    };
    const onDoubleClick = (event: MapMouseEvent) => {
      if (drawModeRef.current === 'select' || !canFinish()) return;
      event.preventDefault();
      callbacksRef.current.onFinishDrawing();
    };
    const onContextMenu = (event: MapMouseEvent) => {
      if (drawModeRef.current === 'select') return;
      event.preventDefault();
      callbacksRef.current.onCancelDrawing();
    };
    const loadPointIconLayers = () => {
      if (disposed || pointIconLoadStarted || map.getZoom() < 18 || !map.getSource('canonical-graph')) return;
      pointIconLoadStarted = true;
      void loadPointPinImages(map, () => disposed).then(() => {
        if (disposed || !map.getSource('canonical-graph')) return;
        map.addLayer({ id: 'mvt-point', type: 'symbol', source: 'canonicalMvt', 'source-layer': 'points', minzoom: 18, layout: { 'icon-image': ['concat', 'editor-point-pin-', ['coalesce', ['get', 'editor_icon'], 'generic']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 18, 0.72, 22, 0.72], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, 'graph-fill');
        map.addLayer({ id: 'graph-point', type: 'symbol', source: 'canonical-graph', minzoom: 18, filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'entityType'], 'node'], ['!=', ['get', 'topologyNode'], true]], layout: { 'icon-image': ['concat', 'editor-point-pin-', ['coalesce', ['get', 'pointIcon'], 'generic']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 18, 0.72, 22, 0.72], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, 'graph-relation-point');
        map.addLayer({ id: 'selection-halo-point', type: 'symbol', source: 'editor-selection', minzoom: 18, filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'entityType'], 'node']], layout: { 'icon-image': ['concat', 'editor-point-halo-', ['coalesce', ['get', 'pointIcon'], 'generic']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 18, 0.72, 22, 0.72], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': 0.72 } });
        map.addLayer({ id: 'selection-origin-point', type: 'symbol', source: 'editor-selection', minzoom: 18, filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'entityType'], 'node']], layout: { 'icon-image': ['concat', 'editor-point-pin-', ['coalesce', ['get', 'pointIcon'], 'generic']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 18, 0.72, 22, 0.72], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
        // Keep lightweight POIs visible while icons are loading, even above Z18.
        map.setLayerZoomRange('graph-point-preview', 16, 18);
        handoff.sync();
      }).catch(error => {
        pointIconLoadStarted = false;
        if (!disposed) console.error('Không thể tạo biểu tượng điểm:', error);
      });
    };
    map.once('style.load', () => {
      // Fetch graph data and render geometry immediately. Point icons are an
      // optional progressive enhancement, loaded separately below.
      updateBounds();
      schedulePointerStatus();
      map.addLayer({ id: 'mvt-way-line', type: 'line', source: 'canonicalMvt', 'source-layer': 'ways', paint: { 'line-color': ['get', 'editor_color'], 'line-width': ['get', 'editor_width'], 'line-opacity': 0.9 } });
      map.addLayer({ id: 'mvt-label', type: 'symbol', source: 'canonicalMvt', 'source-layer': 'ways', filter: ['has', 'name'], layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-padding': 4, 'symbol-placement': 'line' }, paint: { 'text-color': '#18242d', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
      // Seed with current data even if React effects ran before map load.
      map.addSource('canonical-graph', { type: 'geojson', data: emptyCollection() });
      map.addSource('editor-selection', { type: 'geojson', data: selectedFeatureCollection(selectedRef.current, featuresRef.current) });
      map.addLayer({ id: 'graph-fill', type: 'fill', source: 'canonical-graph', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['coalesce', ['get', 'editorColor'], '#62a85d'], 'fill-opacity': 0.32 } });
      map.addLayer({ id: 'graph-line', type: 'line', source: 'canonical-graph', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': ['coalesce', ['get', 'editorColor'], '#5f9fe0'], 'line-width': ['coalesce', ['get', 'editorWidth'], 3] } });
      // Keep saved/local POIs visible before their richer icons are enabled at Z18.
      map.addLayer({ id: 'graph-point-preview', type: 'circle', source: 'canonical-graph', minzoom: 16, filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'entityType'], 'node'], ['!=', ['get', 'topologyNode'], true]], paint: { 'circle-color': ['coalesce', ['get', 'editorColor'], '#5f9fe0'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 3.5, 18, 4.5], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'graph-relation-point', type: 'circle', source: 'canonical-graph', filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'entityType'], 'relation']], paint: { 'circle-color': '#7c3aed', 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'selection-fill', type: 'fill', source: 'editor-selection', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['coalesce', ['get', 'editorColor'], '#62a85d'], 'fill-opacity': 0.18 } });
      map.addLayer({ id: 'selection-halo-line', type: 'line', source: 'editor-selection', filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']], paint: { 'line-color': '#dc2626', 'line-width': 10, 'line-opacity': 0.36, 'line-blur': 2 } });
      map.addLayer({ id: 'selection-origin-line', type: 'line', source: 'editor-selection', filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']], paint: { 'line-color': ['coalesce', ['get', 'editorColor'], '#5f9fe0'], 'line-width': ['+', ['coalesce', ['get', 'editorWidth'], 3], 1], 'line-opacity': 1 } });
      map.addLayer({ id: 'selection-halo-relation', type: 'circle', source: 'editor-selection', filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'entityType'], 'relation']], paint: { 'circle-color': '#dc2626', 'circle-radius': 14, 'circle-opacity': 0.2, 'circle-stroke-color': '#dc2626', 'circle-stroke-width': 2.5, 'circle-stroke-opacity': 0.8, 'circle-blur': 0.25 } });
      map.addLayer({ id: 'selection-origin-relation', type: 'circle', source: 'editor-selection', filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'entityType'], 'relation']], paint: { 'circle-color': '#7c3aed', 'circle-radius': 8, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'graph-label', type: 'symbol', source: 'canonical-graph', filter: ['has', 'name'], layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-padding': 4, 'symbol-placement': 'line' }, paint: { 'text-color': '#18242d', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
      map.addSource('editor-vertex-handles', { type: 'geojson', data: selectedVertexCollection(selectedRef.current, featuresRef.current) });
      map.addLayer({ id: 'editor-vertex-handles', type: 'circle', source: 'editor-vertex-handles', paint: { 'circle-color': '#ffffff', 'circle-radius': 5.5, 'circle-stroke-color': '#a51f38', 'circle-stroke-width': 2.5 } });
      map.addSource('editor-node-drag', { type: 'geojson', data: emptyCollection() });
      map.addLayer({ id: 'editor-node-drag', type: 'circle', source: 'editor-node-drag', paint: { 'circle-color': '#a51f38', 'circle-radius': 6, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      map.addSource('coordinate-pinpoint', { type: 'geojson', data: pinpointCollection(pinpointRef.current) });
      map.addLayer({ id: 'coordinate-pinpoint-halo', type: 'circle', source: 'coordinate-pinpoint', paint: { 'circle-radius': 15, 'circle-color': '#c6203d', 'circle-opacity': 0.18, 'circle-stroke-color': '#c6203d', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.7 } });
      map.addLayer({ id: 'coordinate-pinpoint', type: 'circle', source: 'coordinate-pinpoint', paint: { 'circle-radius': 7, 'circle-color': '#c6203d', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
      map.addSource('editor-draw-preview', { type: 'geojson', data: emptyCollection() });
      map.addLayer({ id: 'draw-preview-fill', type: 'fill', source: 'editor-draw-preview', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#a51f38', 'fill-opacity': .18 } });
      map.addLayer({ id: 'draw-preview-line', type: 'line', source: 'editor-draw-preview', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#a51f38', 'line-width': 3, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'draw-preview-vertices', type: 'circle', source: 'editor-draw-preview', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['case', ['get', 'first'], 6, 4.5], 'circle-color': ['case', ['get', 'snapped'], '#ffd166', '#a51f38'], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
      updateDraft();
      updateGraph();
      loadPointIconLayers();
      const pulseSelection = () => {
        const phase = (Math.sin(Date.now() / 180) + 1) / 2;
        if (selectedRef.current) {
          map.setPaintProperty('selection-halo-line', 'line-width', 9 + phase * 6);
          map.setPaintProperty('selection-halo-line', 'line-opacity', 0.22 + phase * 0.38);
          if (map.getLayer('selection-halo-point')) map.setPaintProperty('selection-halo-point', 'icon-opacity', 0.28 + phase * 0.68);
        }
        selectionPulseTimer = window.setTimeout(pulseSelection, 60);
      };
      pulseSelection();
    });
    map.on('moveend', updateBounds);
    map.on('render', finishGraphHandoff);
    map.on('mousemove', onMouseMove);
    map.on('mouseout', onMouseOut);
    map.on('mousedown', 'editor-vertex-handles', onVertexDown);
    map.on('mouseup', onMouseUp);
    map.on('click', onMapClick);
    map.on('dblclick', onDoubleClick);
    map.on('contextmenu', onContextMenu);
    map.on('zoom', schedulePointerStatus);
    map.on('zoomend', loadPointIconLayers);
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    // Do not wait for the satellite raster or map load event to fetch graph data.
    updateBounds();
    return () => {
      disposed = true;
      resizeObserver.disconnect();
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      if (selectionPulseTimer !== undefined) window.clearTimeout(selectionPulseTimer);
      map.off('mousemove', onMouseMove);
      map.off('mouseout', onMouseOut);
      map.off('mousedown', 'editor-vertex-handles', onVertexDown);
      map.off('mouseup', onMouseUp);
      map.off('click', onMapClick);
      map.off('dblclick', onDoubleClick);
      map.off('contextmenu', onContextMenu);
      map.off('zoom', schedulePointerStatus);
      map.off('zoomend', loadPointIconLayers);
      map.off('render', finishGraphHandoff);
      updateGraphRef.current = () => undefined;
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    updateGraphRef.current();
  }, [features, changedKeys]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    geoJsonSource(map, 'editor-vertex-handles')?.setData(selectedVertexCollection(selected, features));
  }, [features, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer('editor-vertex-handles')) {
      map.setPaintProperty('editor-vertex-handles', 'circle-color', ['case', ['==', ['get', 'nodeId'], selectedVertexId ?? ''], '#ffd166', '#ffffff']);
    }
  }, [features, selectedVertexId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    geoJsonSource(map, 'editor-selection')?.setData(selectedFeatureCollection(selected, features));
  }, [features, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pinpoint) return;
    map.flyTo({ center: pinpoint, zoom: Math.max(map.getZoom(), 18), essential: true });
    geoJsonSource(map, 'coordinate-pinpoint')?.setData(pinpointCollection(pinpoint));
  }, [pinpoint]);

  return <div ref={container} style={{ height: '100%', width: '100%' }} />;
}
