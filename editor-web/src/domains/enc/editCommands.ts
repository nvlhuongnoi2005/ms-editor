import type { EncEditFeature, EncAttribute } from './editing';

export function createEncPoint(objectClass:string,attributes:Record<string,unknown>,coordinates:[number,number],scale?:number):EncEditFeature {
  if(coordinates.length!==2||!coordinates.every(Number.isFinite)||Math.abs(coordinates[0])>180||Math.abs(coordinates[1])>90)throw Error('Tọa độ điểm không hợp lệ.');
  const sourceId=`new:${crypto.randomUUID()}`;
  return {key:`${objectClass}/${sourceId}`,sourceId,objectClass,attributes:structuredClone(attributes),geometry:{type:'Point',coordinates:[...coordinates]},deleted:false,canMove:true,canDelete:true,...(scale!==undefined?{symbolScale:scale}:{})};
}

/** Copy semantic editor fields, never source identities or primitive links. */
export function canCopyEncPoint(feature:EncEditFeature|undefined|null,classes:string[]):boolean {
  return Boolean(feature&&!feature.deleted&&feature.geometry.type==='Point'&&Array.isArray(feature.geometry.coordinates)&&feature.geometry.coordinates.length===2&&classes.includes(feature.objectClass));
}
export function copyEncPoint(feature:EncEditFeature,classes:string[],schema:EncAttribute[],coordinates=feature.geometry.coordinates as [number,number]):EncEditFeature {
  if(!canCopyEncPoint(feature,classes))throw Error('Chỉ hỗ trợ sao chép điểm 2D thuộc các lớp được phép tạo.');
  const allowed=new Set(schema.map(field=>field.key));
  const attributes=Object.fromEntries(Object.entries(feature.attributes).filter(([key])=>allowed.has(key)));
  return createEncPoint(feature.objectClass,attributes,coordinates,feature.symbolScale);
}
