import type { Map as EncMap, PointLike, MapGeoJSONFeature } from 'maplibre-gl';

/** Collapse portrayal layers/tile fragments, retaining separate source objects. */
export function uniqueEncFeatures(hits: MapGeoJSONFeature[]): MapGeoJSONFeature[] {
  const editable=hits.filter(feature=>feature.source==='enc-edits' || (feature.source==='enc' && ['enc','enc_lines','enc_symbols'].includes(feature.sourceLayer??'')));
  const candidates=editable.length?editable:hits.filter(feature=>feature.source==='regions');
  const rank=(feature:MapGeoJSONFeature)=>(feature.source==='enc-edits'?0:3)+(feature.layer.type==='symbol'?0:feature.layer.type==='line'?1:2);
  const seen=new Set<string>();
  return candidates.map((feature,index)=>({feature,index})).sort((a,b)=>rank(a.feature)-rank(b.feature)||a.index-b.index).flatMap(({feature})=>{
    const p=feature.properties;
    const identity=p.edit_key??p.feature_id??feature.id;
    const key=JSON.stringify([p.revision_id??'',p.cell_name??'',identity??[feature.source,p.object_class,feature.geometry,p]]);
    if(seen.has(key))return [];
    seen.add(key);return [feature];
  });
}

export function pickEncFeatures(map: EncMap, point: {x:number;y:number}, radius=6): MapGeoJSONFeature[] {
  if (!map.getLayer('enc-background')) return [];
  return uniqueEncFeatures(map.queryRenderedFeatures([[point.x-radius,point.y-radius],[point.x+radius,point.y+radius]] as [PointLike,PointLike]));
}

/** Hover and context actions use the same ordering as the selection list. */
export function pickEncFeature(map: EncMap, point: {x:number;y:number}, radius=6): MapGeoJSONFeature | undefined {
  if(!map.getLayer('enc-background'))return undefined;
  const hits=map.queryRenderedFeatures([[point.x-radius,point.y-radius],[point.x+radius,point.y+radius]] as [PointLike,PointLike]);
  let best:MapGeoJSONFeature|undefined,score=Infinity;
  for(const feature of hits){
    if(feature.source!=='enc-edits'&&!(feature.source==='enc'&&['enc','enc_lines','enc_symbols'].includes(feature.sourceLayer??'')))continue;
    const rank=(feature.source==='enc-edits'?0:3)+(feature.layer.type==='symbol'?0:feature.layer.type==='line'?1:2);
    if(rank<score){best=feature;score=rank;}
    if(!rank)break;
  }
  return best??hits.find(feature=>feature.source==='regions');
}
