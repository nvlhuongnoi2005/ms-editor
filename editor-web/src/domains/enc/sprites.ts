import type { ExpressionSpecification as Expression, LayerSpecification } from 'maplibre-gl';
import { isSectorLight, sectorImage } from './lightSectors';

// Attribute codes and symbol choices follow Njord's per-class layerables.
// Source: https://github.com/manimaul/njord/tree/master/crates/njord-symbology/src/layers
// S-52 PresLib 4.0(.3), Addendum to Part I (December 2020).
// "simplified" is the IHO point-symbol set's name, not permission to discard attributes.
// Catalogue page numbers and remaining asset gaps are recorded in ENC/SPRITES.md.
type SymbolValue = string | Expression;
const code = (field: string): Expression => ['to-number', ['coalesce', ['get', `sym_${field}`], -1], -1];
const numeric = (field: string, fallback = -999999): Expression => ['to-number', ['coalesce', ['get', field], fallback], fallback];
const validNumber = (field: string): Expression => ['all', ['has', field], ['!=', ['get', field], null], ['!=', ['get', field], ''], ['!=', numeric(field), -999999]];
const has = (field: string, ...values: number[]): Expression => ['any', ...values.map(value =>
  ['in', `|${value}|`, ['coalesce', ['get', `list_${field}`], '']] as Expression)];
const choose = (condition: Expression, yes: SymbolValue, no: SymbolValue): Expression => ['case', condition, yes, no];
const by = (field: string, variants: Record<number, SymbolValue>, fallback: SymbolValue): Expression =>
  (field==='COLOUR'
    ? ['match', code(field), ...Object.entries(variants).flatMap(([key, value]) => [Number(key), value]), fallback]
    : ['case', ...Object.entries(variants).flatMap(([key, value]) => [has(field,Number(key)), value]), fallback]) as Expression;
