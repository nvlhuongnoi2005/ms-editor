import {Alert,Box,Button,IconButton,Paper,Typography} from '@mui/material';
import {X} from 'lucide-react';
import type {ReviewEntry} from './editReview';

const valueText=(value:unknown):string=>{
  if(value===undefined||value===null)return '—';
  if(typeof value==='object'&&'type' in value&&'coordinates' in value){
    const geometry=value as {type:string;coordinates:unknown};
    if(geometry.type!=='Point'){
      const pending=[geometry.coordinates];let count=0,w=Infinity,s=Infinity,e=-Infinity,n=-Infinity;
      while(pending.length){
        const item=pending.pop();if(!Array.isArray(item))continue;
        if(typeof item[0]==='number'&&typeof item[1]==='number'){count++;w=Math.min(w,item[0]);s=Math.min(s,item[1]);e=Math.max(e,item[0]);n=Math.max(n,item[1]);}
        else for(const child of item)pending.push(child);
      }
      return count?`${geometry.type} · ${count} đỉnh · Phạm vi [${w.toFixed(8)}, ${s.toFixed(8)}] → [${e.toFixed(8)}, ${n.toFixed(8)}]`:geometry.type;
    }
    return JSON.stringify(geometry.coordinates);
  }
  return typeof value==='object'?JSON.stringify(value):String(value);
};
type Props={entries:ReviewEntry[];loading:boolean;error:string;onClose:()=>void;onSelect:(key:string)=>void};
export function EncEditReview({entries,loading,error,onClose,onSelect}:Props){
  return <Paper component="section" role="region" aria-labelledby="enc-review-title" className="enc-properties enc-edit-review" elevation={0}>
    <Box className="enc-properties-header"><Box><Typography component="h2" id="enc-review-title">Rà soát thay đổi</Typography><Typography variant="body2">So với lần lưu gần nhất; đối tượng chưa lưu so với nguồn.</Typography></Box><IconButton autoFocus aria-label="Đóng rà soát thay đổi" onClick={onClose}><X size={20}/></IconButton></Box>
    <Box className="enc-properties-body">
      {loading&&<Typography role="status">Đang đối chiếu dữ liệu nguồn…</Typography>}
      {error&&<Alert severity="error">{error}</Alert>}
      {!entries.length&&!loading&&<Typography>Không có thay đổi chưa lưu.</Typography>}
      {entries.map(entry=><Box key={entry.key} component="article" sx={{py:2,borderBottom:'1px solid var(--enc-rule)'}}>
        <Button onClick={()=>onSelect(entry.key)} sx={{textAlign:'left',justifyContent:'flex-start',overflowWrap:'anywhere'}}>{entry.action} · {entry.label}</Button>
        <Typography variant="caption" component="p" sx={{overflowWrap:'anywhere'}}>{entry.key}</Typography>
        {entry.sourceMissing&&<Alert severity="warning">Chưa tải được bản gốc để đối chiếu đầy đủ.</Alert>}
        {entry.errors.map((message,index)=><Alert severity="error" key={index}>{message}</Alert>)}
        {!!entry.fields.length&&<table className="enc-review-table"><thead><tr><th>Trường</th><th>Trước</th><th>Sau</th></tr></thead><tbody>{entry.fields.map(field=><tr key={field.name}><th scope="row">{field.name}</th><td>{valueText(field.before)}</td><td>{valueText(field.after)}</td></tr>)}</tbody></table>}
      </Box>)}
      <Typography variant="caption" component="p" sx={{pt:2}}>Kiểm tra schema và thay đổi cơ bản; chưa thay thế kiểm tra topology hoặc kiểm tra sản phẩm ENC đầy đủ.</Typography>
    </Box>
  </Paper>;
}
