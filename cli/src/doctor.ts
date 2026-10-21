import { spawnSync } from 'node:child_process';
import { loadEnv } from './env.js';
import { logInfo, logWarn } from './output.js';

export interface DoctorCheck {
  id: string;
  ok: boolean;
  detail?: string;
}

async function probe(url: string, timeoutMs = 1500): Promise<{ ok: boolean; detail: string }> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    const text = (await res.text()).slice(0, 240);
    return { ok: res.ok, detail: `${res.status} ${text}`.trim() };
  } catch (err) {
    return { ok: false, detail: String((err as Error).message ?? err) };
  }
}

function arduinoCli(): DoctorCheck {
  const r = spawnSync('arduino-cli', ['version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    return { id: 'arduino-cli', ok: false, detail: r.error?.message ?? (r.stderr || 'not found').trim() };
  }
  return { id: 'arduino-cli', ok: true, detail: (r.stdout || '').trim().split('\n')[0] };
}

function esp32Core(): DoctorCheck {
  const r = spawnSync('arduino-cli', ['core', 'list'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    return { id: 'esp32-core', ok: false, detail: 'arduino-cli core list failed' };
  }
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const ok = /esp32:esp32/.test(out);
  return { id: 'esp32-core', ok, detail: ok ? 'esp32:esp32' : 'not installed' };
}

const CHECK_IDS = ['frontend', 'motion', 'backend', 'vap', 'arduino-cli', 'esp32-core'] as const;

export async function runDoctor(opts: {
  demo: boolean;
  probe?: boolean;
  apiUrl?: string;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  mode: 'offline' | 'probe';
  checks: DoctorCheck[];
  requiredFailed: string[];
}> {
  const env = loadEnv(opts.demo);
  const mock = opts.demo || env.mock;
  if (mock && !opts.probe) {
    const checks = CHECK_IDS.map((id) => ({ id, ok: true, detail: 'offline' }));
    logInfo('doctor', { mode: 'offline', demo: true });
    return { ok: true, mode: 'offline', checks, requiredFailed: [] };
  }

  const api = (opts.apiUrl ?? env.apiUrl).replace(/\/$/, '');
  const timeoutMs = Math.min(opts.timeoutMs ?? 1500, 5000);
  const frontend = await probe('http://127.0.0.1:5173/', timeoutMs);
  const motion = await probe('http://127.0.0.1:5174/', timeoutMs);
  const backend = await probe(`${api}/health`, timeoutMs);
  const vap = await probe(`${api}/api/vap/health`, timeoutMs);
  const cli = arduinoCli();
  const core = esp32Core();
  const checks: DoctorCheck[] = [
    { id: 'frontend', ok: frontend.ok, detail: frontend.detail },
    { id: 'motion', ok: motion.ok, detail: motion.detail },
    { id: 'backend', ok: backend.ok, detail: backend.detail },
    { id: 'vap', ok: vap.ok, detail: vap.detail },
    cli,
    core,
  ];
  logInfo('doctor', {
    mode: 'probe',
    demo: opts.demo,
    api,
    ok_ids: checks.filter((c) => c.ok).map((c) => c.id),
  });
  for (const c of checks.filter((x) => !x.ok)) {
    logWarn('doctor.check', { id: c.id, detail: c.detail });
  }
  const required = mock ? [] : ['backend', 'vap'];
  const requiredFailed = checks.filter((c) => required.includes(c.id) && !c.ok).map((c) => c.id);
  return {
    ok: requiredFailed.length === 0,
    mode: 'probe',
    checks,
    requiredFailed,
  };
}
