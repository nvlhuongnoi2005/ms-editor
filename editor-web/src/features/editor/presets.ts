import type { Tags } from '../../types/osm';

export type PresetGeometry = 'point' | 'line' | 'area' | 'relation';
export type PresetFieldType = 'text' | 'number' | 'yesno' | 'select';

export interface PresetField {
  key: string;
  label: string;
  type: PresetFieldType;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface Preset {
  id: string;
  group: string;
  label: string;
  geometry: PresetGeometry[];
  matchTags: Tags;
  fields: PresetField[];
}

export interface PresetGroup {
  id: string;
  label: string;
}

const commonName: PresetField = { key: 'name', label: 'Tên', type: 'text', placeholder: 'Tên phổ biến hoặc chính thức' };
const yesNo: Array<{ value: string; label: string }> = [{ value: 'yes', label: 'Có' }, { value: 'no', label: 'Không' }];
const roadSurface = [{ value: 'asphalt', label: 'Nhựa' }, { value: 'concrete', label: 'Bê tông' }, { value: 'paved', label: 'Đã trải mặt' }, { value: 'unpaved', label: 'Chưa trải mặt' }];

export const PRESET_GROUPS: PresetGroup[] = [
  { id: 'waterway', label: 'Đường nước' },
  { id: 'water-area', label: 'Vùng nước' },
  { id: 'transport', label: 'Giao thông' },
  { id: 'landuse', label: 'Sử dụng đất & tự nhiên' },
  { id: 'facility', label: 'Công trình & tiện ích' },
  { id: 'boundary', label: 'Ranh giới & quan hệ' }
];

export const PRESETS: Preset[] = [
  { id: 'waterway-river', group: 'waterway', label: 'Sông', geometry: ['line'], matchTags: { waterway: 'river' }, fields: [commonName, { key: 'width', label: 'Chiều rộng', type: 'number', placeholder: 'Mét' }, { key: 'intermittent', label: 'Lúc chảy lúc không', type: 'yesno', options: yesNo }, { key: 'boat', label: 'Có thể đi thuyền', type: 'yesno', options: yesNo }] },
  { id: 'waterway-stream', group: 'waterway', label: 'Suối', geometry: ['line'], matchTags: { waterway: 'stream' }, fields: [commonName, { key: 'width', label: 'Chiều rộng', type: 'number', placeholder: 'Mét' }, { key: 'intermittent', label: 'Lúc chảy lúc không', type: 'yesno', options: yesNo }, { key: 'seasonal', label: 'Theo mùa', type: 'yesno', options: yesNo }] },
  { id: 'waterway-canal', group: 'waterway', label: 'Kênh', geometry: ['line'], matchTags: { waterway: 'canal' }, fields: [commonName, { key: 'width', label: 'Chiều rộng', type: 'number', placeholder: 'Mét' }, { key: 'boat', label: 'Có thể đi thuyền', type: 'yesno', options: yesNo }] },
  { id: 'waterway-ditch', group: 'waterway', label: 'Mương', geometry: ['line'], matchTags: { waterway: 'ditch' }, fields: [commonName, { key: 'width', label: 'Chiều rộng', type: 'number', placeholder: 'Mét' }, { key: 'intermittent', label: 'Lúc chảy lúc không', type: 'yesno', options: yesNo }] },
  { id: 'water-reservoir', group: 'water-area', label: 'Hồ chứa nước', geometry: ['area'], matchTags: { natural: 'water', water: 'reservoir' }, fields: [commonName, { key: 'intermittent', label: 'Lúc chảy lúc không', type: 'yesno', options: yesNo }, { key: 'salt', label: 'Nước mặn', type: 'yesno', options: yesNo }, { key: 'tidal', label: 'Thủy triều', type: 'yesno', options: yesNo }] },
  { id: 'water-lake', group: 'water-area', label: 'Hồ', geometry: ['area'], matchTags: { natural: 'water', water: 'lake' }, fields: [commonName, { key: 'intermittent', label: 'Lúc chảy lúc không', type: 'yesno', options: yesNo }, { key: 'salt', label: 'Nước mặn', type: 'yesno', options: yesNo }] },
  { id: 'water-riverbank', group: 'water-area', label: 'Vùng mặt nước sông', geometry: ['area'], matchTags: { natural: 'water', water: 'river' }, fields: [commonName, { key: 'intermittent', label: 'Lúc chảy lúc không', type: 'yesno', options: yesNo }] },
  { id: 'highway-primary', group: 'transport', label: 'Đường chính', geometry: ['line'], matchTags: { highway: 'primary' }, fields: [commonName, { key: 'ref', label: 'Mã tuyến', type: 'text', placeholder: 'QL.32, ĐT.174…' }, { key: 'lanes', label: 'Số làn', type: 'number' }, { key: 'surface', label: 'Mặt đường', type: 'select', options: roadSurface }, { key: 'maxspeed', label: 'Tốc độ tối đa', type: 'number', placeholder: 'km/h' }, { key: 'oneway', label: 'Một chiều', type: 'yesno', options: yesNo }] },
  { id: 'highway-secondary', group: 'transport', label: 'Đường tỉnh / liên huyện', geometry: ['line'], matchTags: { highway: 'secondary' }, fields: [commonName, { key: 'ref', label: 'Mã tuyến', type: 'text', placeholder: 'ĐT.xxx' }, { key: 'lanes', label: 'Số làn', type: 'number' }, { key: 'surface', label: 'Mặt đường', type: 'select', options: roadSurface }, { key: 'maxspeed', label: 'Tốc độ tối đa', type: 'number', placeholder: 'km/h' }] },
  { id: 'highway-residential', group: 'transport', label: 'Đường dân sinh', geometry: ['line'], matchTags: { highway: 'residential' }, fields: [commonName, { key: 'surface', label: 'Mặt đường', type: 'select', options: roadSurface }, { key: 'oneway', label: 'Một chiều', type: 'yesno', options: yesNo }] },
  { id: 'landuse-forest', group: 'landuse', label: 'Rừng', geometry: ['area'], matchTags: { landuse: 'forest' }, fields: [commonName, { key: 'leaf_type', label: 'Loại cây', type: 'select', options: [{ value: 'broadleaved', label: 'Lá rộng' }, { value: 'needleleaved', label: 'Lá kim' }, { value: 'mixed', label: 'Hỗn hợp' }] }] },
  { id: 'leisure-park', group: 'landuse', label: 'Công viên', geometry: ['area'], matchTags: { leisure: 'park' }, fields: [commonName, { key: 'operator', label: 'Đơn vị quản lý', type: 'text' }, { key: 'opening_hours', label: 'Giờ mở cửa', type: 'text' }] },
  { id: 'building-generic', group: 'facility', label: 'Tòa nhà', geometry: ['area'], matchTags: { building: 'yes' }, fields: [commonName, { key: 'building:levels', label: 'Số tầng', type: 'number' }, { key: 'addr:housenumber', label: 'Số nhà', type: 'text' }, { key: 'addr:street', label: 'Đường', type: 'text' }] },
  { id: 'amenity-school', group: 'facility', label: 'Trường học', geometry: ['point', 'area'], matchTags: { amenity: 'school' }, fields: [commonName, { key: 'operator', label: 'Đơn vị quản lý', type: 'text' }, { key: 'phone', label: 'Điện thoại', type: 'text' }, { key: 'website', label: 'Trang web', type: 'text' }, { key: 'capacity', label: 'Sức chứa', type: 'number' }] },
  { id: 'boundary-administrative', group: 'boundary', label: 'Ranh giới hành chính', geometry: ['relation'], matchTags: { boundary: 'administrative', type: 'boundary' }, fields: [commonName, { key: 'admin_level', label: 'Cấp hành chính', type: 'select', required: true, options: [{ value: '4', label: 'Tỉnh / thành phố trực thuộc TW' }, { value: '6', label: 'Huyện / quận' }, { value: '8', label: 'Xã / phường / thị trấn' }] }] }
];

export function geometryForPreset(geometry: { type: string }, entityType: string): PresetGeometry {
  if (entityType === 'relation') return 'relation';
  if (geometry.type === 'Point') return 'point';
  if (geometry.type === 'Polygon') return 'area';
  return 'line';
}

export function presetForTags(tags: Tags, geometry?: PresetGeometry): Preset | undefined {
  return PRESETS
    .filter(preset => (!geometry || preset.geometry.includes(geometry)) && Object.entries(preset.matchTags).every(([key, value]) => tags[key] === value))
    .sort((left, right) => Object.keys(right.matchTags).length - Object.keys(left.matchTags).length)[0];
}

export function applyPreset(tags: Tags, previous: Preset | undefined, next: Preset): Tags {
  const result = { ...tags };
  if (previous) for (const [key, value] of Object.entries(previous.matchTags)) if (result[key] === value) delete result[key];
  return { ...result, ...next.matchTags };
}

export function presetValidationErrors(tags: Tags, preset: Preset | undefined): string[] {
  if (!preset) return [];
  return preset.fields.filter(field => field.required && !tags[field.key]?.trim()).map(field => `${preset.label}: cần nhập ${field.label}.`);
}
