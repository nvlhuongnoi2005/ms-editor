// Compress once during the build, rather than spending CPU on every request.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compress(path);
    else if (/\.(?:html|js|mjs|css|json|svg)$/.test(entry.name)) {
      const original = await readFile(path);
      const compressed = gzipSync(original, { level: 9 });
      if (compressed.length < original.length) await writeFile(`${path}.gz`, compressed);
    }
  }
}

await compress(fileURLToPath(new URL('../dist/', import.meta.url)));
