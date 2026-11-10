import type { ExpressionSpecification as Expression, LayerSpecification } from 'maplibre-gl';

// Attribute codes and symbol choices follow Njord's per-class layerables.
// Source: https://github.com/manimaul/njord/tree/master/crates/njord-symbology/src/layers
// This registry describes the shipped simplified atlas, not complete S-52.
type SymbolValue = string | Expression;
const code = (field: string): Expression => ['to-number', ['get', `sym_${field}`], -1];
const has = (field: string, ...values: number[]): Expression => ['any', ...values.map(value =>
  ['in', `|${value}|`, ['coalesce', ['get', `list_${field}`], '']] as Expression)];
const choose = (condition: Expression, yes: SymbolValue, no: SymbolValue): Expression => ['case', condition, yes, no];
const by = (field: string, variants: Record<number, SymbolValue>, fallback: SymbolValue): Expression =>
  ['match', code(field), ...Object.entries(variants).flatMap(([key, value]) => [Number(key), value]), fallback] as Expression;
const conspicuous = (yes: string, no: string) => choose(['==', code('CONVIS'), 1], yes, no);
const hasDepth: Expression = ['all',['has','VALSOU'],['!=',['get','VALSOU'],null]];
const coloured = (red: string, green: string, black: string, other: string) =>
  by('COLOUR', { 3: red, 4: green, 2: black }, other);
const cone = coloured('BOYLAT14', 'BOYLAT13', 'BOYSPP15', 'BOYSPP15');
const can = coloured('BOYLAT24', 'BOYLAT23', 'BOYSPP25', 'BOYSPP25');
const sphere = by('COLOUR', { 3: 'BOYSAW12' }, 'BOYSPP11');
const tallBeacon = coloured('BCNLAT21', 'BCNLAT22', 'BCNSAW21', 'BCNSPP21');
const shortBeacon = coloured('BCNLAT15', 'BCNLAT16', 'BCNSAW13', 'BCNSPP13');
const buoy = by('BOYSHP', { 1: cone, 2: can, 3: sphere, 4: tallBeacon, 5: tallBeacon, 6: sphere, 7: 'BOYSUP02', 8: sphere }, 'BOYDEF03');
const beacon = by('BCNSHP', { 1: tallBeacon, 2: tallBeacon, 3: shortBeacon, 4: shortBeacon, 5: shortBeacon, 6: 'CAIRNS11', 7: tallBeacon }, 'BCNDEF13');
const landmark = choose(has('FUNCTN', 20, 21), conspicuous('BUIREL13', 'BUIREL01'),
  choose(has('FUNCTN', 26, 27), conspicuous('BUIREL15', 'BUIREL05'),
    choose(has('FUNCTN', 22, 23, 24, 25), conspicuous('BUIREL14', 'BUIREL04'),
      by('CATLMK', {
        1: conspicuous('CAIRNS11', 'CAIRNS01'), 3: conspicuous('CHIMNY11', 'CHIMNY01'),
        4: 'DSHAER11', 5: 'FLGSTF01', 6: conspicuous('FLASTK11', 'FLASTK01'),
        7: conspicuous('MSTCON14', 'MSTCON04'), 9: 'MONUMT12', 10: 'MONUMT12',
        12: 'MONUMT12', 13: 'MONUMT12', 14: conspicuous('BUIREL13', 'BUIREL01'),
        15: conspicuous('DOMES011', 'DOMES001'), 16: conspicuous('RASCAN11', 'RASCAN01'),
        17: conspicuous('TOWERS12', 'TOWERS02'), 18: 'WNDMIL12', 19: conspicuous('WIMCON11', 'WIMCON01'),
      }, conspicuous('POSGEN03', 'POSGEN01')))));

