import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import presets from '@openstreetmap/id-tagging-schema/dist/presets.json' with { type: 'json' };
import fields from '@openstreetmap/id-tagging-schema/dist/fields.json' with { type: 'json' };
import vietnamese from '@openstreetmap/id-tagging-schema/dist/translations/vi.json' with { type: 'json' };
import english from '@openstreetmap/id-tagging-schema/dist/translations/en.json' with { type: 'json' };

const schemaVersion = '7.3.0';
const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/features/editor/id-presets.generated.json');
const translations = vietnamese.vi?.presets ?? {};
const englishTranslations = english.en?.presets ?? {};

function fieldLabel(id, field) {
  return translations.fields?.[id]?.label
    ?? englishTranslations.fields?.[id]?.label
    ?? field.label
    ?? field.key
    ?? id.replaceAll('/', ':').replaceAll('_', ' ');
}

function optionLabel(id, value) {
  return translations.fields?.[id]?.options?.[value]
    ?? englishTranslations.fields?.[id]?.options?.[value]
    ?? value;
}

function groupFor(tags) {
  if (tags.waterway) return 'waterway';
  if (tags.natural === 'water' || tags.water) return 'water-area';
  if (tags.highway || tags.railway || tags.aeroway || tags.aerialway || tags.public_transport) return 'transport';
  if (tags.shop || tags.craft) return 'commerce';
  if (tags.tourism && ['hotel', 'motel', 'guest_house', 'hostel', 'apartment', 'camp_site', 'caravan_site', 'wilderness_hut'].includes(tags.tourism)) return 'accommodation';
  if (tags.amenity && ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'biergarten', 'food_court', 'ice_cream'].includes(tags.amenity)) return 'food';
  if (tags.amenity && ['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy', 'bank', 'atm', 'post_office', 'police', 'fire_station', 'townhall', 'library', 'school', 'kindergarten', 'college', 'university', 'social_facility', 'courthouse', 'embassy'].includes(tags.amenity)) return 'public-service';
  if (tags.healthcare) return 'public-service';
  if (tags.amenity || tags.building || tags.man_made || tags.tourism) return 'facility';
  if (tags.landuse || tags.natural || tags.leisure) return 'landuse';
  if (tags.boundary || tags.type === 'multipolygon' || tags.type === 'boundary' || tags.type === 'route') return 'boundary';
  return undefined;
}

function supportedGeometry(geometry) {
  const supported = geometry.filter(item => ['point', 'line', 'area', 'relation'].includes(item));
  return [...new Set(supported)];
}

function fieldDefinitions(fieldIDs) {
  const result = [];
  const seen = new Set();
  for (const id of fieldIDs) {
    const field = fields[id];
    if (!field) continue;
    const keys = field.type === 'address'
      ? ['addr:housenumber', 'addr:street', 'addr:city', 'addr:postcode'].filter(key => field.keys?.includes(key))
      : field.key ? [field.key] : [];
    for (const key of keys) {
      if (!key || key.includes('*') || key.endsWith(':') || seen.has(key)) continue;
      seen.add(key);
      const options = Array.isArray(field.options) && field.options.length > 0 && field.options.length <= 40
        ? field.options.map(value => ({ value, label: optionLabel(id, value) }))
        : undefined;
      let type = 'text';
      if (field.type === 'number') type = 'number';
      else if (field.type === 'check' || field.type === 'checkbox') type = 'yesno';
      else if (['combo', 'select', 'radio', 'structureRadio'].includes(field.type) && options) type = 'select';
      result.push({
        key,
        label: key === field.key ? fieldLabel(id, field) : key.replace('addr:', 'Địa chỉ: '),
        type,
        ...(type === 'yesno' ? { options: [{ value: 'yes', label: 'Có' }, { value: 'no', label: 'Không' }] } : {}),
        ...(type === 'select' ? { options } : {})
      });
      if (result.length === 12) return result;
    }
  }
  return result;
}

const generatedPresets = Object.entries(presets)
  .map(([id, preset]) => {
    if (id.startsWith('@') || preset.searchable === false || !preset.tags) return undefined;
    if (Object.values(preset.tags).some(value => typeof value !== 'string' || value === '*' || value.startsWith('@'))) return undefined;
    const group = groupFor(preset.tags);
    const geometry = supportedGeometry(preset.geometry ?? []);
    if (!group || geometry.length === 0) return undefined;
    const label = translations.presets?.[id]?.name ?? englishTranslations.presets?.[id]?.name ?? id.split('/').at(-1)?.replaceAll('_', ' ') ?? id;
    return {
      id: `id-${id.replaceAll('/', '-')}`,
      sourceId: id,
      group,
      label,
      geometry,
      matchTags: preset.tags,
      addTags: preset.addTags ?? preset.tags,
      fields: fieldDefinitions(preset.fields ?? [])
    };
  })
  .filter(Boolean)
  .sort((left, right) => left.group.localeCompare(right.group) || left.label.localeCompare(right.label, 'vi'))
  .filter((preset, index, all) => all.findIndex(candidate => (
    candidate.geometry.join(',') === preset.geometry.join(',')
    && JSON.stringify(candidate.matchTags) === JSON.stringify(preset.matchTags)
  )) === index);

const output = {
  source: 'OpenStreetMap iD Tagging Schema',
  sourceURL: 'https://github.com/openstreetmap/id-tagging-schema',
  license: 'ISC',
  version: schemaVersion,
  presets: generatedPresets
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`, 'utf8');
console.log(`Generated ${generatedPresets.length} presets from iD Tagging Schema ${schemaVersion}.`);