const conspicuous = (yes: string, no: string) => choose(['==', code('CONVIS'), 1], yes, no);
const hasDepth = validNumber('VALSOU');
// DANGER02 describes a depth >20 m (catalogue p.96), independently of safety depth.
const knownDanger = choose(['<', numeric('VALSOU'), 0], 'DANGER03', choose(['>', numeric('VALSOU'), 20], 'DANGER02', 'DANGER01'));
export const safetyContour = 6;
const effectiveSafetyContour = numeric('s52_safety_contour',safetyContour);
const isolatedDanger: Expression = ['all', hasDepth, ['<=', numeric('VALSOU'), effectiveSafetyContour],
  ['>=', numeric('s52_surrounding_depth'), effectiveSafetyContour], ['!', has('WATLEV', 1, 2)]];
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
        4: conspicuous('DSHAER11','POSGEN01'), 5: 'FLGSTF01', 6: conspicuous('FLASTK11', 'FLASTK01'),
        7: conspicuous('MSTCON14', 'MSTCON04'), 9: conspicuous('MONUMT12','POSGEN01'), 10: conspicuous('MONUMT12','POSGEN01'),
        12: conspicuous('MONUMT12','POSGEN01'), 13: conspicuous('MONUMT12','POSGEN01'), 14: conspicuous('POSGEN03', 'POSGEN01'),
        15: conspicuous('DOMES011', 'DOMES001'), 16: conspicuous('RASCAN11', 'RASCAN01'),
        17: conspicuous('TOWERS03', 'TOWERS01'), 18: conspicuous('WNDMIL12','POSGEN01'), 19: conspicuous('WIMCON11', 'WIMCON01'),
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
  BOYSPP: choose(has('CATSPM',9,15), 'BOYSUP02', choose(has('CATSPM',52), 'BOYDEF03',
    by('BOYSHP', {1:'BOYSPP15',2:'BOYSPP25',3:'BOYSPP11',4:'BOYSPP35',5:'BOYSPP35',6:'BOYSPP11',7:'BOYSUP02',8:'BOYSPP35'}, 'BOYSPP11'))),
  BCNSPP: choose(has('CATSPM',18), 'NOTBRD11', choose(has('CATSPM',44), 'BCNSPP13', choose(has('CATSPM',52), 'BCNDEF13', beacon))),
  BCNLAT: beacon, BOYINB: 'BOYDEF03', LITFLT: 'LITFLT02', LITVES: 'LITVES02',
  LIGHTS: choose(has('CATLIT',8,11), 'LIGHTS82', choose(has('CATLIT',9), 'LIGHTS81',
    by('COLOUR', { 3:'LIGHTS11',4:'LIGHTS12',1:'LIGHTS13',6:'LIGHTS13',9:'LIGHTS13',11:'LIGHTS13' }, 'LITDEF11'))),
  TOPMAR: choose(['==', ['get','topmark_floating'], true], topmark(floatingTopmarks,'TMARDEF2'), topmark(rigidTopmarks,'TMARDEF1')),
  DAYMAR: by('TOPSHP', { 24:'DAYTRI01',25:'DAYTRI05' }, 'DAYSQR01'),
  WRECKS: choose(isolatedDanger, 'ISODGR01', choose(hasDepth, knownDanger,
    by('CATWRK', {1:'WRECKS04',2:'WRECKS05',3:'FOULGND1',4:'WRECKS01',5:'WRECKS01'},
      choose(has('WATLEV',1,2), 'WRECKS01', 'WRECKS05')))),
  UWTROC: choose(isolatedDanger, 'ISODGR01', choose(hasDepth, knownDanger,
    choose(has('WATLEV',4,5), 'UWTROC04', 'UWTROC03'))),
  OBSTRN: choose(isolatedDanger, 'ISODGR01', by('CATOBS', {5:'FSHHAV01',6:'FOULGND1',7:'FOULGND1',9:'ACHARE02',8:'FLTHAZ02',10:'FLTHAZ02'},
    choose(has('WATLEV',7), 'FLTHAZ02', choose(hasDepth, knownDanger,
      by('WATLEV', {1:'OBSTRN11',2:'OBSTRN11',4:'OBSTRN03',5:'OBSTRN03'}, 'OBSTRN01'))))),
  LNDMRK: landmark,
  BUISGL: choose(has('FUNCTN',3), 'CHKPNT01', choose(has('FUNCTN',33),conspicuous('POSGEN03','POSGEN01'),
    choose(has('FUNCTN',35),conspicuous('TNKCON12','TNKCON02'),choose(has('FUNCTN',20,21,22,23,24,25,26,27), landmark, conspicuous('BUISGL11','BUISGL01'))))),
  SILTNK: by('CATSIL', { 1:conspicuous('SILBUI11','SILBUI01'),2:conspicuous('TNKCON12','TNKCON02'),3:conspicuous('TOWERS03','TOWERS01'),4:conspicuous('TOWERS12','TOWERS02') }, conspicuous('TNKCON12','TNKCON02')),
  MORFAC: by('CATMOR', { 1:'MORFAC03',2:'MORFAC04',3:'PILPNT02',5:'PILPNT02',7:'BOYMOR11' }, 'MORFAC03'),
  ACHARE:'ACHARE02', ACHBRT:'ACHBRT07', ACHPNT:'ACHARE02', AIRARE:'AIRARE02', BERTHS:'BRTHNO01',
  BRIDGE:'', BUAARE:'BUAARE02', CGUSTA:'CGUSTA02', CHKPNT:by('CATCHP',{1:'CHKPNT01'},'POSGEN04'), CTRPNT:'POSGEN04', CRANES:'CRANES01',
  CTNARE:'CHINFO06', DISMAR:'DISMAR06', FOGSIG:'FOGSIG01', FORSTC:conspicuous('FORSTC11','FORSTC01'),
  FSHFAC:by('CATFIF',{1:'FSHFAC03'},'FSHFAC02'), FSHGRD:'FSHGRD01', GATCON:by('CATGAT',{4:'GATCON03',2:'GATCON04',3:'GATCON04'},'POSGEN01'),
  HRBFAC:choose(has('CATHAF',1),'ROLROL01',choose(has('CATHAF',4),'HRBFAC09',choose(has('CATHAF',5),'SMCFAC02','CHINFO07'))),
  HULKES:'HULKES01', LOCMAG:'LOCMAG01', MAGVAR:'MAGVAR01', MARCUL:'MARCUL02', RSCSTA:'RSCSTA02',
  NEWOBJ:'NEWOBJ01', OFSPLF:'OFSPLF01', PILBOP:'PILBOP02', PILPNT:'PILPNT02', PRCARE:'PRCARE12',
  PRDARE:by('CATPRA',{1:'PRDINS02',2:'PRDINS02',3:'PRDINS02',4:'PRDINS02',5:conspicuous('FLASTK11','FLASTK01'),6:'TMBYRD01',7:'PRDINS02',8:conspicuous('TNKCON12','TNKCON02'),9:conspicuous('WIMCON11','WIMCON01'),10:'PRDINS02'},'POSGEN01'),
  PYLONS:'POSGEN03', RADRFL:'RADRFL03',
  RADSTA:'RDOSTA02', RDOSTA:'RDOSTA02', RDOCAL:choose(validNumber('ORIENT'),by('TRAFIC',{1:'RDOCAL02',2:'RDOCAL02',3:'RDOCAL02',4:'RDOCAL03'},'RCLDEF01'),'RCLDEF01'),
  RETRFL:'RETRFL02', RTPBCN:'RTPBCN02', SISTAT:'SISTAT03', SISTAW:'SISTAW03', SMCFAC:'SMCFAC02',
  SPRING:'SPRING02', TIDEHT:'TIDEHT01', TIDSTR:'TIDSTR01', WATTUR:'WATTUR02', WEDKLP:'WEDKLP03',
  CURENT:choose(['has','ORIENT'],'CURENT01','CURDEF01'),
  VEGATN:'POSGEN01', LNDARE:'LNDARE01',
  LNDELV:'POSGEN04', LNDRGN:'POSGEN04', SNDWAV:'SNDWAV02', CBLARE:'CBLARE51', OSPARE:'CTYARE51',
  SLOGRD:'HILTOP01', SLOTOP:conspicuous('HILTOP11','HILTOP01'),
  TS_FEB:choose(validNumber('ORIENT'),by('CAT_TS',{1:'FLDSTR01',2:'EBBSTR01',3:'CURENT01'},'CURDEF01'),'CURDEF01'), TS_PAD:'TIDSTR01',
  CTSARE:'CHINFO07', DMPGRD:'CHINFO07', ICNARE:'CHINFO07', PIPARE:'CHINFO07', SPLARE:'CHINFO07',
  RCTLPT:choose(['has','ORIENT'],'RCTLPT52','RTLDEF51'),
  TSSLPT:'TSSLPT51', TWRTPT:by('TRAFIC',{1:'TWRTPT53',2:'TWRTPT53',3:'TWRTPT53',4:'TWRTPT52'},'TWRDEF51'),
  DWRTPT:'DWRUTE51',
  RESARE:choose(has('RESTRN',1,2),'ACHRES51',choose(has('RESTRN',7,8),'ENTRES51','CHINFO06')),
};

