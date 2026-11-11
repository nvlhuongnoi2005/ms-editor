import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, IconButton, InputAdornment, Paper, TextField, Typography } from '@mui/material';
import { Search, X } from 'lucide-react';
import { encSymbols, normalizeSymbolSearch } from './symbolCatalog';

type Props = { onClose: () => void };
const atlasUrl = '/enc/assets/sprites/day_simplified@2x.png';

export function EncSymbolCatalog({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [imageError, setImageError] = useState(false);
  const [atlasSize, setAtlasSize] = useState<{ width: number; height: number } | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const symbols = useMemo(() => {
    const needle = normalizeSymbolSearch(query);
    return encSymbols.filter(symbol => normalizeSymbolSearch(`${symbol.code} ${symbol.description}`).includes(needle));
  }, [query]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return <Paper component="aside" id="enc-symbol-catalog" className="enc-symbol-catalog" elevation={0} aria-labelledby="enc-symbol-title">
    <Box className="enc-symbol-header">
      <Box>
        <Typography component="h2" id="enc-symbol-title">Bảng ký hiệu</Typography>
        <Typography component="p">Tra cứu mã và ý nghĩa ký hiệu ENC · Mẫu màu Ngày</Typography>
      </Box>
      <IconButton aria-label="Đóng bảng ký hiệu" onClick={onClose}><X size={20} /></IconButton>
    </Box>
    <Box className="enc-symbol-search">
      <TextField autoFocus inputRef={searchInput} fullWidth label="Tìm mã hoặc giải thích" value={query} onChange={event => setQuery(event.target.value)}
        slotProps={{ input: {
          startAdornment:<InputAdornment position="start"><Search size={18} /></InputAdornment>,
          endAdornment:query ? <InputAdornment position="end"><IconButton size="small" aria-label="Xóa tìm kiếm ký hiệu" onClick={() => { setQuery(''); searchInput.current?.focus(); }}><X size={16} /></IconButton></InputAdornment> : undefined,
        } }} />
      <Typography component="p" role="status" aria-live="polite">{symbols.length} / {encSymbols.length} ký hiệu</Typography>
    </Box>
    {/* Chỉ nạp một atlas; mỗi ô dùng tọa độ sprite để cắt đúng ảnh bằng CSS. */}
    <img className="enc-symbol-atlas-loader" src={atlasUrl} alt="" aria-hidden="true" onError={() => setImageError(true)} onLoad={event => {
      setImageError(false);
      setAtlasSize({ width:event.currentTarget.naturalWidth, height:event.currentTarget.naturalHeight });
    }} />
    {imageError && <Alert severity="warning" className="enc-symbol-image-error">Không tải được hình ảnh ký hiệu. Bạn vẫn có thể tra cứu mã và giải thích.</Alert>}
    <Box className="enc-symbol-scroll" tabIndex={0} aria-label="Danh sách ký hiệu ENC">
      <table className="enc-symbol-table" aria-label="Mã, hình ảnh và giải thích ký hiệu ENC">
        <colgroup><col className="enc-symbol-code-column" /><col className="enc-symbol-image-column" /><col /></colgroup>
        <thead><tr><th scope="col">Mã ký hiệu</th><th scope="col">Hình ảnh</th><th scope="col">Giải thích</th></tr></thead>
        <tbody>{symbols.map(({ code, description, sprite }) => {
          // Atlas @2x lưu tọa độ theo pixel bitmap. Quy đổi pixelRatio và giữ
          // tỷ lệ ảnh khi thu ký hiệu lớn để vừa cột, tránh bóp méo hình dạng.
          const scale = Math.min(1, 64 / (sprite.width / sprite.pixelRatio), 52 / (sprite.height / sprite.pixelRatio));
          const ratio = scale / sprite.pixelRatio;
          return <tr key={code}>
            <th scope="row">{code}</th>
            <td className="enc-symbol-preview-cell"><Box className="enc-symbol-preview">
              {!imageError && atlasSize && <span role="img" aria-label={`Ký hiệu ${code}`} style={{
                display:'block', width:sprite.width * ratio, height:sprite.height * ratio,
                backgroundImage:`url("${atlasUrl}")`, backgroundRepeat:'no-repeat',
                backgroundPosition:`${-sprite.x * ratio}px ${-sprite.y * ratio}px`,
                backgroundSize:`${atlasSize.width * ratio}px ${atlasSize.height * ratio}px`,
              }} />}
            </Box></td>
            <td>{description}</td>
          </tr>;
        })}</tbody>
      </table>
      {!symbols.length && <Box className="enc-symbol-empty">
        <Typography component="p">Không tìm thấy ký hiệu</Typography>
        <Typography component="p">Thử mã khác hoặc từ khóa như “phao”, “đèn”, “độ sâu”.</Typography>
      </Box>}
    </Box>
  </Paper>;
}
