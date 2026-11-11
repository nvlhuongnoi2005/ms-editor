import type { ExpressionSpecification as Expression, LayerSpecification } from 'maplibre-gl';
import { spriteSpecs } from './spriteSpecs.generated';

type Palette = { ink:string; coast:string; land:string; deep:string; veryShallow:string; tidal:string; magenta:string; grey:string; brown:string };
const cls = (...classes:string[]): Expression => ['in',['get','object_class'],['literal',classes]];
const has = (field:string,...values:number[]): Expression => ['any',...values.map(value =>
  ['in',`|${value}|`,['coalesce',['get',`list_${field}`],'']] as Expression)];
const number = (field:string): Expression => ['to-number',['coalesce',['get',field],-1],-1];
const valid = (field:string): Expression => ['all',['has',field],['!=',['get',field],null],['!=',['get',field],''],['>=',number(field),0]];
const geometry: Expression = ['in',['geometry-type'],['literal',['LineString','Polygon']]];
const constructing = has('CONDTN',1,2);
const wharf = has('CATSLC',6,15,16);
const shoreDashed: Expression = ['case',constructing,true,wharf,false,has('WATLEV',3,4),true,false];
const lowAccuracy: Expression = ['all',['>=',number('s52_quapos'),2],['<=',number('s52_quapos'),9]];

// The pipe's purpose is list-valued. Water/sewer/outfall/intake or fresh water
// product use PIPSOL06; oil/gas/unknown use PIPSOL05. Do not inspect only code 0.
export const waterPipeline: Expression = ['any',has('CATPIP',2,3,4,5),has('PRODCT',3)];

