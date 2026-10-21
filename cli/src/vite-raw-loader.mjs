/**
 * Node ESM loader: Vite `?raw` imports become `export default "<file text>"`.
 * Lets the CLI load the full example gallery, including retro-intel `.c?raw`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  const q = specifier.indexOf('?raw');
  if (q === -1) return nextResolve(specifier, context);
  const clean = specifier.slice(0, q);
  const resolved = await nextResolve(clean, context);
  return { ...resolved, url: `${resolved.url}?raw` };
}

export async function load(url, context, nextLoad) {
  if (!url.includes('?raw')) return nextLoad(url, context);
  const fileUrl = url.replace(/\?raw$/, '').replace(/\?raw&/, '?');
  const source = readFileSync(fileURLToPath(fileUrl), 'utf8');
  return {
    format: 'module',
    shortCircuit: true,
    source: `export default ${JSON.stringify(source)};\n`,
  };
}
