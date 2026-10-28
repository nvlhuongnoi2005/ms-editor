import type { Tags } from '../../types/osm';
import idSchema from './id-presets.generated.json';
import catalogueUiJson from './catalogue-ui.json';

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
  addTags?: Tags;
  fields: PresetField[];
  sourceId?: string;
}

export interface PresetGroup {
  id: string;
  label: string;
}

interface CatalogueUiConfig {
  featuredPresetIds: string[];
  hiddenPresetIds: string[];
  aliases: Record<string, string[]>;
  defaultResultLimit: number;
  loadMoreStep: number;
}

export const CATALOGUE_UI = catalogueUiJson as CatalogueUiConfig;

const commonName: PresetField = { key: 'name', label: 'Tên', type: 'text', placeholder: 'Tên phổ biến hoặc chính thức' };
const yesNo: Array<{ value: string; label: string }> = [{ value: 'yes', label: 'Có' }, { value: 'no', label: 'Không' }];
const roadSurface = [{ value: 'asphalt', label: 'Nhựa' }, { value: 'concrete', label: 'Bê tông' }, { value: 'paved', label: 'Đã trải mặt' }, { value: 'unpaved', label: 'Chưa trải mặt' }];
const contactFields: PresetField[] = [{ key: 'phone', label: 'Điện thoại', type: 'text' }, { key: 'website', label: 'Trang web', type: 'text' }, { key: 'opening_hours', label: 'Giờ mở cửa', type: 'text' }];
const addressFields: PresetField[] = [{ key: 'addr:housenumber', label: 'Số nhà', type: 'text' }, { key: 'addr:street', label: 'Đường', type: 'text' }];
const poiFields: PresetField[] = [commonName, ...contactFields, ...addressFields];

export const PRESET_GROUPS: PresetGroup[] = [
  { id: 'waterway', label: 'Đường nước' },
  { id: 'water-area', label: 'Vùng nước' },
  { id: 'transport', label: 'Giao thông' },
  { id: 'landuse', label: 'Sử dụng đất & tự nhiên' },
  { id: 'food', label: 'Ăn uống' },
  { id: 'accommodation', label: 'Lưu trú' },
  { id: 'commerce', label: 'Mua sắm' },
  { id: 'public-service', label: 'Dịch vụ công cộng' },
  { id: 'facility', label: 'Công trình & tiện ích' },
  { id: 'boundary', label: 'Ranh giới & quan hệ' }
];

