import manifest from '../manifest.json';

/** Evidence and implementation status, never an ECDIS conformity assertion. */
export const presentationLibrary = manifest;
export type PresentationSettings = {
  safetyDepth: number;
  safetyContour: number;
  shallowContour: number;
  deepContour: number;
  shades: 2 | 4;
  category: 'base' | 'standard' | 'other';
  names: boolean;
  soundings: boolean;
  quality: boolean;
};
export const defaultPresentationSettings: PresentationSettings = {
  safetyDepth: 6, safetyContour: 6, shallowContour: 3, deepContour: 30,
  shades: 4, category: 'other', names: true, soundings: true, quality: true,
};
export function validatePresentationSettings(value: unknown): PresentationSettings {
  const s = value as PresentationSettings;
  if (!s || !['safetyDepth','safetyContour','shallowContour','deepContour'].every(key => typeof s[key as keyof PresentationSettings] === 'number' && Number.isFinite(s[key as keyof PresentationSettings]) && Number(s[key as keyof PresentationSettings]) >= 0 && Number(s[key as keyof PresentationSettings]) <= 12000)
    || s.shallowContour > s.safetyContour || s.safetyContour > s.deepContour
    || ![2,4].includes(s.shades) || !['base','standard','other'].includes(s.category)
    || !['names','soundings','quality'].every(key => typeof s[key as keyof PresentationSettings] === 'boolean')) {
    throw new Error('Ngưỡng độ sâu phải từ 0 đến 12000 m; đường đồng sâu nông ≤ an toàn ≤ sâu.');
  }
  return { ...s };
}

export function readPresentationSettings(storage?: Pick<Storage, 'getItem'>): PresentationSettings {
  try {
    const stored = storage?.getItem('enc:presentation-settings:v1');
    return stored ? validatePresentationSettings(JSON.parse(stored)) : { ...defaultPresentationSettings };
  } catch { return { ...defaultPresentationSettings }; }
}
