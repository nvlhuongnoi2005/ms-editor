import type { EncGeometry } from './editing';
type XY=[number,number];
const limit=85.0511287798;
export function projectPosition(point:number[]):XY {
  if(!point.every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>limit)throw Error('Tọa độ vượt phạm vi biến đổi bản đồ.');
  return [point[0]*Math.PI/180,Math.log(Math.tan(Math.PI/4+point[1]*Math.PI/360))];
}
function unprojectPosition(point:XY,original:number[]):number[]{
  const result=[point[0]*180/Math.PI,(2*Math.atan(Math.exp(point[1]))-Math.PI/2)*180/Math.PI,...original.slice(2)];
  projectPosition(result);return result;
}
export function geometryPositions(geometry:EncGeometry):number[][] {
  const result:number[][]=[];
  const visit=(value:unknown)=>{if(!Array.isArray(value))throw Error('Hình học không hợp lệ.');if(typeof value[0]==='number'){projectPosition(value);result.push(value);}else value.forEach(visit);};
  visit(geometry.coordinates);if(!result.length)throw Error('Hình học rỗng.');return result;
}
export function transformGeometry(geometry:EncGeometry,center:XY,delta:XY=[0,0],scale=1):EncGeometry {
  if(!Number.isFinite(scale)||scale<=0||!delta.every(Number.isFinite))throw Error('Tỷ lệ biến đổi không hợp lệ.');
  const visit=(value:unknown):unknown=>{
    if(!Array.isArray(value))throw Error('Hình học không hợp lệ.');
    if(typeof value[0]!=='number')return value.map(visit);
    const point=projectPosition(value);
    return unprojectPosition([center[0]+(point[0]-center[0])*scale+delta[0],center[1]+(point[1]-center[1])*scale+delta[1]],value);
  };
  return {type:geometry.type,coordinates:visit(geometry.coordinates)};
}
export function geometryCenter(geometry:EncGeometry):XY {
  const points=geometryPositions(geometry).map(projectPosition);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const [x,y]of points){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  return [(minX+maxX)/2,(minY+maxY)/2];
}
export const minSymbolScale=0.5;
export const maxSymbolScale=4;
export const symbolScale=(value?:number)=>Math.min(maxSymbolScale,Math.max(minSymbolScale,value??1));
