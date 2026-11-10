import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Paper, Radio, RadioGroup, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { AlignHorizontalJustifyCenter, ArrowLeftRight, ArrowUpDown, Circle, Crosshair, Layers, LockKeyhole, Maximize2, RotateCw, Shapes, X } from 'lucide-react';
import type { SelectedEntity } from '../../types/osm';
import type { GeometryOptions } from './geometryOperations';
import { EDITOR_LAYERS, type EditorLayer } from './geometryLocks';
import { toolBlockReason } from './geometryToolPresentation';
import type { GeometryCommandPlan } from './geometryCommandPlan';

export type GeometryToolRequest = GeometryOptions | { operation: 'lock'; layer?: EditorLayer };
export const geometryToolGroups = [
  { id: 'lock', label: 'Khóa đối tượng / layer', icon: LockKeyhole },
  { id: 'transform', label: 'Biến đổi hình học', icon: RotateCw },
  { id: 'align', label: 'Căn chỉnh / Phân bố', icon: AlignHorizontalJustifyCenter },
  { id: 'area', label: 'Phép toán vùng', icon: Shapes }
] as const;
export type GeometryToolGroup = typeof geometryToolGroups[number]['id'];

const operations = {
  lock: [['object', 'Đối tượng', 'Khóa lựa chọn để tránh chọn hoặc sửa nhầm.'], ['layer', 'Cả layer', 'Khóa toàn bộ lớp geometry, kể cả đối tượng tải sau.']],
  transform: [['circle', 'Tạo vòng tròn', 'Circularize · Sắp xếp các đỉnh hiện có thành vòng tròn.'], ['rotate', 'Xoay', 'Xoay toàn bộ lựa chọn quanh một tâm cố định.'], ['scale', 'Đổi tỷ lệ', 'Phóng to hoặc thu nhỏ, giữ tỷ lệ hình dạng.']],
  align: [['align', 'Căn hàng', 'Đưa tâm các đối tượng về cùng một hàng hoặc cột.'], ['distribute', 'Phân bố đều', 'Chia đều khoảng cách giữa tâm; giữ hai đối tượng ngoài cùng.']],
  area: [['hole', 'Tạo lỗ', 'Vùng tác động phải nằm hoàn toàn trong vùng chính và không chạm biên.'], ['union', 'Gộp vùng', 'Union · Kết hợp diện tích của các vùng đã chọn.'], ['intersection', 'Lấy phần giao', 'Intersection · Chỉ giữ diện tích chung của các vùng.'], ['difference', 'Trừ vùng', 'Difference · Loại các vùng tác động khỏi vùng chính.']]
} as const;
const toolIcons = { circle: Circle, rotate: RotateCw, scale: Maximize2, object: LockKeyhole, layer: Layers,
  align: AlignHorizontalJustifyCenter, distribute: ArrowLeftRight, hole: Circle, union: Shapes, intersection: Shapes, difference: Shapes };
const segmented = {
  display: 'flex', flexWrap: 'wrap', gap: 0.75,
  '& .MuiToggleButtonGroup-grouped': { m: 0, border: '1px solid', borderColor: 'divider', borderRadius: '7px !important', minHeight: 40, flex: '1 1 auto', px: 1.25, py: 0.75, gap: 0.75, color: 'text.primary', fontSize: 12, fontWeight: 650, textTransform: 'none', lineHeight: 1.35 },
  '& .MuiToggleButton-root.Mui-selected': { bgcolor: 'primary.light', borderColor: 'primary.main', color: 'primary.dark', '&:hover': { bgcolor: 'primary.light' } },
  '& .MuiToggleButton-root:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 }
} as const;
const labelStyle = { fontSize: 12, fontWeight: 750, mb: 0.75 };

