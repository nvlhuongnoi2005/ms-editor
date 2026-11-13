import { Box, ButtonBase, IconButton, Paper, Typography } from '@mui/material';
import { MapPin, X } from 'lucide-react';
import { featureSymbol, spriteStyle } from './pointSymbols';
import { encSymbols } from './symbolCatalog';
import type { EncTheme } from './style';

type Props={features:Record<string,unknown>[];theme:EncTheme;editing:boolean;onChoose:(properties:Record<string,unknown>)=>void;onClose:()=>void};
const descriptions=new Map(encSymbols.map(symbol=>[symbol.code,symbol.description]));

export function EncFeatureChooser({features,theme,editing,onChoose,onClose}:Props){
  return <Paper component="section" role="region" aria-labelledby="enc-feature-chooser-title" className="enc-properties enc-feature-chooser" elevation={0}>
    <Box className="enc-properties-header">
      <Box><Typography component="h2" id="enc-feature-chooser-title">Chọn đối tượng</Typography>
        <Typography component="p" variant="body2">{features.length} đối tượng tại vị trí bấm · Chọn để {editing?'biên tập':'xem chi tiết'}</Typography></Box>
      <IconButton autoFocus aria-label="Đóng danh sách đối tượng" onClick={onClose}><X size={20}/></IconButton>
    </Box>
    <Box component="ul" className="enc-feature-choices">
      {features.map((properties,index)=>{
        const symbol=featureSymbol(properties),info=symbol?spriteStyle(symbol,theme,36):undefined;
        const title=String(properties.OBJNAM??properties.NOBJNM??properties.object_class??properties.name??'Đối tượng ENC');
        const detail=[properties.object_class,symbol,properties.cell_name].filter(Boolean).map(String).join(' · ');
        return <Box component="li" key={index}><ButtonBase className="enc-feature-choice" onClick={()=>onChoose(properties)}>
          <Box className="enc-feature-choice-image">{info?<Box component="span" role="img" aria-label={`Ký hiệu ${symbol}`} sx={{display:'block',width:info.rect.width*info.ratio,height:info.rect.height*info.ratio,backgroundImage:`url("${info.url}")`,backgroundRepeat:'no-repeat',backgroundPosition:`${-info.rect.x*info.ratio}px ${-info.rect.y*info.ratio}px`,backgroundSize:`${info.width*info.ratio}px ${info.height*info.ratio}px`}}/>:<MapPin size={20}/>}</Box>
          <Box sx={{minWidth:0}}><Typography component="span" sx={{display:'block',fontWeight:600}}>{title}</Typography>
            {detail&&<Typography component="span" variant="body2" sx={{display:'block',color:'text.secondary'}}>{detail}</Typography>}
            {symbol&&<Typography component="span" variant="body2" sx={{display:'block'}}>{descriptions.get(symbol)}</Typography>}
          </Box>
        </ButtonBase></Box>;
      })}
    </Box>
  </Paper>;
}
