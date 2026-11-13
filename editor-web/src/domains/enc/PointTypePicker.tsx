import { memo, useMemo } from 'react';
import { Autocomplete, Box, InputAdornment, TextField, Typography } from '@mui/material';
import { normalizeSymbolSearch, pointChoices, spriteStyle, type PointChoice } from './pointSymbols';
import type { EncTheme } from './style';

export function PointIcon({ symbol, theme }: { symbol:string; theme:EncTheme }) {
  const image = spriteStyle(symbol,theme);
  return <Box component="span" role="img" aria-label={`Ký hiệu ${symbol}`} sx={{ display:'inline-block', flexShrink:0, width:36, height:36, position:'relative' }}><Box component="span" sx={{ position:'absolute', left:'50%', top:'50%', transform:'translate(-50%, -50%)', width:image.rect.width*image.ratio, height:image.rect.height*image.ratio, backgroundImage:`url("${image.url}")`, backgroundPosition:`${-image.rect.x*image.ratio}px ${-image.rect.y*image.ratio}px`, backgroundSize:`${image.width*image.ratio}px ${image.height*image.ratio}px`, backgroundRepeat:'no-repeat' }} /></Box>;
}
export const PointTypePicker=memo(function PointTypePicker({ classes, labels, value, onChange, disabled, theme }: { classes:string[]; labels?:Record<string,string>; value:PointChoice; onChange:(value:PointChoice)=>void; disabled:boolean; theme:EncTheme }) {
  const options = useMemo(() => pointChoices(classes),[classes]);
  return <Autocomplete fullWidth size="small" disableClearable disabled={disabled} options={options} value={value} noOptionsText="Không tìm thấy ký hiệu điểm phù hợp"
    isOptionEqualToValue={(a,b)=>a.id===b.id} getOptionLabel={option=>`${option.objectClass} · ${option.symbol}`}
    filterOptions={(items,{inputValue})=>items.filter(item=>normalizeSymbolSearch(`${item.objectClass} ${item.symbol} ${item.description} ${labels?.[item.objectClass]??''}`).includes(normalizeSymbolSearch(inputValue)))}
    onChange={(_event,option)=>onChange(option)}
    renderOption={(props,option)=>{ const {key,...rest}=props; return <Box component="li" key={key} {...rest} sx={{ gap:1, minHeight:52, alignItems:'center' }}><PointIcon symbol={option.symbol} theme={theme}/><Box><Typography sx={{ fontSize:13, fontWeight:600 }}>{option.objectClass} · {option.symbol}</Typography><Typography sx={{ fontSize:12, lineHeight:1.4 }}>{option.description}</Typography></Box></Box>; }}
    renderInput={params=><TextField {...params} label="Loại điểm" placeholder="Tìm mã lớp, ký hiệu hoặc tên" slotProps={{ ...params.slotProps,input:{...params.slotProps.input,startAdornment:<InputAdornment position="start"><PointIcon symbol={value.symbol} theme={theme}/></InputAdornment>} }}/>} />;
});
