import { Box, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
export type EncMenuAction={id:string;label:string;icon:LucideIcon;disabled?:boolean;danger?:boolean;separator?:boolean;run:()=>void};
type Props={position:{top:number;left:number}|null;title:string;loading?:boolean;actions:EncMenuAction[];onClose:()=>void;onError:(message:string)=>void};

export function EncContextMenu({position,title,loading,actions,onClose,onError}:Props){
  return <Menu open={Boolean(position)} onClose={onClose} anchorReference="anchorPosition" anchorPosition={position??undefined}
    slotProps={{list:{'aria-label':'Thao tác biên tập ENC'},paper:{sx:{width:272,maxWidth:'calc(100vw - 24px)',maxHeight:'calc(100dvh - 32px)',overflowY:'auto',bgcolor:'#fcfbf7',color:'#252c2b',borderRadius:1,'& .MuiMenuItem-root':{minHeight:36,fontSize:13},'& .MuiMenuItem-root:focus-visible':{outline:'2px solid #8b2235',outlineOffset:-2}}}}}>
    <Box sx={{px:2,py:1}}><Typography component="p" sx={{fontSize:13,fontWeight:600,overflowWrap:'anywhere'}}>{loading?'Đang lấy đối tượng…':title}</Typography></Box>
    <Divider/>
    {actions.flatMap(action=>[
      ...(action.separator?[<Divider key={`${action.id}-separator`}/>]:[]),
      <MenuItem key={action.id} disabled={loading||action.disabled} onClick={()=>{onClose();try{action.run();}catch(error){onError(error instanceof Error?error.message:String(error));}}} sx={action.danger?{color:'#b4233c'}:undefined}>
        <ListItemIcon sx={{color:'inherit',minWidth:'30px !important'}}><action.icon size={16}/></ListItemIcon>
        <ListItemText primary={action.label} slotProps={{primary:{sx:{fontSize:13,fontFamily:'inherit'}}}}/>
      </MenuItem>,
    ])}
  </Menu>;
}
