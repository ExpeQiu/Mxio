export type CenterLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface CenterLogFields {
  example_id?: string | null;
  view_mode?: string;
  columns?: string;
  firmware_open?: boolean;
  [key: string]: unknown;
}

function sink(level: CenterLogLevel, msg: string, fields: CenterLogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    module: 'center',
    ...fields,
  });
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  fn(line);
}

export const centerLog = {
  debug: (msg: string, fields: CenterLogFields = {}) => sink('debug', msg, fields),
  info: (msg: string, fields: CenterLogFields = {}) => sink('info', msg, fields),
  warn: (msg: string, fields: CenterLogFields = {}) => sink('warn', msg, fields),
  error: (msg: string, fields: CenterLogFields = {}) => sink('error', msg, fields),
};
