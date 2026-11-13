import type { EncAttribute } from './editing';

/** S-57 lists retain source order (e.g. colour bands), including repeated values. */
export function selectedAttributeOptions(def:EncAttribute,value:unknown) {
  return (Array.isArray(value)?value:[]).map(Number).map(code=>def.options?.find(option=>option.value===code)??{value:code,label:'Mã nguồn chưa có trong schema'});
}

export function parseAttributeInput(def:EncAttribute, raw:string):unknown {
  if (!raw.trim()) return undefined;
  if (def.kind==='text') {
    if (new TextEncoder().encode(raw).length>4096) throw new Error('Tối đa 4096 byte văn bản.');
    return raw;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value)>1e10) throw new Error('Nhập một số hữu hạn hợp lệ.');
  if ((def.kind==='integer' || ['SCAMIN','SCAMAX'].includes(def.key)) && (value<0 || !Number.isInteger(value))) throw new Error('Nhập số nguyên không âm.');
  if (def.key==='ORIENT' && (value<0 || value>=360)) throw new Error('Hướng phải từ 0 đến dưới 360°.');
  if (['SECTR1','SECTR2'].includes(def.key) && (value<0 || value>360)) throw new Error('Góc phải từ 0 đến 360°.');
  return value;
}
