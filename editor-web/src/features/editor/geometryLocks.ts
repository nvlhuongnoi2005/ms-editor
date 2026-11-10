import type { GraphFeature } from '../../types/osm';
import type { FeatureMutation } from './EditorStore';

export const EDITOR_LAYERS = { points: 'Điểm', lines: 'Đường', areas: 'Vùng', relations: 'Quan hệ' } as const;
export type EditorLayer = keyof typeof EDITOR_LAYERS;
export function geometryLayer(feature: GraphFeature): EditorLayer {
  if (feature.properties.tags.type === 'multipolygon' || feature.geometry.type === 'Polygon') return 'areas';
  if (feature.properties.entityType === 'relation') return 'relations';
  return feature.geometry.type === 'Point' ? 'points' : 'lines';
}

export function protectedGeometry(features: GraphFeature[], lockedKeys: readonly string[], lockedLayers: readonly EditorLayer[]): Set<string> {
  const byKey = new Map(features.map(feature => [`${feature.properties.entityType}/${feature.properties.entityId}`, feature]));
  const protectedKeys = new Set(lockedKeys);
  const visit = (key: string, seen: Set<string>) => {
    if (seen.has(key)) return; seen.add(key); protectedKeys.add(key);
    const feature = byKey.get(key);
    for (const id of feature?.properties.nodeIds ?? []) protectedKeys.add(`node/${id}`);
    for (const member of feature?.properties.members ?? []) visit(`${member.type}/${member.ref}`, seen);
  };
  const seen = new Set<string>();
  for (const feature of features) if (lockedLayers.includes(geometryLayer(feature))) protectedKeys.add(`${feature.properties.entityType}/${feature.properties.entityId}`);
  for (const key of [...protectedKeys]) visit(key, seen);
  return protectedKeys;
}

export function lockViolation(features: GraphFeature[], lockedKeys: readonly string[], lockedLayers: readonly EditorLayer[], mutations: FeatureMutation[]): boolean {
  const protectedKeys = protectedGeometry(features, lockedKeys, lockedLayers);
  return mutations.some(({ key, feature }) => protectedKeys.has(key) || Boolean(feature && lockedLayers.includes(geometryLayer(feature))));
}
