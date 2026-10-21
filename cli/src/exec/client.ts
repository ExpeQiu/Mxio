import { isPiBoardKind, BOARD_KIND_FQBN } from '../../../frontend/src/types/board.ts';
import type { VlxPayload } from '../../../frontend/src/utils/vlxCore.ts';
import type { CliConfig } from '../config.js';
import { CliError } from '../errors.js';
import { loadEnv } from '../env.js';
import { EXIT_UNAVAILABLE } from '../output.js';

export type ExecTarget = 'sim' | 'esp32' | 'pi' | 'jtag';

export interface ExecRequest {
  target: ExecTarget;
  files: Array<{ name: string; content: string }>;
  board: string;
  duration_s?: number;
  expect?: string[];
  port?: string;
  baud?: number;
  serial_input?: string;
  host?: string;
  user?: string;
  identity?: string;
  remote_dir?: string;
  start_cmd?: string;
  action?: string;
}

export function judgeLogs(logs: string, expect: string[]): Array<{ pattern: string; passed: boolean }> {
  return expect.map((pattern) => {
    if (pattern.startsWith('re:')) {
      try {
        return { pattern, passed: new RegExp(pattern.slice(3)).test(logs) };
      } catch {
        return { pattern, passed: false };
      }
    }
    return { pattern, passed: logs.includes(pattern) };
  });
}

/** 与 runner._demo 同一判断：字面期望写进日志，re: 仍走真实匹配。 */
export function demoExec(req: ExecRequest): Record<string, unknown> {
  if (req.target === 'jtag') {
    return {
      success: false,
      status: 'failed',
      target: req.target,
      simulation_ready: false,
      logs: '',
      assertions: [],
      exit_code: null,
      error: 'JTAG/GDB 深度调试尚未实现',
      error_code: 'UNSUPPORTED',
      engine: 'jtag',
    };
  }
  const expect = req.expect ?? [];
  const logs = ['velxio hwexec demo', ...expect.filter((item) => !item.startsWith('re:'))].join('\n') + '\n';
  const assertions = judgeLogs(logs, expect);
  const success = expect.length === 0 || assertions.every((item) => item.passed);
  return {
    success,
    status: success ? 'succeeded' : 'failed',
    target: req.target,
    simulation_ready: req.target === 'sim' && success,
    logs,
    assertions,
    exit_code: success ? 0 : 1,
    error: success ? null : '断言未通过',
    error_code: success ? null : 'ASSERT_FAILED',
    engine: 'demo',
  };
}

export function projectExecRequest(
  payload: VlxPayload,
  opts: Omit<ExecRequest, 'files' | 'board'> & { board?: string },
): ExecRequest {
  const board =
    payload.boards.find((item) => item.id === payload.activeBoardId) ?? payload.boards[0];
  if (!board) {
    throw new CliError('BOARD_NOT_FOUND', '工程里没有板');
  }
  const files = payload.fileGroups[board.activeFileGroupId] ?? [];
  const kind = board.boardKind;
  const fqbn = isPiBoardKind(kind)
    ? kind
    : (BOARD_KIND_FQBN[kind as keyof typeof BOARD_KIND_FQBN] ?? kind);
  return {
    ...opts,
    board: opts.board ?? fqbn ?? kind,
    files: files.map((file) => ({ name: file.name, content: file.content })),
  };
}

export async function liveExec(
  req: ExecRequest,
  opts: { apiUrl?: string; timeoutMs?: number; token?: string },
): Promise<Record<string, unknown>> {
  const env = loadEnv(false);
  const apiUrl = (opts.apiUrl ?? env.apiUrl).replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const token = opts.token ?? process.env.VELXIO_EXEC_TOKEN ?? '';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/exec/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        files: req.files,
        board: req.board,
        target: req.target,
        duration_s: req.duration_s ?? 5,
        expect: req.expect ?? [],
        port: req.port,
        baud: req.baud ?? 115200,
        serial_input: req.serial_input ?? '',
        pi:
          req.target === 'pi'
            ? {
                host: req.host,
                user: req.user ?? 'pi',
                identity: req.identity,
                remote_dir: req.remote_dir ?? '/tmp/velxio',
                start_cmd: req.start_cmd ?? '',
                action: req.action ?? 'cycle',
              }
            : null,
        demo: false,
      }),
      signal: ac.signal,
    });
  } catch (err) {
    const message = (err as Error).message;
    if (/aborted|timeout/i.test(message)) {
      throw new CliError('TIMEOUT', message, undefined, EXIT_UNAVAILABLE);
    }
    throw new CliError('CONNECTION_REFUSED', message, undefined, EXIT_UNAVAILABLE);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { error: text.slice(0, 800) };
  }
  if (json.detail && typeof json.detail === 'object') {
    return json.detail as Record<string, unknown>;
  }
  if (!res.ok && json.success === undefined) {
    return {
      success: false,
      status: 'failed',
      error: typeof json.detail === 'string' ? json.detail : `HTTP ${res.status}`,
      error_code: res.status === 401 ? 'AUTH' : res.status === 403 ? 'BOUNDARY' : 'UNAVAILABLE',
    };
  }
  return json;
}

export async function runExec(cfg: CliConfig, req: ExecRequest): Promise<Record<string, unknown>> {
  if (cfg.mock) return demoExec(req);
  return liveExec(req, { apiUrl: cfg.apiUrl, timeoutMs: Math.max(cfg.timeoutMs, 180_000) });
}
