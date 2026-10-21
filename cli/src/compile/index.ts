import { isPiBoardKind, BOARD_KIND_FQBN } from '../../../frontend/src/types/board.ts';
import type { VlxPayload } from '../../../frontend/src/utils/vlxCore.ts';
import { CliError } from '../errors.js';
import { EXIT_UNAVAILABLE } from '../output.js';
import { loadEnv } from '../env.js';

export interface CompileResult {
  status: 'ok' | 'ready' | 'error';
  reason?: string;
  error_code?: string;
  board?: string;
  fqbn?: string | null;
  hex_content?: string;
  binary_content?: string;
  firmware_b64?: string;
  detail?: string;
}

function classifyCompileFailure(msg: string): CliError {
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|ECONNRESET/i.test(msg)) {
    return new CliError('CONNECTION_REFUSED', msg, undefined, EXIT_UNAVAILABLE);
  }
  if (/timeout|aborted/i.test(msg)) {
    return new CliError('TIMEOUT', msg, undefined, EXIT_UNAVAILABLE);
  }
  return new CliError('COMPILE_ERROR', msg);
}

export async function compileProject(
  payload: VlxPayload,
  opts: { demo: boolean; apiUrl?: string; timeoutMs?: number },
): Promise<CompileResult> {
  const board =
    payload.boards.find((b) => b.id === payload.activeBoardId) ?? payload.boards[0];
  if (!board) {
    return { status: 'error', reason: 'no board in project', error_code: 'BOARD_NOT_FOUND' };
  }
  const kind = board.boardKind;
  if (isPiBoardKind(kind)) {
    return {
      status: 'ready',
      reason: 'no compilation needed',
      board: board.id,
      fqbn: null,
    };
  }
  const fqbn = BOARD_KIND_FQBN[kind as keyof typeof BOARD_KIND_FQBN] ?? null;
  const env = loadEnv(opts.demo);
  if (opts.demo || env.mock) {
    return {
      status: 'ok',
      reason: 'demo',
      board: board.id,
      fqbn,
      hex_content: ':00000001FF',
      firmware_b64: 'ZGVtbw==',
    };
  }
  if (!fqbn) {
    return { status: 'error', reason: `board ${kind} has no FQBN`, board: board.id, error_code: 'USAGE' };
  }
  const files = payload.fileGroups[board.activeFileGroupId] ?? [];
  if (files.length === 0) {
    return { status: 'error', reason: 'no source files', board: board.id, error_code: 'COMPILE_ERROR' };
  }
  const apiUrl = (opts.apiUrl ?? env.apiUrl).replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/compile/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: files.map((f) => ({ name: f.name, content: f.content })),
        board_fqbn: fqbn,
        board_kind: kind,
        initiated_by: 'agent',
      }),
      signal: ac.signal,
    });
  } catch (err) {
    throw classifyCompileFailure((err as Error).message);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    const unavailable = res.status >= 500 || res.status === 404;
    return {
      status: 'error',
      reason: `compile HTTP ${res.status}`,
      error_code: unavailable ? 'UNAVAILABLE' : 'COMPILE_ERROR',
      board: board.id,
      fqbn,
      detail: text.slice(0, 800),
    };
  }
  let json: { success?: boolean; hex_content?: string; binary_content?: string; error?: string };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return { status: 'error', reason: 'invalid compile JSON', error_code: 'COMPILE_ERROR', detail: text.slice(0, 400) };
  }
  if (json.success === false || json.error) {
    return {
      status: 'error',
      reason: json.error ?? 'compile failed',
      error_code: 'COMPILE_ERROR',
      board: board.id,
      fqbn,
    };
  }
  if (!json.hex_content && !json.binary_content) {
    return {
      status: 'error',
      reason: 'compile response missing firmware',
      error_code: 'COMPILE_ERROR',
      board: board.id,
      fqbn,
    };
  }
  return {
    status: 'ok',
    board: board.id,
    fqbn,
    hex_content: json.hex_content,
    binary_content: json.binary_content,
    firmware_b64: json.binary_content ?? json.hex_content,
  };
}