const LOCAL_PRESETS: Preset[] = [
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
  { id: 'amenity-restaurant', group: 'food', label: 'Nhà hàng', geometry: ['point', 'area'], matchTags: { amenity: 'restaurant' }, fields: [commonName, { key: 'cuisine', label: 'Ẩm thực', type: 'text', placeholder: 'vietnamese, asian…' }, { key: 'takeaway', label: 'Bán mang đi', type: 'yesno', options: yesNo }, { key: 'delivery', label: 'Giao hàng', type: 'yesno', options: yesNo }, ...contactFields, ...addressFields] },
  { id: 'amenity-cafe', group: 'food', label: 'Quán cà phê', geometry: ['point', 'area'], matchTags: { amenity: 'cafe' }, fields: [commonName, { key: 'cuisine', label: 'Loại phục vụ', type: 'text', placeholder: 'coffee, tea…' }, { key: 'outdoor_seating', label: 'Chỗ ngồi ngoài trời', type: 'yesno', options: yesNo }, ...contactFields, ...addressFields] },
  { id: 'amenity-fast-food', group: 'food', label: 'Quán ăn nhanh', geometry: ['point', 'area'], matchTags: { amenity: 'fast_food' }, fields: [commonName, { key: 'cuisine', label: 'Ẩm thực', type: 'text' }, { key: 'takeaway', label: 'Bán mang đi', type: 'yesno', options: yesNo }, ...contactFields, ...addressFields] },
  { id: 'tourism-hotel', group: 'accommodation', label: 'Khách sạn', geometry: ['point', 'area'], matchTags: { tourism: 'hotel' }, fields: [commonName, { key: 'stars', label: 'Số sao', type: 'number', placeholder: '1–5' }, { key: 'rooms', label: 'Số phòng', type: 'number' }, { key: 'checkin', label: 'Giờ nhận phòng', type: 'text' }, { key: 'checkout', label: 'Giờ trả phòng', type: 'text' }, ...contactFields, ...addressFields] },
  { id: 'tourism-guest-house', group: 'accommodation', label: 'Nhà khách', geometry: ['point', 'area'], matchTags: { tourism: 'guest_house' }, fields: [commonName, { key: 'rooms', label: 'Số phòng', type: 'number' }, ...contactFields, ...addressFields] },
  { id: 'tourism-hostel', group: 'accommodation', label: 'Nhà trọ / Hostel', geometry: ['point', 'area'], matchTags: { tourism: 'hostel' }, fields: [commonName, { key: 'rooms', label: 'Số phòng', type: 'number' }, ...contactFields, ...addressFields] },
  { id: 'shop-convenience', group: 'commerce', label: 'Cửa hàng tiện lợi', geometry: ['point', 'area'], matchTags: { shop: 'convenience' }, fields: poiFields },
  { id: 'shop-supermarket', group: 'commerce', label: 'Siêu thị', geometry: ['point', 'area'], matchTags: { shop: 'supermarket' }, fields: [commonName, { key: 'brand', label: 'Thương hiệu', type: 'text' }, ...contactFields, ...addressFields] },
  { id: 'shop-clothes', group: 'commerce', label: 'Cửa hàng quần áo', geometry: ['point', 'area'], matchTags: { shop: 'clothes' }, fields: [commonName, { key: 'brand', label: 'Thương hiệu', type: 'text' }, ...contactFields, ...addressFields] },
  { id: 'shop-pharmacy', group: 'commerce', label: 'Nhà thuốc', geometry: ['point', 'area'], matchTags: { shop: 'pharmacy' }, fields: [commonName, { key: 'dispensing', label: 'Có bán thuốc theo đơn', type: 'yesno', options: yesNo }, ...contactFields, ...addressFields] },
  { id: 'amenity-hospital', group: 'public-service', label: 'Bệnh viện', geometry: ['point', 'area'], matchTags: { amenity: 'hospital' }, fields: [commonName, { key: 'emergency', label: 'Cấp cứu', type: 'yesno', options: yesNo }, { key: 'operator', label: 'Đơn vị quản lý', type: 'text' }, ...contactFields, ...addressFields] },
  { id: 'amenity-clinic', group: 'public-service', label: 'Phòng khám', geometry: ['point', 'area'], matchTags: { amenity: 'clinic' }, fields: poiFields },
  { id: 'amenity-bank', group: 'public-service', label: 'Ngân hàng', geometry: ['point', 'area'], matchTags: { amenity: 'bank' }, fields: [commonName, { key: 'atm', label: 'Có ATM', type: 'yesno', options: yesNo }, ...contactFields, ...addressFields] },
  { id: 'amenity-atm', group: 'public-service', label: 'Cây ATM', geometry: ['point'], matchTags: { amenity: 'atm' }, fields: [commonName, { key: 'operator', label: 'Đơn vị vận hành', type: 'text' }, { key: 'brand', label: 'Thương hiệu / ngân hàng', type: 'text' }, { key: 'cash_in', label: 'Nộp tiền mặt', type: 'yesno', options: yesNo }, { key: 'opening_hours', label: 'Giờ hoạt động', type: 'text' }, ...addressFields] },
  { id: 'amenity-post-office', group: 'public-service', label: 'Bưu điện', geometry: ['point', 'area'], matchTags: { amenity: 'post_office' }, fields: poiFields },
  { id: 'amenity-police', group: 'public-service', label: 'Công an', geometry: ['point', 'area'], matchTags: { amenity: 'police' }, fields: poiFields },
  { id: 'amenity-fire-station', group: 'public-service', label: 'Trạm cứu hỏa', geometry: ['point', 'area'], matchTags: { amenity: 'fire_station' }, fields: poiFields },
  { id: 'amenity-toilets', group: 'facility', label: 'Nhà vệ sinh công cộng', geometry: ['point', 'area'], matchTags: { amenity: 'toilets' }, fields: [commonName, { key: 'fee', label: 'Thu phí', type: 'yesno', options: yesNo }, { key: 'wheelchair', label: 'Tiếp cận xe lăn', type: 'yesno', options: yesNo }, { key: 'opening_hours', label: 'Giờ mở cửa', type: 'text' }] },
  { id: 'amenity-parking', group: 'transport', label: 'Bãi đỗ xe', geometry: ['point', 'area'], matchTags: { amenity: 'parking' }, fields: [commonName, { key: 'capacity', label: 'Sức chứa', type: 'number' }, { key: 'fee', label: 'Thu phí', type: 'yesno', options: yesNo }, ...addressFields] },
  { id: 'highway-bus-stop', group: 'transport', label: 'Điểm dừng xe buýt', geometry: ['point'], matchTags: { highway: 'bus_stop' }, fields: [commonName, { key: 'operator', label: 'Đơn vị vận hành', type: 'text' }, { key: 'network', label: 'Mạng lưới', type: 'text' }, { key: 'shelter', label: 'Có mái che', type: 'yesno', options: yesNo }] },
  { id: 'amenity-bus-station', group: 'transport', label: 'Bến xe buýt', geometry: ['point', 'area'], matchTags: { amenity: 'bus_station' }, fields: [commonName, { key: 'operator', label: 'Đơn vị vận hành', type: 'text' }, ...contactFields, ...addressFields] },
  { id: 'leisure-playground', group: 'facility', label: 'Sân chơi', geometry: ['point', 'area'], matchTags: { leisure: 'playground' }, fields: [commonName, { key: 'access', label: 'Quyền tiếp cận', type: 'select', options: [{ value: 'yes', label: 'Công cộng' }, { value: 'permissive', label: 'Được phép' }, { value: 'private', label: 'Riêng tư' }] }] },
  { id: 'natural-tree', group: 'landuse', label: 'Cây đơn lẻ', geometry: ['point'], matchTags: { natural: 'tree' }, fields: [commonName, { key: 'genus', label: 'Chi thực vật', type: 'text' }, { key: 'species', label: 'Loài', type: 'text' }, { key: 'height', label: 'Chiều cao', type: 'number', placeholder: 'Mét' }] },
  { id: 'boundary-administrative', group: 'boundary', label: 'Ranh giới hành chính', geometry: ['relation'], matchTags: { boundary: 'administrative', type: 'boundary' }, fields: [commonName, { key: 'admin_level', label: 'Cấp hành chính', type: 'select', required: true, options: [{ value: '4', label: 'Tỉnh / thành phố trực thuộc TW' }, { value: '6', label: 'Huyện / quận' }, { value: '8', label: 'Xã / phường / thị trấn' }] }] }
];

