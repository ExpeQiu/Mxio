export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  run_id?: string;
  mech_id?: string;
  kit_id?: string;
  joint_id?: string;
  component_id?: string;
  phase?: 'p0' | 'p1' | 'p2' | 'p3';
  [key: string]: unknown;
}

let runId = `3dm-${Date.now().toString(36)}`;

export function setRunId(id: string): void {
  runId = id;
}

export function getRunId(): string {
  return runId;
}

function sink(level: LogLevel, msg: string, fields: LogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    run_id: fields.run_id ?? runId,
    ...fields,
  });
  if (typeof process !== 'undefined' && process.stderr) {
    process.stderr.write(line + '\n');
    return;
  }
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  fn(line);
}

export const log = {
  debug: (msg: string, fields: LogFields = {}) => sink('debug', msg, fields),
  info: (msg: string, fields: LogFields = {}) => sink('info', msg, fields),
  warn: (msg: string, fields: LogFields = {}) => sink('warn', msg, fields),
  error: (msg: string, fields: LogFields = {}) => sink('error', msg, fields),
};
