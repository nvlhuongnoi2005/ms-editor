import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { Map, MapLayerMouseEvent, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildTopologyGraph, snapCoordinate, type DrawMode, type SnappedVertex } from '../editor/drawing';
import type { Coordinate, GraphFeature, SelectedEntity } from '../../types/osm';

export interface MapViewport {
  bbox: [number, number, number, number];
  zoom: number;
}

interface MapCanvasProps {
  features: GraphFeature[];
  drawMode: DrawMode;
  drawVertices: SnappedVertex[];
  selected: SelectedEntity | null;
  onBoundsChange: (viewport: MapViewport) => void;
  onSelect: (feature: GraphFeature) => void;
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
  sources: { satellite2: { type: 'raster', url: "http://localhost:8081/datas/satellite2.json"} },
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
  return featureCollection([{
    type: 'Feature',
    properties: feature.properties,
    geometry: feature.geometry
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

export function MapCanvas({ features, drawMode, drawVertices, selected, onBoundsChange, onSelect, onDrawVertex, onFinishDrawing, onCancelDrawing, onMoveNode, onPointerStatus }: MapCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const featuresRef = useRef(features);
  const drawModeRef = useRef(drawMode);
  const drawVerticesRef = useRef(drawVertices);
  const callbacksRef = useRef({ onSelect, onDrawVertex, onFinishDrawing, onCancelDrawing, onMoveNode, onPointerStatus, onBoundsChange });
  const topologyRef = useRef(buildTopologyGraph(features));
  const updateDraftRef = useRef<(pointer?: SnappedVertex) => void>(() => undefined);
  featuresRef.current = features;
  drawModeRef.current = drawMode;
  drawVerticesRef.current = drawVertices;
  callbacksRef.current = { onSelect, onDrawVertex, onFinishDrawing, onCancelDrawing, onMoveNode, onPointerStatus, onBoundsChange };

  useEffect(() => { topologyRef.current = buildTopologyGraph(features); }, [features]);
  useEffect(() => { updateDraftRef.current(); }, [drawMode, drawVertices]);
  useEffect(() => {
    mapRef.current?.getCanvas().style.setProperty('cursor', drawMode === 'select' ? '' : 'crosshair');
  }, [drawMode]);

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({ container: container.current, style: tileStyle, center: [104.50728, 21.59988], zoom: 16 });
    mapRef.current = map;
    let pointer = map.getCenter();
    let animationFrame: number | undefined;
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
    const onMapClick = (event: MapMouseEvent) => {
      const mode = drawModeRef.current;
      if (mode === 'select') {
        const hit = map.queryRenderedFeatures(event.point, { layers: ['graph-fill', 'graph-line', 'graph-point'] })[0];
        const entityId = hit?.properties?.entityId;
        if (!entityId) return;
        const feature = featuresRef.current.find(item => item.properties.entityId === String(entityId));
        if (feature) callbacksRef.current.onSelect(feature);
        return;
      }
      if (mode !== 'point' && canFinish() && isNearFirstVertex(event.lngLat)) {
        callbacksRef.current.onFinishDrawing();
        return;
      }
      callbacksRef.current.onDrawVertex(snap(event.lngLat));
    };
    let draggingNodeId: string | null = null;
    const setDragPreview = (coordinate?: Coordinate) => {
      geoJsonSource(map, 'editor-node-drag')?.setData(coordinate
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coordinate } }] }
        : emptyCollection());
    };
    const onVertexDown = (event: MapLayerMouseEvent) => {
      const nodeId = event.features?.[0]?.properties?.nodeId;
      if (typeof nodeId !== 'string') return;
      event.preventDefault();
      draggingNodeId = nodeId;
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
    };
    const onMouseUp = (event: MapMouseEvent) => {
      if (!draggingNodeId) return;
      const nodeId = draggingNodeId;
      draggingNodeId = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = drawModeRef.current === 'select' ? '' : 'crosshair';
      setDragPreview();
      callbacksRef.current.onMoveNode(nodeId, [event.lngLat.lng, event.lngLat.lat]);
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
    map.on('load', () => {
      map.addSource('canonical-graph', { type: 'geojson', data: emptyCollection() });
      map.addSource('editor-selection', { type: 'geojson', data: emptyCollection() });
      map.addLayer({ id: 'graph-fill', type: 'fill', source: 'canonical-graph', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['coalesce', ['get', 'editorColor'], '#62a85d'], 'fill-opacity': 0.32 } });
      map.addLayer({ id: 'graph-line', type: 'line', source: 'canonical-graph', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': ['coalesce', ['get', 'editorColor'], '#5f9fe0'], 'line-width': ['coalesce', ['get', 'editorWidth'], 3] } });
      map.addLayer({ id: 'graph-point', type: 'circle', source: 'canonical-graph', filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'topologyNode'], true]], paint: { 'circle-color': '#df7950', 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'selection-fill', type: 'fill', source: 'editor-selection', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#c6203d', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'selection-line', type: 'line', source: 'editor-selection', filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']], paint: { 'line-color': '#c6203d', 'line-width': 5, 'line-opacity': 0.95 } });
      map.addLayer({ id: 'selection-point', type: 'circle', source: 'editor-selection', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#c6203d', 'circle-radius': 8, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
      map.addLayer({ id: 'graph-label', type: 'symbol', source: 'canonical-graph', filter: ['has', 'name'], layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-padding': 4, 'symbol-placement': 'line' }, paint: { 'text-color': '#18242d', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
      map.addSource('editor-vertex-handles', { type: 'geojson', data: emptyCollection() });
      map.addLayer({ id: 'editor-vertex-handles', type: 'circle', source: 'editor-vertex-handles', paint: { 'circle-color': '#ffffff', 'circle-radius': 5.5, 'circle-stroke-color': '#a51f38', 'circle-stroke-width': 2.5 } });
      map.addSource('editor-node-drag', { type: 'geojson', data: emptyCollection() });
      map.addLayer({ id: 'editor-node-drag', type: 'circle', source: 'editor-node-drag', paint: { 'circle-color': '#a51f38', 'circle-radius': 6, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      map.addSource('editor-draw-preview', { type: 'geojson', data: emptyCollection() });
      map.addLayer({ id: 'draw-preview-fill', type: 'fill', source: 'editor-draw-preview', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#a51f38', 'fill-opacity': .18 } });
      map.addLayer({ id: 'draw-preview-line', type: 'line', source: 'editor-draw-preview', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#a51f38', 'line-width': 3, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'draw-preview-vertices', type: 'circle', source: 'editor-draw-preview', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['case', ['get', 'first'], 6, 4.5], 'circle-color': ['case', ['get', 'snapped'], '#ffd166', '#a51f38'], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
      updateBounds();
      updateDraft();
      schedulePointerStatus();
    });
    map.on('moveend', updateBounds);
    map.on('mousemove', onMouseMove);
    map.on('mousedown', 'editor-vertex-handles', onVertexDown);
    map.on('mouseup', onMouseUp);
    map.on('click', onMapClick);
    map.on('dblclick', onDoubleClick);
    map.on('contextmenu', onContextMenu);
    map.on('zoom', schedulePointerStatus);
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    return () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      map.off('mousemove', onMouseMove);
      map.off('mousedown', 'editor-vertex-handles', onVertexDown);
      map.off('mouseup', onMouseUp);
      map.off('click', onMapClick);
      map.off('dblclick', onDoubleClick);
      map.off('contextmenu', onContextMenu);
      map.off('zoom', schedulePointerStatus);
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = geoJsonSource(map, 'canonical-graph');
    if (source) source.setData({ type: 'FeatureCollection', features });
  }, [features]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    geoJsonSource(map, 'editor-vertex-handles')?.setData(selectedVertexCollection(selected, features));
  }, [features, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    geoJsonSource(map, 'editor-selection')?.setData(selectedFeatureCollection(selected, features));
  }, [features, selected]);

  return <div ref={container} style={{ height: '100%', width: '100%' }} />;
}
