import spriteAtlas from '../assets/sprites/day_simplified@2x.json';
import descriptions from './symbolDescriptions.vi.json';
import { symbolClasses } from './symbolMappings';

export const encSymbols = Object.entries(spriteAtlas).sort(([a], [b]) => a.localeCompare(b)).map(([code, sprite]) => {
  const description = (descriptions as Record<string,string>)[code] ?? 'Chưa có giải thích cho ký hiệu này.';
  return {code,description,sprite,classes:symbolClasses[code] ?? []};
});

export function searchEncSymbols(query: string) {
  const words = normalizeSymbolSearch(query).split(/\s+/).filter(Boolean);
  return encSymbols.filter(symbol => {
    const text = normalizeSymbolSearch(`${symbol.code} ${symbol.description} ${symbol.classes.join(' ')}`);
    return words.every(word => text.includes(word));
  });
}

// Tìm tiếng Việt không phân biệt dấu để có thể gõ nhanh, ví dụ "phao" hay "do sau".
export function normalizeSymbolSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
}
