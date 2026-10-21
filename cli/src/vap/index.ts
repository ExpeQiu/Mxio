import { VIRTUAL_APPS, appsForExample } from '../../../AppS/web/registry.ts';
import type { VirtualAppManifest } from '../../../AppS/web/types.ts';
import { loadEnv } from '../env.js';
import { logInfo, logWarn } from '../output.js';

export function vapList(): VirtualAppManifest[] {
  return VIRTUAL_APPS.map((a) => ({ ...a }));
}

export function vapShow(id: string): VirtualAppManifest | undefined {
  return VIRTUAL_APPS.find((a) => a.id === id);
}

export function vapForExample(exampleId: string): VirtualAppManifest[] {
  return appsForExample(exampleId);
}

export interface VapHealth {
  ok: boolean;
  status?: string;
  mock?: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function vapHealth(opts: { demo: boolean }): Promise<VapHealth> {
  if (opts.demo || loadEnv(opts.demo).mock) {
    logInfo('vap.health', { data_source: 'demo' });
    return { ok: true, status: 'ok', mock: true, model: 'mock', stt: 'mock' };
  }
  const env = loadEnv();
  const url = `${env.apiUrl.replace(/\/$/, '')}/api/vap/health`;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2000);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { raw: text.slice(0, 240) };
    }
    const ok = res.ok && (body.status === 'ok' || body.mock !== undefined);
    logInfo('vap.health', { url, status: res.status, ok });
    return { ok, ...body };
  } catch (err) {
    logWarn('vap.health', { url, error: String((err as Error).message) });
    return { ok: false, error: String((err as Error).message) };
  }
}