// These are SY instructions at an area's original anchor, not LC boundary glyphs.
const openingBridge = choose(has('CATBRG',2,3,4,5,7,8),'BRIDGE01','');
export const areaSprites: Record<string, SymbolValue> = {
  ...pointSprites, ACHARE:'ACHARE51', BRIDGE:openingBridge,
  // These objects' area lookup uses their footprint and outline, not a point emblem.
  BUISGL:'', LNDMRK:'', SILTNK:'', LNDARE:'', LNDELV:'', LNDRGN:'', SLOGRD:'', SLOTOP:'',
  PRDARE:by('CATPRA',{1:'QUARRY01',5:conspicuous('RFNERY11','POSGEN01'),6:'TMBYRD01',8:conspicuous('TNKFRM11','POSGEN01'),9:conspicuous('WNDFRM61','POSGEN01')},''),
};
export const linePointSprites: Record<string, SymbolValue> = {
  BRIDGE:openingBridge, RDOCAL:pointSprites.RDOCAL, RCTLPT:pointSprites.RCTLPT,
  LOCMAG:'LOCMAG01', MORFAC:pointSprites.MORFAC, NEWOBJ:'NEWOBJ01',
};
export const selectedSprite: Expression = ['case', ['==',['get','s52_geometry'],2],spriteExpression(areaSprites),
  ['==',['get','s52_geometry'],1],spriteExpression(linePointSprites), spriteExpression(pointSprites)];

export const patternSprites: Record<string, SymbolValue> = {
  DRGARE:'DRGARE01P', ICEARE:'ICEARE04P', MARCUL:'MARCUL02P', SNDWAV:'SNDWAV01P',
  FSHFAC:by('CATFIF',{1:'FSHFAC03P',2:'FSHFAC04P',3:'FSHFAC04P',4:'FSHFAC04P'},'FSHHAV02P'),
  OBSTRN:choose(has('CATOBS',6,7),'FOULAR01P',''),
  LNDRGN:choose(has('CATLND',2,12),'MARSHES1P',''),
  UNSARE:'NODATA03P', DEPARE:choose(['all',['!',validNumber('DRVAL1')],['!',validNumber('DRVAL2')]],'PRTSUR01P',''),
  VEGATN:choose(has('CATVEG',7,21),'VEGATN04P',choose(has('CATVEG',4,5,6),'VEGATN03P','')),
  // NEWOBJ with no usable description must retain an explicit unknown-area pattern.
  NEWOBJ:choose(['all',['!', ['has','SYMINS']], ['!', ['has','INFORM']]],'QUESMRK1P',''),
};
export const lineSprites: Record<string, SymbolValue> = {
  RECTRC:by('TRAFIC',{
    1:by('CATTRK',{1:'RECTRC58'},'RECTRC57'),2:by('CATTRK',{1:'RECTRC58'},'RECTRC57'),
    3:by('CATTRK',{1:'RECTRC58'},'RECTRC57'),4:by('CATTRK',{1:'RECTRC56'},'RECTRC55'),
  },'RECDEF51'), GATCON:by('CATGAT',{4:'GATCON03',2:'GATCON04',3:'GATCON04'},''),
  FERYRT:'FRYARE51', PIPOHD:choose(has('CONRAD',1,3),'RACNSP01',''),
  CONVYR:choose(has('CONRAD',1,3),'RACNSP01',''),
};

