import { CliError } from './errors.js';
import { loadFileEnv } from './env.js';
import type { DataSource } from './output.js';

export interface CliConfig {
  format: 'json' | 'table';
  demo: boolean;
  mock: boolean;
  verbose: boolean;
  apiUrl: string;
  timeoutMs: number;
  force: boolean;
  dryRun: boolean;
  probe: boolean;
  dataSource: DataSource;
}

export interface CliFlags {
  format?: string;
  demo?: boolean;
  verbose?: boolean;
  apiUrl?: string;
  timeout?: string;
  force?: boolean;
  dryRun?: boolean;
  probe?: boolean;
}

const DEFAULT_API = 'http://127.0.0.1:8001';
const DEFAULT_TIMEOUT_MS = 30_000;

export function parseDurationMs(raw: string): number {
  const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
  if (!m) {
    throw new CliError('INVALID_FORMAT', `无效超时: ${raw}（期望 1500、30s、2m）`);
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) {
    throw new CliError('INVALID_FORMAT', `无效超时: ${raw}`);
  }
  const unit = (m[2] ?? 'ms').toLowerCase();
  if (unit === 's') return Math.round(n * 1000);
  if (unit === 'm') return Math.round(n * 60_000);
  return Math.round(n);
}

function envMock(file: Record<string, string>): boolean {
  const mockEnv =
    process.env.VELXIO_MOCK_MODE ?? process.env.AI_MOCK_MODE ?? file.VELXIO_MOCK_MODE ?? 'false';
  return mockEnv === 'true' || mockEnv === '1';
}

/** CLI 参数 > 环境变量 > .env > 默认。 */
export function resolveConfig(flags: CliFlags = {}): CliConfig {
  const file = loadFileEnv();
  const format = flags.format ?? 'json';
  if (format !== 'json' && format !== 'table') {
    throw new CliError('INVALID_FORMAT', `--format 只接受 json 或 table，收到 ${format}`);
  }
  const demo = flags.demo === true;
  const mock = demo || envMock(file);
  const timeoutRaw =
    flags.timeout ?? process.env.VELXIO_TIMEOUT ?? file.VELXIO_TIMEOUT ?? String(DEFAULT_TIMEOUT_MS);
  const apiUrl =
    flags.apiUrl ?? process.env.VELXIO_API_URL ?? file.VELXIO_API_URL ?? DEFAULT_API;
  if (typeof apiUrl !== 'string' || !/^https?:\/\//i.test(apiUrl)) {
    throw new CliError('INVALID_FORMAT', `无效 --api-url: ${apiUrl}`);
  }
  return {
    format,
    demo,
    mock,
    verbose: flags.verbose === true,
    apiUrl: apiUrl.replace(/\/$/, ''),
    timeoutMs: parseDurationMs(String(timeoutRaw)),
    force: flags.force === true,
    dryRun: flags.dryRun === true,
    probe: flags.probe === true,
    dataSource: mock ? 'demo' : 'live',
  };
}

export function peekArgvFlags(argv = process.argv): CliFlags {
  const flags: CliFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--demo') flags.demo = true;
    else if (a === '--verbose') flags.verbose = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--probe') flags.probe = true;
    else if (a === '--format' && argv[i + 1]) flags.format = argv[++i];
    else if (a.startsWith('--format=')) flags.format = a.slice('--format='.length);
    else if (a === '--api-url' && argv[i + 1]) flags.apiUrl = argv[++i];
    else if (a.startsWith('--api-url=')) flags.apiUrl = a.slice('--api-url='.length);
    else if (a === '--timeout' && argv[i + 1]) flags.timeout = argv[++i];
    else if (a.startsWith('--timeout=')) flags.timeout = a.slice('--timeout='.length);
  }
  return flags;
}
