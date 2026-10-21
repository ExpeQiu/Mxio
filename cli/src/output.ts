import { CLI_VERSION } from './paths.js';

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_UNAVAILABLE = 2;
export const PROTOCOL_VERSION = 1;

export type DataSource = 'live' | 'demo';

export interface Envelope {
  module: string;
  version: string;
  protocol: number;
  data_source: DataSource;
  fetched_at: string;
  ok?: boolean;
  items?: unknown[];
  warnings?: string[];
  error?: string;
  error_code?: string;
  message?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

let verbose = false;

export function setVerbose(on: boolean): void {
  verbose = on;
}

export function isVerbose(): boolean {
  return verbose;
}

export function envelope(
  module: string,
  extra: Record<string, unknown>,
  dataSource: DataSource = 'live',
): Envelope {
  return {
    module,
    version: CLI_VERSION,
    protocol: PROTOCOL_VERSION,
    data_source: dataSource,
    fetched_at: new Date().toISOString(),
    ...extra,
  };
}

export function printJson(body: Envelope): void {
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
}

export function printTable(rows: Array<Record<string, unknown>>, keys: string[]): void {
  if (rows.length === 0) {
    process.stdout.write('(empty)\n');
    return;
  }
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)),
  );
  const line = (vals: string[]) =>
    vals.map((v, i) => v.padEnd(widths[i]!)).join('  ');
  process.stdout.write(`${line(keys)}\n`);
  process.stdout.write(`${line(widths.map((w) => '-'.repeat(w)))}\n`);
  for (const row of rows) {
    process.stdout.write(`${line(keys.map((k) => String(row[k] ?? '')))}\n`);
  }
}

export function logInfo(msg: string, extra?: Record<string, unknown>): void {
  if (!verbose) return;
  const rec = { ts: new Date().toISOString(), level: 'info', msg, ...extra };
  process.stderr.write(`${JSON.stringify(rec)}\n`);
}

export function logWarn(msg: string, extra?: Record<string, unknown>): void {
  const rec = { ts: new Date().toISOString(), level: 'warn', msg, ...extra };
  process.stderr.write(`${JSON.stringify(rec)}\n`);
}

export function die(code: number, body: Envelope): never {
  printJson(body);
  process.exit(code);
}