const floatingTopmarks = [
  'TOPMAR02','TOPMAR04','TOPMAR10','TOPMAR12','TOPMAR13','TOPMAR14','TOPMAR65','TOPMAR17',
  'TOPMAR16','TOPMAR08','TOPMAR07','TOPMAR14','TOPMAR05','TOPMAR06','TMARDEF2','TMARDEF2',
  'TMARDEF2','TOPMAR10','TOPMAR13','TOPMAR14','TOPMAR13','TOPMAR14','TOPMAR14','TOPMAR02',
  'TOPMAR04','TOPMAR10','TOPMAR17','TOPMAR18','TOPMAR02','TOPMAR17','TOPMAR14','TOPMAR10','TMARDEF2',
];
const rigidTopmarks = [
  'TOPMAR22','TOPMAR24','TOPMAR30','TOPMAR32','TOPMAR33','TOPMAR34','TOPMAR85','TOPMAR86',
  'TOPMAR36','TOPMAR28','TOPMAR27','TOPMAR14','TOPMAR25','TOPMAR26','TOPMAR88','TOPMAR87',
  'TMARDEF1','TOPMAR30','TOPMAR33','TOPMAR34','TOPMAR33','TOPMAR34','TOPMAR34','TOPMAR22',
  'TOPMAR24','TOPMAR30','TOPMAR86','TOPMAR89','TOPMAR22','TOPMAR86','TOPMAR14','TOPMAR30','TMARDEF1',
];
const topmark = (names: string[], fallback: string) => by('TOPSHP', Object.fromEntries(names.map((name, i) => [i + 1, name])), fallback);

export const aidClasses = ['BOYLAT','BOYCAR','BOYISD','BOYSAW','BOYSPP','BOYINB','BCNLAT','BCNCAR','BCNISD','BCNSAW','BCNSPP','LITFLT','LITVES'];
export const hazardClasses = ['WRECKS','UWTROC','OBSTRN'];

