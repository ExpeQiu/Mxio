import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_VERSION = '0.1.0';

export function cliRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

/** velxio repo root (contains frontend/public/components-metadata.json). */
export function repoRoot(): string {
  let dir = cliRoot();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'frontend', 'public', 'components-metadata.json'))) {
      return dir;
    }
    dir = join(dir, '..');
  }
  return join(cliRoot(), '..');
}

export function metadataPath(): string {
  return join(repoRoot(), 'frontend', 'public', 'components-metadata.json');
}
