import {commitChanges, type EncEditFeature, type EncEditState, type EncAttribute} from './editing';
import {parseAttributeInput} from './editingAttributes';
import {movementLockMessage} from './editPermissions';

export type ReviewField={name:string;before:unknown;after:unknown};
export type ReviewEntry={key:string;label:string;action:string;fields:ReviewField[];errors:string[];sourceMissing:boolean};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function reviewEditing(state:EncEditState,originals:Record<string,EncEditFeature>,schema:Record<string,EncAttribute[]>):ReviewEntry[]{
  return commitChanges(state).map(change=>{
    const saved=state.saved[change.key],source=originals[change.key];
    const before=saved??source,after=change.after??source;
    const created=(change.after??saved)?.sourceId.startsWith('new:')??false;
    const fields:ReviewField[]=[],errors:string[]=[];
    const sourceMissing=!created&&!before;
    const add=(name:string,a:unknown,b:unknown)=>{if(!same(a,b))fields.push({name,before:a,after:b});};
    for(const key of [...new Set([...Object.keys(before?.attributes??{}),...Object.keys(after?.attributes??{})])].sort())add(key,before?.attributes[key],after?.attributes[key]);
    add('Tọa độ / hình học',before?.geometry,after?.geometry);
    add('Kích thước ký hiệu',before?.symbolScale??1,after?.symbolScale??1);
    add('Đã đánh dấu xóa',before?.deleted??false,after?.deleted??false);
    add('Mở khóa vị trí riêng',before?.positionOverride??false,after?.positionOverride??false);
    if(after&&!after.deleted){
      const definitions=schema[after.objectClass]??[];
      for(const [key,value] of Object.entries(after.attributes)){
        if(before&&same(before.attributes[key],value))continue;
        const def=definitions.find(def=>def.key===key);
        if(!def){if(!sourceMissing)errors.push(`${key}: không thuộc các trường được phép sửa.`);continue;}
        try{
          if(def.kind==='list'){
            if(!Array.isArray(value)||!value.length||value.length>64||value.some(v=>typeof v!=='number'||!def.options?.some(option=>option.value===v)))throw Error('Danh sách mã không hợp lệ.');
          }else if(def.kind==='enum'){
            if(typeof value!=='number'||!def.options?.some(option=>option.value===value))throw Error('Mã không thuộc danh sách cho phép.');
          }else{
            if(typeof value!==(def.kind==='text'?'string':'number'))throw Error('Sai kiểu dữ liệu.');
            parseAttributeInput(def,String(value));
          }
        }catch(reason){errors.push(`${key}: ${(reason as Error).message}`);}
      }
      const a=after.attributes;
      if((!before||!same(a.DRVAL1,before.attributes.DRVAL1)||!same(a.DRVAL2,before.attributes.DRVAL2))&&typeof a.DRVAL1==='number'&&typeof a.DRVAL2==='number'&&a.DRVAL1>a.DRVAL2)errors.push('DRVAL1 không được lớn hơn DRVAL2.');
      const geometryChanged=!same(before?.geometry,after.geometry);
      if(geometryChanged){
        if(source&&!source.canMove&&!(after.positionOverride&&source.canOverridePosition))errors.push(movementLockMessage(source)!);
        if(after.geometry.type==='Point'){
          const p=after.geometry.coordinates;
          if(!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v))||Math.abs(p[0])>180||Math.abs(p[1])>90)errors.push('Tọa độ điểm 2D không hợp lệ.');
        }
      }
      if(after.symbolScale!==undefined&&(after.geometry.type!=='Point'||!Number.isFinite(after.symbolScale)||after.symbolScale<.5||after.symbolScale>4))errors.push('Kích thước ký hiệu phải từ 50% đến 400%.');
    }
    if(change.after?.deleted&&source&&!source.canDelete)errors.push('Đối tượng nguồn không được phép xóa.');
    return {key:change.key,label:String(after?.attributes.OBJNAM??before?.attributes.OBJNAM??change.key),
      action:change.after===null?'Khôi phục nguồn':change.after.deleted?'Xóa':!saved&&created?'Thêm mới':'Chỉnh sửa',fields,errors,sourceMissing};
  });
}