// Every class with a meaningful point emblem in the local atlas is registered.
// Patterns and directional line emblems have separate registries below.
export const pointSprites: Record<string, SymbolValue> = {
  BOYLAT: by('CATLAM', { 1: can, 2: cone, 3: can, 4: cone }, buoy),
  BOYCAR: by('CATCAM', { 1: 'BOYCAR01', 2: 'BOYCAR02', 3: 'BOYCAR03', 4: 'BOYCAR04' }, 'BOYDEF03'),
  BCNCAR: by('CATCAM', { 1: 'BCNCAR01', 2: 'BCNCAR02', 3: 'BCNCAR03', 4: 'BCNCAR04' }, 'BCNDEF13'),
  BOYISD: 'BOYISD12', BCNISD: 'BCNISD21', BOYSAW: sphere, BCNSAW: beacon,
  BOYSPP: choose(has('CATSPM',15), 'BOYSUP02', choose(has('CATSPM',52), 'BOYDEF03', buoy)),
  BCNSPP: choose(has('CATSPM',18), 'NOTBRD11', choose(has('CATSPM',44), 'BCNSPP13', choose(has('CATSPM',52), 'BCNDEF13', beacon))),
  BCNLAT: beacon, BOYINB: 'BOYDEF03', LITFLT: 'LITFLT02', LITVES: 'LITVES02',
  LIGHTS: by('COLOUR', { 3:'LIGHTS11',4:'LIGHTS12',1:'LIGHTS13',6:'LIGHTS13',9:'LIGHTS13',11:'LIGHTS13' }, 'LITDEF11'),
  TOPMAR: choose(['==', ['get','topmark_floating'], true], topmark(floatingTopmarks,'TMARDEF2'), topmark(rigidTopmarks,'TMARDEF1')),
  DAYMAR: by('TOPSHP', { 24:'DAYTRI01',25:'DAYTRI05' }, 'DAYSQR01'),
  WRECKS: by('CATWRK', { 2:'WRECKS05',4:'WRECKS01',5:'WRECKS01' },
    choose(hasDepth, choose(['<=',['to-number',['get','VALSOU'],999999],6], 'DANGER01','WRECKS04'),
      choose(['==',code('WATLEV'),3], 'WRECKS04','ISODGR01'))),
  UWTROC: by('WATLEV', { 3:'UWTROC04',1:'UWTROC03',4:'UWTROC03',5:'UWTROC03',6:'UWTROC03' }, 'ISODGR01'),
  OBSTRN: choose(['all',['==',code('WATLEV'),3],has('QUASOU',3,4)],'LOWACC01',by('CATOBS', { 5:'FSHHAV01',9:'ACHARE02',8:'FLTHAZ02',10:'FLTHAZ02' },
    by('WATLEV', { 2:'OBSTRN11',4:'OBSTRN03',7:'FLTHAZ02',3:
      choose(['all',hasDepth,has('QUASOU',1,5,6,7,10)], choose(['<=',['to-number',['get','VALSOU'],999999],6], 'DANGER01','DANGER02'),
        choose(hasDepth,choose(['>',['to-number',['get','VALSOU'],0],9],'OBSTRN02','OBSTRN01'),'OBSTRN01')) }, 'ISODGR01'))),
  LNDMRK: landmark,
  BUISGL: choose(has('FUNCTN',20,21,22,23,24,25,26,27), landmark, conspicuous('BUISGL11','BUISGL01')),
  SILTNK: by('CATSIL', { 1:conspicuous('SILBUI11','SILBUI01'),2:conspicuous('TNKCON12','TNKCON02'),3:conspicuous('TOWERS03','TOWERS01'),4:conspicuous('TOWERS02','TOWERS12') }, 'SILBUI01'),
  MORFAC: by('CATMOR', { 1:'MORFAC03',2:'MORFAC04',3:'PILPNT02',5:'PILPNT02',7:'BOYMOR11' }, 'MORFAC03'),
  ACHARE:'ACHARE02', ACHBRT:'ACHBRT07', ACHPNT:'ACHARE02', AIRARE:'AIRARE02', BERTHS:'BRTHNO01',
  BRIDGE:'BRIDGE01', BUAARE:'BUAARE02', CGUSTA:'CGUSTA02', CHKPNT:'POSGEN04', CTRPNT:'POSGEN04', CRANES:'CRANES01',
  CTNARE:'CHINFO06', DISMAR:'DISMAR06', FOGSIG:'FOGSIG01', FORSTC:conspicuous('FORSTC11','FORSTC01'),
  FSHFAC:by('CATFIF',{1:'FSHFAC03'},'FSHFAC02'), FSHGRD:'FSHGRD01', GATCON:by('CATGAT',{4:'GATCON03',2:'GATCON04',3:'GATCON04'},'POSGEN01'),
  HRBFAC:'HRBFAC09', HULKES:'HULKES01', LOCMAG:'LOCMAG01', MAGVAR:'MAGVAR01', MARCUL:'MARCUL02',
  NEWOBJ:'NEWOBJ01', OFSPLF:'OFSPLF01', PILBOP:'PILBOP02', PILPNT:'PILPNT02', PRCARE:'PRCARE12',
  PRDARE:by('CATPRA',{1:'QUARRY01',2:'PRDINS02',3:'PRDINS02',4:'PRDINS02',5:'RFNERY11',6:'TMBYRD01',7:'PRDINS02',8:'TNKFRM11',9:'WNDFRM61'},'POSGEN01'),
  PYLONS:'POSGEN03', RADRFL:'RADRFL03',
  RADSTA:'RDOSTA02', RDOSTA:'RDOSTA02', RDOCAL:choose(['all',['has','ORIENT'],['has','TRAFIC']],'RDOCAL02','RCLDEF01'),
  RETRFL:'RETRFL02', RTPBCN:'RTPBCN02', SISTAT:'SISTAT03', SISTAW:'SISTAW03', SMCFAC:'SMCFAC02',
  SPRING:'SPRING02', TIDEHT:'TIDEHT01', TIDSTR:'TIDSTR01', WATTUR:'WATTUR02', WEDKLP:'WEDKLP03',
  CURENT:choose(['has','ORIENT'],'CURENT01','CURDEF01'),
  VEGATN:'POSGEN01', LNDARE:'LNDARE01',
  LNDELV:'POSGEN04', LNDRGN:'POSGEN04', SNDWAV:'SNDWAV02', CBLARE:'CBLARE51', OSPARE:'CTYARE51',
  CTSARE:'CHINFO07', DMPGRD:'CHINFO07', ICNARE:'CHINFO07', PIPARE:'CHINFO07', SPLARE:'CHINFO07',
  RCTLPT:choose(['has','ORIENT'],'RCTLPT52','RTLDEF51'),
  TSSLPT:'TSSLPT51', TWRTPT:by('TRAFIC',{1:'TWRTPT53',2:'TWRTPT53',3:'TWRTPT53',4:'TWRTPT52'},'TWRDEF51'),
  DWRTPT:'DWRUTE51',
  RESARE:choose(has('RESTRN',1,2),'ACHRES51',choose(has('RESTRN',7,8),'ENTRES51','CHINFO06')),
};

