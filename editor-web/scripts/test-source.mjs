import { readFile } from 'node:fs/promises';
import { transformWithOxc } from 'vite';

// Execute the actual source modules with the existing build transformer.
// No extra framework or emitted test files are required.
export async function loadSource(relative, replacements = {}) {
  let url = new URL(relative, import.meta.url);
  let source = await readFile(url, 'utf8');
  const forwarded = source.match(/^export \* from ['"]([^'"]+)['"];?$/m);
  if (forwarded && source.replace(/\/\/[^\n]*/g, '').trim().startsWith('export *')) {
    url = new URL(forwarded[1] + '.ts', url);
    source = await readFile(url, 'utf8');
  }
  let { code } = await transformWithOxc(source, relative);
  for (const [specifier, target] of Object.entries(replacements)) code = code.replaceAll(`'${specifier}'`, JSON.stringify(target)).replaceAll(`"${specifier}"`, JSON.stringify(target));
  // Resolve canonical library modules outside editor-web as well as JSON tables.
  for (const match of [...code.matchAll(/(?:import|export)[^;]*?\bfrom\s*['"]([^'"]+)['"]/g)]) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;
    const assetImport=specifier.endsWith('?url');
    const target = new URL(assetImport ? specifier.slice(0,-4) : specifier + (/\.(ts|tsx|mjs|json)$/.test(specifier) ? '' : '.ts'), url);
    const resolved = assetImport
      ? `data:text/javascript;base64,${Buffer.from('export default '+JSON.stringify(target.href)).toString('base64')}`
      : target.pathname.endsWith('.json')
      ? `data:text/javascript;base64,${Buffer.from('export default ' + await readFile(target, 'utf8')).toString('base64')}`
      : await loadSource(target.href);
    code = code.replaceAll(`'${specifier}'`, JSON.stringify(resolved)).replaceAll(`"${specifier}"`, JSON.stringify(resolved));
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
