export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_UNAVAILABLE = 2;

export const DM_VERSION = '0.1.0';

export type DataSource = 'live' | 'demo';

export interface Envelope {
  module: string;
  version: string;
  data_source: DataSource;
  fetched_at: string;
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export function envelope(
  module: string,
  extra: Record<string, unknown>,
  dataSource: DataSource = 'demo',
): Envelope {
  return {
    module,
    version: DM_VERSION,
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
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i]!)).join('  ');
  process.stdout.write(`${line(keys)}\n`);
  process.stdout.write(`${line(widths.map((w) => '-'.repeat(w)))}\n`);
  for (const row of rows) {
    process.stdout.write(`${line(keys.map((k) => String(row[k] ?? '')))}\n`);
  }
}

export function die(code: number, body: Envelope): never {
  printJson(body);
  process.exit(code);
}