export const patternSprites: Record<string, SymbolValue> = {
  DRGARE:'DRGARE01P', ICEARE:'ICEARE04P', MARCUL:'MARCUL02P', SNDWAV:'SNDWAV01P',
  FSHFAC:by('CATFIF',{1:'FSHFAC03P',2:'FSHFAC04P',3:'FSHFAC04P',4:'FSHFAC04P'},'FSHHAV02P'),
  OBSTRN:choose(has('CATOBS',6,7),'FOULAR01P',''),
  LNDRGN:choose(has('CATLND',2,12),'MARSHES1P',''),
  UNSARE:'NODATA03P', PRTSUR:'PRTSUR01P',
};
export const lineSprites: Record<string, SymbolValue> = {
  RECTRC:by('TRAFIC',{
    1:by('CATTRK',{1:'RECTRC58'},'RECTRC57'),2:by('CATTRK',{1:'RECTRC58'},'RECTRC57'),
    3:by('CATTRK',{1:'RECTRC58'},'RECTRC57'),4:by('CATTRK',{1:'RECTRC56'},'RECTRC55'),
  },'RECDEF51'), GATCON:by('CATGAT',{4:'GATCON03',2:'GATCON04',3:'GATCON04'},''),
  FERYRT:'FRYARE51', PIPOHD:choose(has('CONRAD',1,3),'RACNSP01',''),
  CONVYR:choose(has('CONRAD',1,3),'RACNSP01',''),
};

export const spriteExpression = (registry: Record<string, SymbolValue>, fallback = ''): Expression =>
  ['match',['get','object_class'],...Object.entries(registry).flatMap(([key,value])=>[key,value]),fallback] as unknown as Expression;

export const spriteRotation: Expression = ['match',['get','object_class'],
  ['CURENT','TSSLPT','TWRTPT','DWRTPT','RECTRC','RCTLPT','WRECKS'], ['to-number',['get','ORIENT'],0],
  'LIGHTS',135,0];

