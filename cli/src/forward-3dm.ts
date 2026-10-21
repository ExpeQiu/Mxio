import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './paths.js';
import { EXIT_FAIL, EXIT_UNAVAILABLE, die, envelope, logInfo } from './output.js';

export function forward3dm(opts: { demo?: boolean; format?: string; dataSource: 'live' | 'demo' }): never {
  const bin = join(repoRoot(), '3Dm', 'bin', '3dm');
  if (!existsSync(bin)) {
    die(
      EXIT_UNAVAILABLE,
      envelope('3dm', { ok: false, error: `未找到 ${bin}，先 cd 3Dm && npm install` }, opts.dataSource),
    );
  }
  const idx = process.argv.findIndex((a) => a === '3dm');
  const rest = idx >= 0 ? process.argv.slice(idx + 1) : [];
  const prefix: string[] = [];
  if (opts.demo && !rest.includes('--demo')) prefix.push('--demo');
  const hasFormat = rest.some((a, i) => a === '--format' || rest[i - 1] === '--format');
  if (opts.format && !hasFormat) prefix.push('--format', opts.format);
  const args = [...prefix, ...rest];
  logInfo('3dm.forward', { bin, args });
  const r = spawnSync(bin, args, { stdio: 'inherit' });
  if (r.error) {
    die(
      EXIT_UNAVAILABLE,
      envelope('3dm', { ok: false, error: String(r.error.message) }, opts.dataSource),
    );
  }
  process.exit(r.status ?? EXIT_FAIL);
}