export function spriteExpression(registry: Record<string, SymbolValue>, fallback = ''): Expression {
  return ['match',['get','object_class'],...Object.entries(registry).flatMap(([key,value])=>[key,value]),fallback] as unknown as Expression;
}

export const spriteRotation: Expression = ['match',['get','object_class'],
  ['CURENT','TS_FEB','TSSLPT','TWRTPT','DWRTPT','RECTRC','RCTLPT','WRECKS','RDOCAL'], ['to-number',['coalesce',['get','ORIENT'],0],0],
  'LIGHTS',['case',has('CATLIT',8,9,11),0,135],0];

export function encSpriteLayers(ink: string, halo: string, theme = 'day'): LayerSpecification[] {
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
    filter:['all',['==',['geometry-type'],'Point'],['!=',selectedSprite,''],...(group.id==='enc-lights'?[['!',isSectorLight] as Expression]:[]),['in',['get','object_class'],['literal',
      sourceLayer==='enc_symbols'?group.classes.filter(key=>key!=='LNDARE'):group.classes]]],
    layout:{
      'icon-image':['coalesce',['image',selectedSprite],['image','QUESMRK1']],
      'icon-size':['interpolate',['linear'],['zoom'],9,0.85,13,1],
      'icon-anchor':['match',['get','object_class'],[...aidClasses,'LIGHTS','TOPMAR','DAYMAR'],'bottom','center'],
      'icon-offset':['case',['==',['get','object_class'],'DAYMAR'],['literal',[0,-18]],
        ['all',['==',['get','object_class'],'TOPMAR'],['==',['get','topmark_floating'],true]],['literal',[0,-8]],['literal',[0,0]]],
      'icon-rotate':spriteRotation,'icon-rotation-alignment':'map','icon-padding':3,
      'icon-allow-overlap':group.id==='enc-topmarks'||group.id==='enc-lights',
      'icon-ignore-placement':group.id==='enc-topmarks'||group.id==='enc-lights',
      // One placement owns the icon and its depth. Separate symbol layers would
      // let the depth text reserve collision space and hide the hazard itself.
      ...(group.id==='enc-hazard-symbols'?{
        'text-field':['case',hasDepth,['concat',['to-string',['abs',numeric('VALSOU')]],choose(has('QUASOU',3,4),' ?','')],''],
        'text-font':['Roboto Bold'],'text-size':12,'text-anchor':'center','text-padding':3,'text-optional':true,
      }:{}),
      'symbol-sort-key':['match',['get','object_class'],'BOYISD',0,'BCNISD',0,'BOYCAR',1,'BCNCAR',1,2],
    },
    ...(group.id==='enc-hazard-symbols'?{paint:{'text-color':ink,'text-halo-color':halo,'text-halo-width':1}}:{}),
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
  // Positional quality is independent of depth quality. Never replace a hazard with LOWACC01.
  layers.push(...['enc','enc_symbols'].map(sourceLayer => ({
    id:'enc-position-quality-'+sourceLayer,type:'symbol',source:'enc','source-layer':sourceLayer,minzoom:11,
    filter:['all',['==',['geometry-type'],'Point'],['>=',numeric('s52_quapos'),2],['<=',numeric('s52_quapos'),9]],
    layout:{'icon-image':'LOWACC01','icon-size':0.85,'icon-allow-overlap':true,'icon-ignore-placement':true},
  } as LayerSpecification)));
  layers.push({id:'enc-light-sectors',type:'symbol',source:'enc','source-layer':'enc',minzoom:10,
    filter:['all',['==',['get','object_class'],'LIGHTS'],isSectorLight],
    layout:{'icon-image':['image',sectorImage(theme)],'icon-anchor':'center','icon-size':1,
      'icon-rotation-alignment':'map','icon-pitch-alignment':'map','icon-allow-overlap':true,'icon-ignore-placement':true},
  });
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
