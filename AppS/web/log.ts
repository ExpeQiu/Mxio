export type VapLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface VapLogFields {
  app_id?: string;
  turn_id?: number;
  state?: string;
  mock?: boolean;
  example_id?: string | null;
  [key: string]: unknown;
}

function sink(level: VapLogLevel, msg: string, fields: VapLogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    app_id: fields.app_id ?? 'vap-chat',
    ...fields,
  });
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  fn(line);
}

export const vapLog = {
  debug: (msg: string, fields: VapLogFields = {}) => sink('debug', msg, fields),
  info: (msg: string, fields: VapLogFields = {}) => sink('info', msg, fields),
  warn: (msg: string, fields: VapLogFields = {}) => sink('warn', msg, fields),
  error: (msg: string, fields: VapLogFields = {}) => sink('error', msg, fields),
};
