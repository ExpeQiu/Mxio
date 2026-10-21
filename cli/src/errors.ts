import {
  EXIT_FAIL,
  EXIT_UNAVAILABLE,
  envelope,
  type DataSource,
  type Envelope,
} from './output.js';

export type ErrorCode =
  | 'UNKNOWN_COMMAND'
  | 'MISSING_ARGUMENT'
  | 'INVALID_FORMAT'
  | 'INVALID_JSON'
  | 'INVALID_VLX'
  | 'VALIDATION_FAILED'
  | 'FILE_NOT_FOUND'
  | 'FILE_EXISTS'
  | 'BOARD_NOT_FOUND'
  | 'UNKNOWN_BOARD_KIND'
  | 'INVALID_COORDINATE'
  | 'DANGLING_ENDPOINT'
  | 'UNKNOWN_PIN'
  | 'DUPLICATE_ID'
  | 'DUPLICATE_WIRE_ID'
  | 'WIRE_EXISTS'
  | 'CONFLICT'
  | 'WRITE_FAILED'
  | 'INVALID_ASSERT'
  | 'PROBE_NOT_FOUND'
  | 'UNIT_MISMATCH'
  | 'COMPILE_ERROR'
  | 'CONNECTION_REFUSED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'USAGE'
  | 'UNKNOWN_PART'
  | 'HYPHEN_ID'
  | 'NOT_FOUND'
  | 'AUTH'
  | 'DEVICE_BUSY'
  | 'BOUNDARY'
  | 'ASSERT_FAILED';

export class CliError extends Error {
  readonly error_code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly exitCode: number;

  constructor(
    error_code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    exitCode: number = EXIT_FAIL,
  ) {
    super(message);
    this.name = 'CliError';
    this.error_code = error_code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

export function isCliError(err: unknown): err is CliError {
  return err instanceof CliError;
}

export function mapErrno(err: unknown): CliError | null {
  const e = err as NodeJS.ErrnoException & { name?: string };
  if (!e) return null;
  if (e.code === 'ENOENT') {
    return new CliError('FILE_NOT_FOUND', `文件不存在: ${e.path ?? e.message}`, {
      path: e.path,
    });
  }
  if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND') {
    return new CliError(
      'CONNECTION_REFUSED',
      e.message,
      { code: e.code },
      EXIT_UNAVAILABLE,
    );
  }
  if (e.name === 'AbortError' || e.code === 'ABORT_ERR' || /timeout|aborted/i.test(e.message ?? '')) {
    return new CliError('TIMEOUT', e.message || '请求超时', { code: e.code }, EXIT_UNAVAILABLE);
  }
  return null;
}

export function toCliError(err: unknown): CliError {
  if (isCliError(err)) return err;
  const mapped = mapErrno(err);
  if (mapped) return mapped;
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(msg)) {
    return new CliError('CONNECTION_REFUSED', msg, undefined, EXIT_UNAVAILABLE);
  }
  if (/timeout|aborted/i.test(msg)) {
    return new CliError('TIMEOUT', msg, undefined, EXIT_UNAVAILABLE);
  }
  return new CliError('USAGE', msg);
}

export function errorEnvelope(
  module: string,
  err: unknown,
  dataSource: DataSource = 'live',
): { exit: number; body: Envelope } {
  const c = toCliError(err);
  return {
    exit: c.exitCode,
    body: envelope(
      module,
      {
        ok: false,
        error_code: c.error_code,
        message: c.message,
        error: c.message,
        ...(c.details ? { details: c.details } : {}),
      },
      dataSource,
    ),
  };
}

export function commanderToCliError(err: unknown, stderrText = ''): CliError {
  const e = err as { code?: string; message?: string };
  const msg = (e.message || stderrText || String(err)).trim();
  switch (e.code) {
    case 'commander.unknownCommand':
      return new CliError('UNKNOWN_COMMAND', msg || '未知命令');
    case 'commander.missingArgument':
    case 'commander.missingMandatoryOptionValue':
      return new CliError('MISSING_ARGUMENT', msg || '缺少参数');
    case 'commander.invalidArgument':
    case 'commander.invalidOptionArgument':
      return new CliError(
        /format/i.test(msg) ? 'INVALID_FORMAT' : 'USAGE',
        msg || '无效参数',
      );
    default:
      return new CliError('USAGE', msg || '用法错误');
  }
}
