import { readFile } from 'node:fs/promises';
import { transformWithOxc } from 'vite';

// Execute the actual source modules with the existing build transformer.
// No extra framework or emitted test files are required.
export async function loadSource(relative, replacements = {}) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  let { code } = await transformWithOxc(source, relative);
  for (const [specifier, target] of Object.entries(replacements)) code = code.replaceAll(`'${specifier}'`, JSON.stringify(target)).replaceAll(`"${specifier}"`, JSON.stringify(target));
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
