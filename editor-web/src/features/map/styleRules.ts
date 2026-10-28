import styleRulesJson from './style-rules.json';
import type { EntityType, GraphFeature, Tags } from '../../types/osm';

export interface FeatureDisplayStyle {
  color: string;
  width: number;
}

export type PointIconName = 'generic' | 'hotel' | 'school' | 'hospital' | 'shop' | 'food' | 'fuel' | 'bus' | 'tree' | 'atm' | 'landmark';

type TagMatch = Record<string, string | string[]>;

interface StyleRule {
  id: string;
  entityType?: EntityType;
  match?: TagMatch;
  style: FeatureDisplayStyle;
}

interface PointIconRule {
  match: TagMatch;
  icon: string;
}

interface StyleRulesConfig {
  defaults: {
    line: FeatureDisplayStyle;
    area: FeatureDisplayStyle;
    relation: FeatureDisplayStyle;
    pointIcon: string;
  };
  rules: StyleRule[];
  pointIcons: PointIconRule[];
}

// JSON imports infer each object's optional keys separately; the file is the
// single, validated-at-build configuration source for this module.
const styleRules = styleRulesJson as unknown as StyleRulesConfig;

function matchesTags(tags: Tags, match: TagMatch | undefined) {
  if (!match) return true;
  return Object.entries(match).every(([key, expected]) => {
    const actual = tags[key];
    if (!actual) return false;
    const values = Array.isArray(expected) ? expected : [expected];
    return values.includes('*') || values.includes(actual);
  });
}

function matchesFeature(rule: StyleRule, feature: GraphFeature) {
  return (!rule.entityType || rule.entityType === feature.properties.entityType) && matchesTags(feature.properties.tags, rule.match);
}

// Rules are ordered by specificity in style-rules.json.  The first match wins.
export function resolveFeatureStyle(feature: GraphFeature): FeatureDisplayStyle {
  const rule = styleRules.rules.find(item => matchesFeature(item, feature));
  if (rule) return rule.style;
  if (feature.properties.entityType === 'relation') return styleRules.defaults.relation;
  return feature.geometry.type === 'Polygon' ? styleRules.defaults.area : styleRules.defaults.line;
}

export function resolvePointIcon(tags: Tags): PointIconName {
  const icon = styleRules.pointIcons.find(rule => matchesTags(tags, rule.match))?.icon ?? styleRules.defaults.pointIcon;
  const knownIcons: PointIconName[] = ['generic', 'hotel', 'school', 'hospital', 'shop', 'food', 'fuel', 'bus', 'tree', 'atm', 'landmark'];
  return knownIcons.includes(icon as PointIconName) ? icon as PointIconName : 'generic';
}