interface GeneratedSchemaField {
  key: string;
  label: string;
  type: string;
  options?: Array<{ value: string; label: string }>;
}

interface GeneratedSchemaPreset {
  id: string;
  sourceId: string;
  group: string;
  label: string;
  geometry: string[];
  matchTags: Tags;
  addTags: Tags;
  fields: GeneratedSchemaField[];
}

const ID_SCHEMA_PRESETS: Preset[] = (idSchema.presets as GeneratedSchemaPreset[]).map((preset): Preset => ({
  id: preset.id,
  sourceId: preset.sourceId,
  group: preset.group,
  label: preset.label,
  geometry: preset.geometry as PresetGeometry[],
  matchTags: preset.matchTags,
  addTags: preset.addTags,
  fields: preset.fields.map((field: GeneratedSchemaField) => ({
    key: field.key,
    label: field.label,
    type: field.type as PresetFieldType,
    options: field.options
  }))
}));

function samePresetTags(left: Tags, right: Tags) {
  const leftEntries = Object.entries(left);
  return leftEntries.length === Object.keys(right).length && leftEntries.every(([key, value]) => right[key] === value);
}

// Local presets retain their Vietnamese wording and project-specific fields.
// The generated iD catalogue fills the remaining OSM feature types.
export const PRESETS: Preset[] = [
  ...LOCAL_PRESETS,
  ...ID_SCHEMA_PRESETS.filter(schemaPreset => !LOCAL_PRESETS.some(localPreset => samePresetTags(localPreset.matchTags, schemaPreset.matchTags)))
].filter(preset => !CATALOGUE_UI.hiddenPresetIds.includes(preset.id));

export function searchPresets(presets: Preset[], query: string): Preset[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('vi');
  const matches = !normalizedQuery
    ? presets
    : presets.filter(preset => {
      const aliases = CATALOGUE_UI.aliases[preset.id] ?? [];
      const searchable = [
        preset.label,
        preset.id,
        preset.sourceId ?? '',
        ...aliases,
        ...Object.entries(preset.matchTags).map(([key, value]) => `${key}=${value}`)
      ];
      return searchable.some(value => value.toLocaleLowerCase('vi').includes(normalizedQuery));
    });
  return [...matches].sort((left, right) => {
    const leftFeatured = CATALOGUE_UI.featuredPresetIds.indexOf(left.id);
    const rightFeatured = CATALOGUE_UI.featuredPresetIds.indexOf(right.id);
    const leftRank = leftFeatured < 0 ? Number.MAX_SAFE_INTEGER : leftFeatured;
    const rightRank = rightFeatured < 0 ? Number.MAX_SAFE_INTEGER : rightFeatured;
    return leftRank - rightRank || left.label.localeCompare(right.label, 'vi');
  });
}

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
  return { ...result, ...(next.addTags ?? next.matchTags) };
}

export function presetValidationErrors(tags: Tags, preset: Preset | undefined): string[] {
  if (!preset) return [];
  return preset.fields.filter(field => field.required && !tags[field.key]?.trim()).map(field => `${preset.label}: cần nhập ${field.label}.`);
}