export function encSpriteLayers(ink: string, halo: string): LayerSpecification[] {
  const reserved = [...aidClasses,...hazardClasses,'LIGHTS','TOPMAR','DAYMAR'];
  const groups = [
    {id:'enc-objects', classes:Object.keys(pointSprites).filter(key=>!reserved.includes(key)), minzoom:11},
    {id:'enc-hazard-symbols', classes:hazardClasses, minzoom:9},
    {id:'enc-aids', classes:aidClasses, minzoom:9},
    {id:'enc-lights', classes:['LIGHTS'], minzoom:9},
    {id:'enc-topmarks', classes:['TOPMAR','DAYMAR'], minzoom:10},
  ];
  const layers = groups.flatMap(group => ['enc','enc_symbols'].map(sourceLayer => ({
    id:group.id+(sourceLayer==='enc_symbols'?'-areas':''), type:'symbol',source:'enc','source-layer':sourceLayer,
    minzoom:group.minzoom,
    filter:['all',['==',['geometry-type'],'Point'],['in',['get','object_class'],['literal',
      sourceLayer==='enc_symbols'?group.classes.filter(key=>key!=='LNDARE'):group.classes]]],
    layout:{
      'icon-image':['coalesce',['image',spriteExpression(pointSprites)],['image','QUESMRK1']],
      'icon-size':['interpolate',['linear'],['zoom'],9,0.85,13,1],
      'icon-anchor':['match',['get','object_class'],[...aidClasses,'LIGHTS','TOPMAR','DAYMAR'],'bottom','center'],
      'icon-offset':['case',['==',['get','object_class'],'DAYMAR'],['literal',[0,-18]],
        ['all',['==',['get','object_class'],'TOPMAR'],['==',['get','topmark_floating'],true]],['literal',[0,-8]],['literal',[0,0]]],
      'icon-rotate':spriteRotation,'icon-rotation-alignment':'map','icon-padding':3,
      'icon-allow-overlap':group.id==='enc-topmarks'||group.id==='enc-lights',
      'icon-ignore-placement':group.id==='enc-topmarks'||group.id==='enc-lights',
      'symbol-sort-key':['match',['get','object_class'],'BOYISD',0,'BCNISD',0,'BOYCAR',1,'BCNCAR',1,2],
    },
  } as LayerSpecification)));
  // Unknown point classes remain visible and selectable with an explicit
  // question mark, rather than borrowing a potentially misleading chart icon.
  layers.unshift({id:'enc-unmapped-points',type:'symbol',source:'enc','source-layer':'enc',minzoom:13,
    filter:['all',['==',['geometry-type'],'Point'],['!', ['in',['get','object_class'],
      ['literal',[...Object.keys(pointSprites),'SOUNDG','SBDARE','LNDELV','LNDRGN','SEAARE']]]]],
    layout:{'icon-image':'QUESMRK1','icon-size':0.75,'icon-allow-overlap':false,'icon-padding':6}});
  const seabed: Expression = ['concat', ...Object.entries({1:'M',2:'Cy',3:'Si',4:'S',5:'St',6:'G',7:'P',8:'Cb',9:'R',11:'R',14:'Co',17:'Sh',18:'R'})
    .map(([key,label]) => choose(has('NATSUR',Number(key)),label+' ',''))];
  layers.unshift(...['enc','enc_symbols'].map(sourceLayer => ({
    id:'enc-natural-labels-'+sourceLayer,type:'symbol',source:'enc','source-layer':sourceLayer,minzoom:12,
    filter:['all',['==',['geometry-type'],'Point'],['in',['get','object_class'],['literal',['SBDARE','LNDELV']]]],
    layout:{'text-field':['match',['get','object_class'],'SBDARE',seabed,
      ['case',['has','ELEVAT'],['concat',['to-string',['get','ELEVAT']],' m'],'']],
      'text-font':['Roboto Bold'],'text-size':11,'text-padding':8,'text-offset':[0.8,0], 'text-anchor':'left'},
    paint:{'text-color':ink,'text-halo-color':halo,'text-halo-width':1.5},
  } as LayerSpecification)));
  return layers;
}

export function encPatternLayers(): LayerSpecification[] {
  return [{id:'enc-area-patterns',type:'fill',source:'enc','source-layer':'enc',minzoom:11,
    filter:['all',['==',['geometry-type'],'Polygon'],['!=',spriteExpression(patternSprites),'']],
    paint:{'fill-pattern':spriteExpression(patternSprites),'fill-opacity':0.65}},
  {id:'enc-line-symbols',type:'symbol',source:'enc','source-layer':'enc',minzoom:10,
    filter:['all',['!=',['geometry-type'],'Point'],['!=',spriteExpression(lineSprites),'']],
    layout:{'symbol-placement':'line','symbol-spacing':220,'icon-image':spriteExpression(lineSprites),
      'icon-size':0.85,'icon-padding':8,'icon-allow-overlap':false,'icon-rotation-alignment':'map'}}];
}