export function GeometryToolsDialog({ group, count, polygonCount, circularizable, selection, initialLayer, impact, onInspect, onPreview, onApply, onClose }: {
  group: GeometryToolGroup; count: number; polygonCount: number; circularizable: boolean;
  selection: readonly SelectedEntity[]; initialLayer: EditorLayer;
  impact?: { nodes: number; relatedWays: number; complete: boolean };
  onInspect: (request: GeometryOptions) => GeometryCommandPlan;
  onPreview: (plan: GeometryCommandPlan | null) => void;
  onApply: (request: GeometryToolRequest, fingerprint?: string) => void; onClose: () => void;
}) {
  const titleId = useId(), reasonId = useId(), descriptionId = useId();
  const [operation, setOperation] = useState<string>(group === 'transform' && !circularizable ? 'rotate' : operations[group][0][0]);
  const [axis, setAxis] = useState('east');
  const [center, setCenter] = useState('selection');
  const [layer, setLayer] = useState<EditorLayer>(initialLayer);
  const [angle, setAngle] = useState('0');
  const [scale, setScale] = useState('100');
  const [radius, setRadius] = useState('');
  const [longitude, setLongitude] = useState('');
  const [latitude, setLatitude] = useState('');
  const [primary, setPrimary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmedFingerprint, setConfirmedFingerprint] = useState('');
  const panel = useRef<HTMLElement>(null);
  const blocked = toolBlockReason({ group, operation, count, polygonCount, circularizable, center, primary, angle, scale, radius, longitude, latitude });
  const request = useMemo<GeometryOptions>(() => ({ operation: operation as GeometryOptions['operation'], axis: axis as 'east' | 'north',
    center: group === 'transform' && center === 'custom' ? [Number(longitude), Number(latitude)] : undefined,
    value: Number(operation === 'rotate' ? angle : scale), radius: radius.trim() ? Number(radius) : undefined, primary }), [operation, axis, group, center, longitude, latitude, angle, scale, radius, primary]);
  const deferredRequest = useDeferredValue(request);
  const pending = request !== deferredRequest;
  const plan = useMemo(() => !blocked && group !== 'lock' ? onInspect(deferredRequest) : null, [blocked, group, onInspect, deferredRequest]);
  const reason = blocked ?? (pending ? 'Đang tính kết quả xem trước…' : plan?.reason ?? null);
  const risky = Boolean(plan && (plan.impact.externalWays.length || plan.impact.externalRelations.length));
  const confirmed = !risky || confirmedFingerprint === plan?.fingerprint;
  useEffect(() => setConfirmedFingerprint(''), [request, plan?.fingerprint]);
  useEffect(() => { onPreview(!pending && plan?.status === 'ready' ? plan : null); }, [pending, plan, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);
  useEffect(() => {
    panel.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); document.querySelector<HTMLCanvasElement>('.maplibregl-canvas')?.focus(); };
  }, [onClose]);
  const active = operations[group].find(item => item[0] === operation)!;
  const actionLabel = group === 'lock' ? operation === 'layer' ? 'Khóa layer' : `Khóa ${count} đối tượng`
    : group === 'area' ? 'Tạo vùng kết quả' : operation === 'circle' ? 'Tạo vòng tròn' : operation === 'rotate' ? 'Áp dụng góc xoay' : operation === 'scale' ? 'Áp dụng tỷ lệ' : operation === 'align' ? 'Căn hàng' : 'Phân bố đều';
  const apply = () => {
    if (reason || !confirmed) return;
    setError(null);
    try {
      if (group === 'lock') onApply({ operation: 'lock', ...(operation === 'layer' ? { layer } : {}) });
      else onApply(request, plan?.fingerprint);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể áp dụng. Hãy kiểm tra lựa chọn và thử lại.'); }
  };
  const field = { size: 'small' as const, fullWidth: true };
  return (
    <Paper component="section" ref={panel} tabIndex={-1} role="dialog" aria-modal={false} aria-labelledby={titleId} aria-describedby={descriptionId}
      sx={{ position: 'fixed', zIndex: 1300, right: { xs: 8, md: 20 }, bottom: { xs: 40, md: 'auto' }, top: { md: 72 }, width: { xs: 'calc(100% - 16px)', sm: 400 }, maxHeight: { xs: '56dvh', md: 'calc(100dvh - 120px)' }, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 2, boxShadow: '0 8px 28px rgba(15,23,42,.22)', '&:focus': { outline: 'none' } }}>
      <DialogTitle id={titleId} sx={{ px: 2.5, pt: 2, pb: 1.5, pr: 7, fontSize: 18, fontWeight: 800 }}>
        {geometryToolGroups.find(item => item.id === group)!.label}
        <Typography component="span" sx={{ display: 'block', mt: 0.5, color: 'text.secondary', fontSize: 12, fontWeight: 400 }}>{count} đối tượng đang chọn{group !== 'lock' && group !== 'area' && impact?.complete ? ` · ${impact.nodes} node` : ''}</Typography>
        <IconButton aria-label="Đóng công cụ" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12, width: 40, height: 40 }}><X size={18} aria-hidden="true" /></IconButton>
      </DialogTitle>
      <Box component="form" onSubmit={event => { event.preventDefault(); apply(); }} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <DialogContent dividers sx={{ px: 2.5, py: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <ToggleButtonGroup exclusive value={operation} aria-label="Chọn công cụ" onChange={(_, value: string | null) => { if (value) { setOperation(value); setError(null); } }} sx={[segmented, group === 'area' && { '& .MuiToggleButtonGroup-grouped': { flexBasis: 'calc(50% - 6px)' } }]}>
              {operations[group].map(([value, label]) => { const Icon = toolIcons[value]; return <ToggleButton key={value} value={value}><Icon size={16} aria-hidden="true" />{label}</ToggleButton>; })}
            </ToggleButtonGroup>
            <Typography id={descriptionId} sx={{ mt: 1, fontSize: 12, color: 'text.secondary', lineHeight: 1.6 }}>{active[2]}</Typography>
          </Box>
          {group === 'lock' && <>
            {operation === 'layer' && <Box><Typography sx={labelStyle}>Layer cần khóa</Typography><RadioGroup aria-label="Layer cần khóa" value={layer} onChange={event => setLayer(event.target.value as EditorLayer)} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>{Object.entries(EDITOR_LAYERS).map(([id, label]) => <FormControlLabel key={id} value={id} sx={{ m: 0 }} control={<Radio size="small" />} label={<Typography sx={{ fontSize: 13 }}>{label}</Typography>} />)}</RadioGroup></Box>}
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Khóa tạm trong phiên này, không ghi tag. Đối tượng vẫn hiển thị trên bản đồ. Mở Quản lý khóa để chỉnh sửa lại.</Typography>
          </>}
          {group === 'transform' && <>
            <Box>
              {operation === 'circle' ? <TextField {...field} label="Bán kính (m)" type="number" value={radius} onChange={event => { setRadius(event.target.value); setError(null); }} placeholder="Tự tính" helperText="Để trống: lấy khoảng cách trung bình từ các đỉnh đến tâm." slotProps={{ htmlInput: { min: 0, step: 'any' } }} />
                : <TextField {...field} label={operation === 'rotate' ? 'Góc xoay (°)' : 'Tỷ lệ (%)'} type="number" value={operation === 'rotate' ? angle : scale} onChange={event => { operation === 'rotate' ? setAngle(event.target.value) : setScale(event.target.value); setError(null); }} helperText={operation === 'rotate' ? 'Dương: ngược chiều kim đồng hồ. Âm: cùng chiều.' : '100% giữ nguyên · 200% gấp đôi chiều dài và chiều rộng.'} slotProps={{ htmlInput: { step: 'any', ...(operation === 'scale' ? { min: 0.01 } : {}) } }} />}
              {operation !== 'circle' && <Stack direction="row" sx={{ gap: 0.75, mt: 1, flexWrap: 'wrap' }} aria-label="Giá trị dùng nhanh">{(operation === 'rotate' ? [-90, 90, 180] : [50, 100, 150, 200]).map(value => <Button key={value} type="button" size="small" variant="outlined" onClick={() => { operation === 'rotate' ? setAngle(String(value)) : setScale(String(value)); setError(null); }} sx={{ minWidth: 56, color: 'text.secondary', borderColor: 'divider' }}>{value}{operation === 'rotate' ? '°' : '%'}</Button>)}</Stack>}
            </Box>
            <Box><Typography sx={labelStyle}>Tâm biến đổi</Typography><ToggleButtonGroup exclusive value={center} aria-label="Tâm biến đổi" onChange={(_, value: string | null) => { if (value) { setCenter(value); setError(null); } }} sx={segmented}><ToggleButton value="selection"><Crosshair size={15} aria-hidden="true" />Tâm lựa chọn</ToggleButton><ToggleButton value="custom">Nhập tọa độ</ToggleButton></ToggleButtonGroup>
              {center === 'custom' ? <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}><TextField {...field} label="Kinh độ (°)" value={longitude} onChange={event => { setLongitude(event.target.value); setError(null); }} type="number" slotProps={{ htmlInput: { min: -180, max: 180, step: 'any' } }} /><TextField {...field} label="Vĩ độ (°)" value={latitude} onChange={event => { setLatitude(event.target.value); setError(null); }} type="number" slotProps={{ htmlInput: { min: -90, max: 90, step: 'any' } }} /></Stack> : <Typography sx={{ mt: 0.75, fontSize: 12, color: 'text.secondary' }}>Tâm khung bao toàn bộ lựa chọn, không phải trọng tâm diện tích.</Typography>}
            </Box>
          </>}
          {group === 'align' && <Box><Typography sx={labelStyle}>Hướng {operation === 'align' ? 'căn hàng' : 'phân bố'}</Typography><ToggleButtonGroup exclusive value={axis} aria-label="Trục trong hệ tọa độ làm việc" onChange={(_, value: string | null) => { if (value) setAxis(value); }} sx={segmented}><ToggleButton value="east"><ArrowLeftRight size={16} aria-hidden="true" />Ngang · Đông–Tây</ToggleButton><ToggleButton value="north"><ArrowUpDown size={16} aria-hidden="true" />Dọc · Bắc–Nam</ToggleButton></ToggleButtonGroup><Typography sx={{ mt: 1, color: 'text.secondary', fontSize: 12 }}>{operation === 'align' ? 'Căn theo tâm các đối tượng; không thay đổi kích thước.' : 'Chia đều tâm, không chia đều khoảng trống giữa các mép.'}</Typography></Box>}
          {group === 'area' && <Box><Typography sx={labelStyle}>Vùng chính</Typography><RadioGroup aria-label="Vùng chính" value={primary} onChange={event => { setPrimary(event.target.value); setError(null); }} sx={{ maxHeight: 160, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5 }}>{selection.map(item => <FormControlLabel key={`${item.type}/${item.id}`} value={`${item.type}/${item.id}`} control={<Radio size="small" />} sx={{ m: 0, py: 0.25, '.MuiFormControlLabel-label': { minWidth: 0, overflowWrap: 'anywhere' } }} label={<Box><Typography sx={{ fontSize: 13, fontWeight: 650 }}>{item.tags.name || 'Chưa đặt tên'}</Typography><Typography sx={{ fontSize: 11, color: 'text.secondary', fontFamily: 'monospace' }}>{item.type}/{item.id}</Typography></Box>} />)}</RadioGroup><Typography sx={{ mt: 0.75, fontSize: 12, color: 'text.secondary' }}>Kết quả lấy thuộc tính của vùng chính. Các vùng khác là vùng tác động.</Typography></Box>}
          {group !== 'lock' && <Box sx={{ pt: 1.25, borderTop: '1px solid', borderColor: 'divider' }}>
            {plan?.status === 'ready' && <Stack spacing={1} sx={{ mb: 1.5 }}>
              <Typography role="status" sx={{ fontSize: 13, fontWeight: 750 }}>Xem trước · Chưa thay đổi dữ liệu</Typography>
              <Typography sx={{ fontSize: 12 }}>Nét đứt đỏ: hình gốc · Nét liền xanh: kết quả dự kiến. Có thể kéo bản đồ để quan sát.</Typography>
              <Typography sx={{ fontSize: 12 }}>{plan.impact.selected} lựa chọn → {plan.impact.expanded} đối tượng hình học{plan.impact.groups ? ` trong ${plan.impact.groups} nhóm` : ''} · {plan.impact.changedNodes} node thay đổi{plan.impact.created ? ` · Tạo ${plan.impact.created} entity mới` : ''}.</Typography>
              <Typography sx={{ fontSize: 12 }}>Cập nhật {plan.impact.changedEntities} entity trong 1 bước Undo. Phạm vi dưới đây chỉ tính dữ liệu đã tải; server vẫn kiểm tra khi lưu.</Typography>
              {risky && <Alert severity="warning" sx={{ fontSize: 12 }}>
                Ảnh hưởng ngoài lựa chọn: {plan.impact.externalWays.length} đường/vùng dùng chung node, {plan.impact.externalRelations.length} relation liên quan.
                <Box component="details" sx={{ mt: 0.75, overflowWrap: 'anywhere' }}><summary>Xem ID liên quan</summary>{[...plan.impact.externalWays, ...plan.impact.externalRelations].join(', ')}</Box>
              </Alert>}
              {risky && <FormControlLabel sx={{ m: 0 }} control={<Checkbox checked={confirmed} onChange={(_, checked) => setConfirmedFingerprint(checked ? plan.fingerprint : '')} />} label={<Typography sx={{ fontSize: 12 }}>Tôi đã kiểm tra ảnh hưởng ngoài lựa chọn</Typography>} />}
            </Stack>}
            <Typography sx={{ fontSize: 12, fontWeight: 650 }}>{group === 'area' ? 'Tạo geometry mới · Giữ nguyên các vùng gốc' : 'Chỉ cập nhật bản nháp · Có thể Ctrl/Cmd+Z'}</Typography>
            {!plan && group !== 'area' && impact && (!impact.complete || impact.relatedWays > 0) && <Alert severity="warning" sx={{ mt: 1, fontSize: 12 }}>{impact.complete ? `Trong dữ liệu đã tải: ${impact.relatedWays} đường/vùng ngoài lựa chọn dùng chung node có thể đổi theo.` : 'Chưa đủ dữ liệu thành viên để xác định toàn bộ phạm vi tác động.'}</Alert>}
            <Box component="details" sx={{ mt: 1, fontSize: 12, color: 'text.secondary', '& summary': { cursor: 'pointer', minHeight: 28, display: 'list-item', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } } }}><Box component="summary">Giới hạn & cách lưu</Box><Typography sx={{ pt: 0.5, fontSize: 12, lineHeight: 1.65 }}>{group === 'area' ? 'Vùng có lỗ hoặc nhiều phần được tạo bằng relation multipolygon. Kết quả rỗng hoặc vòng không hợp lệ sẽ bị chặn. Vùng gốc vẫn hiển thị bên dưới.' : 'Tính theo mét cục bộ, không phải CRS đo đạc địa chính. Phạm vi tối đa 1°, |vĩ độ tâm| ≤ 85°. Vòng polygon tối đa 2.000 đỉnh; giữ liên kết node dùng chung.'} Nhấn Lưu trên thanh công cụ để ghi vào dữ liệu.</Typography></Box>
          </Box>}
          {error && <Alert severity="error" role="alert" sx={{ fontSize: 12 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 2.5, py: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Typography id={reasonId} role="status" aria-live="polite" sx={{ width: '100%', color: 'text.secondary', fontSize: 12, lineHeight: 1.5, display: reason || !confirmed ? 'block' : 'none' }}>{reason ?? (!confirmed ? 'Xác nhận đã kiểm tra phạm vi tác động để áp dụng.' : '')}</Typography>
          <Button type="button" onClick={onClose}>Hủy</Button><Button type="submit" variant="contained" disabled={Boolean(reason) || !confirmed} aria-describedby={reasonId}>{actionLabel}</Button>
        </DialogActions>
      </Box>
    </Paper>
  );
}