// Geometry carries the portrayal: no point icon is invented for a river,
// pontoon, overhead cable or submerged pipeline. Standard line weights are
// converted from S-52 millimetres to CSS pixels at the browser's 96 dpi.
export function encInfrastructureLayers(p:Palette): LayerSpecification[] {
  const lineWeight = (symbol: string, fallbackMm: number) =>
    (spriteSpecs[`LC_${symbol}`]?.lineWeightMm ?? fallbackMm) * 96 / 25.4;
  const hairline = lineWeight('LOWACC21',0.3);
  const strongLine = lineWeight('PIPSOL06',0.6);
  const source = {source:'enc','source-layer':'enc'};
  const filter = (...conditions:Expression[]): Expression => ['all',geometry,...conditions];
  const line = (id:string,condition:Expression,paint:Record<string,unknown>): LayerSpecification =>
    ({...source,id,type:'line',filter:filter(condition),paint}) as LayerSpecification;
  const fills:LayerSpecification[] = [
    {...source,id:'enc-inland-water',type:'fill',filter:['all',['==',['geometry-type'],'Polygon'],cls('RIVERS','CANALS','LAKARE')],paint:{'fill-color':p.veryShallow}},
    {...source,id:'enc-marine-structures-fill',type:'fill',filter:['all',['==',['geometry-type'],'Polygon'],cls('PONTON','FLODOC','DAMCON','DYKCON','DRYDOC','CONVYR')],
      paint:{'fill-color':['case',cls('DRYDOC'),p.land,p.brown]}},
    // Submerged shoreline works are not islands. Preserve the depth fill below
    // WATLEV=3; intertidal works get a tidal fill. Missing WATLEV stays unfilled.
    {...source,id:'enc-shore-works-fill',type:'fill',filter:['all',['==',['geometry-type'],'Polygon'],cls('SLCONS')],
      paint:{'fill-color':['case',has('WATLEV',4),p.tidal,p.land],
        'fill-opacity':['case',has('WATLEV',1,2,4,7),1,0]}},
  ];
  const lines:LayerSpecification[] = [
    line('enc-inland-water-boundary',cls('RIVERS','CANALS','LAKARE'),{'line-color':p.ink,'line-width':hairline}),
    line('enc-pontoons',cls('PONTON','FLODOC'),{'line-color':p.coast,'line-width':strongLine}),
    line('enc-dry-docks',cls('DRYDOC'),{'line-color':p.coast,'line-width':hairline}),
    line('enc-dykes-dams',cls('DYKCON','DAMCON'),{'line-color':['case',has('CONRAD',1),p.ink,p.brown],
      'line-width':['case',cls('DAMCON'),strongLine,hairline]}),
    line('enc-fences',cls('FNCLNE'),{'line-color':['case',has('CONVIS',1),p.ink,p.brown],'line-width':hairline}),
    // SLCONS conditional precedence: quality, construction, wharf, water level.
    // Keep solid/dashed filters disjoint so wet works never get a solid overdraw.
    line('enc-shore-works-solid',['all',cls('SLCONS'),['!',lowAccuracy],['!',shoreDashed]],
      {'line-color':p.coast,'line-width':['case',wharf,strongLine,hairline]}),
    line('enc-shore-works-dashed',['all',cls('SLCONS'),['!',lowAccuracy],shoreDashed],
      {'line-color':p.coast,'line-width':hairline,'line-dasharray':[4,2]}),
    line('enc-shore-works-uncertain',['all',cls('SLCONS'),lowAccuracy],
      {'line-pattern':'LC_LOWACC21','line-width':12}),
    line('enc-overhead-cables',cls('CBLOHD'),{'line-color':p.grey,'line-width':hairline,'line-dasharray':[4,2]}),
    line('enc-overhead-pipes',cls('PIPOHD'),{'line-color':p.grey,'line-width':hairline}),
    line('enc-conveyors-solid',['all',cls('CONVYR'),['any',['==',['geometry-type'],'Polygon'],has('CATCON',2)]],
      {'line-color':p.grey,'line-width':hairline}),
    line('enc-conveyors-dashed',['all',cls('CONVYR'),['==',['geometry-type'],'LineString'],['!',has('CATCON',2)]],
      {'line-color':p.grey,'line-width':hairline,'line-dasharray':[4,2]}),
    line('enc-submarine-cables',['all',cls('CBLSUB'),['!',has('CATCBL',6)]],
      {'line-pattern':'LC_CBLSUB06','line-width':lineWeight('CBLSUB06',0.3)}),
    line('enc-ferry-cables',['all',cls('CBLSUB'),has('CATCBL',6)],
      {'line-color':p.magenta,'line-width':hairline,'line-dasharray':[4,2]}),
    line('enc-water-pipelines',['all',cls('PIPSOL'),waterPipeline],
      {'line-pattern':'LC_PIPSOL06','line-width':lineWeight('PIPSOL06',0.6)}),
    line('enc-other-pipelines',['all',cls('PIPSOL'),['!',waterPipeline]],
      {'line-pattern':'LC_PIPSOL05','line-width':lineWeight('PIPSOL05',0.3)}),
  ];
  const labels:LayerSpecification[] = [
    {...source,id:'enc-inland-water-names',type:'symbol',minzoom:11,
      filter:['all',['==',['get','s52_geometry'],1],cls('RIVERS','CANALS','LAKARE'),['has','OBJNAM'],['!=',['get','OBJNAM'],'']],
      layout:{'symbol-placement':'line','symbol-spacing':400,'text-field':['get','OBJNAM'],'text-font':['Roboto Bold'],'text-size':12,'text-padding':10,'text-max-width':14},
      paint:{'text-color':p.ink,'text-halo-color':p.veryShallow,'text-halo-width':1.5}},
    // Use the original area's anchor, not a new label at each clipped tile centre.
    {...source,'source-layer':'enc_symbols',id:'enc-inland-water-area-names',type:'symbol',minzoom:11,
      filter:['all',['==',['get','s52_geometry'],2],cls('RIVERS','CANALS','LAKARE'),['has','OBJNAM'],['!=',['get','OBJNAM'],'']],
      layout:{'text-field':['get','OBJNAM'],'text-font':['Roboto Bold'],'text-size':12,'text-padding':10,'text-max-width':14},
      paint:{'text-color':p.ink,'text-halo-color':p.veryShallow,'text-halo-width':1.5}},
    {...source,id:'enc-overhead-clearances',type:'symbol',minzoom:12,
      filter:filter(cls('CBLOHD','PIPOHD','CONVYR'),['any',valid('VERCSA'),valid('VERCLR')]),
      layout:{'symbol-placement':'line','symbol-spacing':300,
        'text-field':['concat',['case',valid('VERCSA'),'sf clr ','clr '],
          ['to-string',['case',valid('VERCSA'),number('VERCSA'),number('VERCLR')]],' m'],
        'text-font':['Roboto Bold'],'text-size':11,'text-padding':8,'text-offset':[0,-1]},
      paint:{'text-color':p.ink,'text-halo-color':p.deep,'text-halo-width':1.5}},
  ];
  return [...fills,...lines,...labels];
}
