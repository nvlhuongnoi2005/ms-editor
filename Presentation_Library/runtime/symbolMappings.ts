import { pointSprites, areaSprites, linePointSprites, lineSprites, patternSprites } from './sprites';

// Reverse the renderer's output branches, never infer a class from an image's
// prefix: HRBFAC can select SMCFAC02 and several classes share the same image.
export function symbolOutputs(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  const start = value[0] === 'case' ? 2 : value[0] === 'match' ? 3 : -1;
  if (start < 0) throw new Error(`Unsupported symbol selector: ${value[0]}`);
  const outputs = symbolOutputs(value[value.length - 1]);
  for (let index = start; index < value.length - 1; index += 2) outputs.push(...symbolOutputs(value[index]));
  return [...new Set(outputs)].sort();
}

export const symbolRegistries = { point:pointSprites, area:areaSprites, lineAnchor:linePointSprites, line:lineSprites, pattern:patternSprites };
const reverse = new Map<string, Set<string>>();
for (const registry of Object.values(symbolRegistries)) for (const [objectClass, selector] of Object.entries(registry)) {
  for (const symbol of symbolOutputs(selector)) {
    const classes = reverse.get(symbol) ?? new Set<string>();
    classes.add(objectClass); reverse.set(symbol, classes);
  }
}
// Line textures are selected in infrastructure.ts, outside SY/AP registries.
for (const [symbol, classes] of Object.entries({
  LC_CBLSUB06:['CBLSUB'], LC_LOWACC21:['SLCONS'], LC_PIPSOL05:['PIPSOL'], LC_PIPSOL06:['PIPSOL'],
})) reverse.set(symbol, new Set([...(reverse.get(symbol) ?? []), ...classes]));
export const symbolClasses: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  [...reverse].map(([symbol, classes]) => [symbol, [...classes].sort()]),
);
