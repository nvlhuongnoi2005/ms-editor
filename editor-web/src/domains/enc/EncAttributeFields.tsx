import { memo, useEffect, useState } from 'react';
import { Autocomplete, Box, IconButton, MenuItem, Stack, TextField } from '@mui/material';
import { X } from 'lucide-react';
import type { EncAttribute } from './editing';
import { parseAttributeInput, selectedAttributeOptions } from './editingAttributes';

function ScalarField({ definition, value, disabled, onChange, onValidityChange }: { definition:EncAttribute; value:unknown; disabled:boolean; onChange:(value:unknown)=>void; onValidityChange:(invalid:boolean)=>void }) {
  const [text,setText] = useState(String(value??'')), [error,setError] = useState('');
  useEffect(()=>{setText(String(value??''));setError('');onValidityChange(false);},[value]);
  return <TextField fullWidth size="small" label={`${definition.label} (${definition.key})`} value={text} disabled={disabled} error={Boolean(error)} helperText={error || undefined} multiline={definition.key.includes('INFORM')}
    slotProps={{htmlInput:{inputMode:definition.kind==='text'?'text':'decimal'}}}
    onChange={event=>{
      setText(event.target.value);
      try { const next=parseAttributeInput(definition,event.target.value);setError('');onValidityChange(false);if(!Object.is(next,value))onChange(next); }
      catch(reason) { setError((reason as Error).message);onValidityChange(true); }
    }}
    onBlur={()=>{
      try { const next=parseAttributeInput(definition,text);if(!Object.is(next,value))onChange(next);setError('');onValidityChange(false); }
      catch(reason) { setError((reason as Error).message);onValidityChange(true); }
    }} />;
}
export const EncAttributeFields=memo(function EncAttributeFields({ schema, attributes, disabled, onChange, onValidityChange }: { schema:EncAttribute[]; attributes:Record<string,unknown>; disabled:boolean; onChange:(attributes:Record<string,unknown>)=>void; onValidityChange:(invalid:boolean)=>void }) {
  const [added,setAdded] = useState<string[]>([]);
  const [invalid,setInvalid] = useState<string[]>([]);
  useEffect(()=>{onValidityChange(invalid.length>0);},[invalid,onValidityChange]);
  useEffect(()=>()=>onValidityChange(false),[onValidityChange]);
  const visible = schema.filter(def=>def.key in attributes || added.includes(def.key) || ['OBJNAM','INFORM'].includes(def.key));
  const available = schema.filter(def=>!visible.some(item=>item.key===def.key));
  const update = (key:string,value:unknown) => {const next={...attributes};if(value===undefined) delete next[key];else next[key]=value;onChange(next);};
  return <Stack spacing={2}>
    {visible.map(def=><Stack key={def.key} direction="row" sx={{alignItems:'flex-start',gap:0.5}}>
      {def.kind==='list' ? <Autocomplete multiple fullWidth size="small" disabled={disabled} options={def.options??[]} getOptionLabel={option=>`${option.value} · ${option.label}`} isOptionEqualToValue={(a,b)=>a.value===b.value} value={selectedAttributeOptions(def,attributes[def.key])} onChange={(_event,values)=>update(def.key,values.length?values.map(value=>value.value):undefined)} renderInput={params=><TextField {...params} label={`${def.label} (${def.key})`}/>} />
      : def.kind==='enum' ? <TextField select fullWidth size="small" disabled={disabled} label={`${def.label} (${def.key})`} value={attributes[def.key]??''} onChange={event=>update(def.key,event.target.value===''?undefined:Number(event.target.value))}><MenuItem value="">Chưa xác định</MenuItem>{(def.options??[]).map(option=><MenuItem key={option.value} value={option.value}>{option.value} · {option.label}</MenuItem>)}</TextField>
      : <ScalarField definition={def} value={attributes[def.key]} disabled={disabled} onChange={value=>update(def.key,value)} onValidityChange={bad=>setInvalid(keys=>bad?[...new Set([...keys,def.key])]:keys.filter(key=>key!==def.key))}/>}
      <IconButton size="small" aria-label={`Xóa trường ${def.key}`} disabled={disabled || !(def.key in attributes) && !added.includes(def.key)} onClick={()=>{setAdded(current=>current.filter(key=>key!==def.key));setInvalid(current=>current.filter(key=>key!==def.key));update(def.key,undefined);}}><X size={16}/></IconButton>
    </Stack>)}
    <Box><Autocomplete size="small" disabled={disabled || !available.length} options={available} value={null} noOptionsText="Không còn trường phù hợp" getOptionLabel={option=>`${option.key} · ${option.label}`} onChange={(_event,value)=>{if(value)setAdded(current=>[...current,value.key]);}} renderInput={params=><TextField {...params} label="Thêm trường theo schema" placeholder="Tìm tên hoặc mã thuộc tính"/>}/></Box>
  </Stack>;
});
