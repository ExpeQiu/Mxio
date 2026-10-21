import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cliRoot, repoRoot } from './paths.js';

export interface CliEnv {
  apiUrl: string;
  mock: boolean;
  bootImagesDir: string | undefined;
}

function parseDotenv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

let fileCached: Record<string, string> | null = null;

export function loadFileEnv(): Record<string, string> {
  if (fileCached) return fileCached;
  fileCached = {
    ...parseDotenv(join(repoRoot(), '.env')),
    ...parseDotenv(join(cliRoot(), '.env')),
  };
  return fileCached;
}

export function resetEnvCache(): void {
  fileCached = null;
}

export function loadEnv(demoFlag?: boolean): CliEnv {
  const file = loadFileEnv();
  const mockEnv =
    process.env.VELXIO_MOCK_MODE ?? process.env.AI_MOCK_MODE ?? file.VELXIO_MOCK_MODE ?? 'false';
  return {
    apiUrl: process.env.VELXIO_API_URL ?? file.VELXIO_API_URL ?? 'http://127.0.0.1:8001',
    mock: demoFlag === true || mockEnv === 'true' || mockEnv === '1',
    bootImagesDir: process.env.VELXIO_BOOT_IMAGES_LOCAL_DIR ?? file.VELXIO_BOOT_IMAGES_LOCAL_DIR,
  };
}
