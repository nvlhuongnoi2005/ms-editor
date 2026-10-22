import type { Tags } from '../../types/osm';

export interface Preset {
  id: string;
  label: string;
  icon: 'water' | 'forest' | 'park' | 'building' | 'school';
  geometry: 'point' | 'line' | 'area';
  tags: Tags;
}

export const AREA_PRESETS: Preset[] = [
  { id: 'pond', label: 'Ao nước', icon: 'water', geometry: 'area', tags: { natural: 'water', water: 'pond' } },
  { id: 'lake', label: 'Hồ', icon: 'water', geometry: 'area', tags: { natural: 'water', water: 'lake' } },
  { id: 'river', label: 'Sông / luồng nước', icon: 'water', geometry: 'area', tags: { natural: 'water', water: 'river' } },
  { id: 'forest', label: 'Rừng', icon: 'forest', geometry: 'area', tags: { landuse: 'forest' } },
  { id: 'park', label: 'Công viên', icon: 'park', geometry: 'area', tags: { leisure: 'park' } },
  { id: 'building', label: 'Tòa nhà', icon: 'building', geometry: 'area', tags: { building: 'yes' } },
  { id: 'school', label: 'Trường học', icon: 'school', geometry: 'area', tags: { amenity: 'school' } }
];
