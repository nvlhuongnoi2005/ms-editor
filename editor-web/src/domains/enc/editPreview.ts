import type { FilterSpecification, Map as EncMap, GeoJSONSource } from 'maplibre-gl';
import type { EncEditFeature } from './editing';

type Documents = Record<string,EncEditFeature>;
/** Updates local preview without waiting for tiles or reparsing unchanged base filters. */
export function createEditPreview(map:EncMap, read:()=>Documents, buildLayers:()=>void, properties:(f:EncEditFeature)=>Record<string,unknown>, onError:(error:unknown)=>void) {
  const filters = new Map<string,FilterSpecification | undefined>();
  let frame:number | undefined;
  let hiddenSignature = '[]';
  let previous:Documents = {};
  let source:GeoJSONSource | undefined;
  let stopped = false;
  const render = () => {
    frame = undefined;
    if (stopped || !map.getLayer('enc-background')) return;
    try {
      // A style can be ready for edits while isStyleLoaded() is false because a tile is loading.
      if (!map.getSource('enc-edits')) buildLayers();
      const currentSource=map.getSource('enc-edits') as GeoJSONSource;
      if (source!==currentSource) { source=currentSource; previous={}; filters.clear(); hiddenSignature='[]'; }
      const documents = read();
      const hidden = Object.keys(documents).filter(key=>!documents[key].sourceId.startsWith('new:')).sort();
      const signature=JSON.stringify(hidden);
      if (signature!==hiddenSignature) {
        for (const layer of map.getStyle().layers) {
          if (!('source' in layer) || layer.source!=='enc') continue;
          if (!filters.has(layer.id)) filters.set(layer.id,layer.filter);
          const original=filters.get(layer.id);
          const next=hidden.length ? ['all',...(original?[original]:[]),['!', ['in',['get','edit_key'],['literal',hidden]]]] : original;
          map.setFilter(layer.id,(next as FilterSpecification | undefined) ?? null);
        }
        hiddenSignature=signature;
      }
      const toFeature=(f:EncEditFeature)=>({type:'Feature' as const,id:f.key,geometry:f.geometry as GeoJSON.Geometry,properties:{...properties(f),edit_key:f.key}});
      const remove=Object.keys(previous).filter(key=>!previous[key].deleted && (!documents[key] || documents[key].deleted));
      const add=Object.keys(documents).filter(key=>!documents[key].deleted && documents[key]!==previous[key]).map(key=>toFeature(documents[key]));
      if (remove.length || add.length) {
        // updateData replaces features with the same stable ID; no full collection transfer to the worker.
        const owner=source;
        void source.updateData({remove,add}).catch(error=>{if(!stopped && source===owner)onError(error);});
      }
      previous=documents;
    } catch(error) { onError(error); }
  };
  const schedule=()=>{if(!stopped && frame===undefined) frame=requestAnimationFrame(render);};
  const reset=()=>{source=undefined;previous={};filters.clear();hiddenSignature='[]';schedule();};
  map.on('style.load',reset); map.on('styledata',schedule);
  schedule();
  return {
    schedule,
    stop() {
      stopped=true;
      if(frame!==undefined)cancelAnimationFrame(frame);
      map.off('style.load',reset);map.off('styledata',schedule);
      for(const [id,filter] of filters)if(map.getLayer(id))map.setFilter(id,filter??null);
      for(const id of ['enc-edits-points','enc-edits-lines','enc-edits-areas'])if(map.getLayer(id))map.removeLayer(id);
      if(map.getSource('enc-edits'))map.removeSource('enc-edits');
    },
  };
}
