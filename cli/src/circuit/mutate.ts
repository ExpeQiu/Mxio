import type { VlxPayload } from '../../../frontend/src/utils/vlxCore.ts';
import { findPart } from '../catalog/index.js';
import { CliError } from '../errors.js';
import { pinAllowedOnBoard, pinAllowedOnPart } from './validate.js';

function requireFiniteCoord(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) {
    throw new CliError('INVALID_COORDINATE', `${label} 必须是有限数值`, { value });
  }
  return value;
}

export function addComponent(
  payload: VlxPayload,
  opts: { part: string; id: string; x?: number; y?: number },
): VlxPayload {
  const part = findPart(opts.part);
  if (!part) throw new CliError('UNKNOWN_PART', `未知元件: ${opts.part}`, { part: opts.part });
  if (opts.id.includes('-')) {
    throw new CliError('HYPHEN_ID', `元件 id 不能含连字符（ngspice 会截断）: ${opts.id}`, {
      id: opts.id,
    });
  }
  if (payload.components.some((c) => c.id === opts.id) || payload.boards.some((b) => b.id === opts.id)) {
    throw new CliError('DUPLICATE_ID', `id 已存在: ${opts.id}`, { id: opts.id });
  }
  payload.components.push({
    id: opts.id,
    metadataId: part.id,
    x: requireFiniteCoord(opts.x, 'x') ?? 200,
    y: requireFiniteCoord(opts.y, 'y') ?? 80,
    properties: { ...(part.defaultValues ?? {}) },
  });
  return payload;
}

function parseEndpoint(spec: string): { componentId: string; pinName: string } {
  const idx = spec.lastIndexOf(':');
  if (idx < 1) throw new CliError('USAGE', `接线格式应为 id:PIN，收到 ${spec}`, { spec });
  return { componentId: spec.slice(0, idx), pinName: spec.slice(idx + 1) };
}

function assertEndpoint(
  payload: VlxPayload,
  ep: { componentId: string; pinName: string },
  spec: string,
): void {
  const board = payload.boards.find((b) => b.id === ep.componentId);
  if (board) {
    if (!pinAllowedOnBoard(board.boardKind, ep.pinName)) {
      throw new CliError('UNKNOWN_PIN', `板 ${board.id} 无引脚 ${ep.pinName}`, {
        componentId: ep.componentId,
        pinName: ep.pinName,
        spec,
      });
    }
    return;
  }
  const comp = payload.components.find((c) => c.id === ep.componentId);
  if (!comp) {
    throw new CliError('DANGLING_ENDPOINT', `端点不存在: ${spec}`, {
      componentId: ep.componentId,
      pinName: ep.pinName,
    });
  }
  const { ok } = pinAllowedOnPart(comp.metadataId, ep.pinName);
  if (!ok) {
    throw new CliError('UNKNOWN_PIN', `${comp.id} (${comp.metadataId}) 无引脚 ${ep.pinName}`, {
      componentId: ep.componentId,
      pinName: ep.pinName,
      metadataId: comp.metadataId,
    });
  }
}

function sameEndpoint(
  ep: { componentId: string; pinName: string },
  spec: { componentId: string; pinName: string },
): boolean {
  return ep.componentId === spec.componentId && ep.pinName === spec.pinName;
}

export function addWire(
  payload: VlxPayload,
  opts: { from: string; to: string; id?: string; color?: string; allowParallel?: boolean },
): VlxPayload {
  const start = parseEndpoint(opts.from);
  const end = parseEndpoint(opts.to);
  assertEndpoint(payload, start, opts.from);
  assertEndpoint(payload, end, opts.to);
  const id = opts.id ?? `w_${start.componentId}_${start.pinName}_${end.componentId}_${end.pinName}`.replace(
    /[^a-zA-Z0-9_]/g,
    '_',
  );
  const existing = payload.wires.find(
    (w) =>
      (sameEndpoint(w.start, start) && sameEndpoint(w.end, end)) ||
      (sameEndpoint(w.start, end) && sameEndpoint(w.end, start)),
  );
  if (existing && !opts.allowParallel) {
    throw new CliError('WIRE_EXISTS', `接线已存在: ${opts.from} ↔ ${opts.to}`, {
      existing_id: existing.id,
      from: opts.from,
      to: opts.to,
    });
  }
  if (payload.wires.some((w) => w.id === id)) {
    throw new CliError('DUPLICATE_WIRE_ID', `导线 id 已存在: ${id}`, { id });
  }
  payload.wires.push({
    id,
    start: { ...start, x: 0, y: 0 },
    end: { ...end, x: 0, y: 0 },
    color: opts.color ?? '#888888',
    waypoints: [],
  });
  return payload;
}

export function resolveBoard(payload: VlxPayload, boardId?: string) {
  if (boardId) {
    const board = payload.boards.find((b) => b.id === boardId);
    if (!board) {
      throw new CliError('BOARD_NOT_FOUND', `板卡不存在: ${boardId}`, { board: boardId });
    }
    return board;
  }
  const board =
    payload.boards.find((b) => b.id === payload.activeBoardId) ?? payload.boards[0];
  if (!board) throw new CliError('BOARD_NOT_FOUND', '工程没有板卡');
  return board;
}

export function setCodeFile(
  payload: VlxPayload,
  opts: { file: string; content: string; boardId?: string },
): VlxPayload {
  const board = resolveBoard(payload, opts.boardId);
  const gid = board.activeFileGroupId;
  const files = payload.fileGroups[gid] ?? [];
  const idx = files.findIndex((f) => f.name === opts.file);
  if (idx >= 0) files[idx] = { name: opts.file, content: opts.content };
  else files.push({ name: opts.file, content: opts.content });
  payload.fileGroups[gid] = files;
  return payload;
}

export function listCircuit(payload: VlxPayload): {
  boards: Array<{ id: string; boardKind: string }>;
  components: Array<{ id: string; metadataId: string; x: number; y: number }>;
  wires: Array<{ id: string; from: string; to: string }>;
} {
  return {
    boards: payload.boards.map((b) => ({ id: b.id, boardKind: b.boardKind })),
    components: payload.components.map((c) => ({
      id: c.id,
      metadataId: c.metadataId,
      x: c.x,
      y: c.y,
    })),
    wires: payload.wires.map((w) => ({
      id: w.id,
      from: `${w.start.componentId}:${w.start.pinName}`,
      to: `${w.end.componentId}:${w.end.pinName}`,
    })),
  };
}

export function removeComponent(payload: VlxPayload, id: string): VlxPayload {
  if (payload.boards.some((b) => b.id === id)) {
    throw new CliError('USAGE', `不能删除板卡 ${id}`, { id });
  }
  const before = payload.components.length;
  payload.components = payload.components.filter((c) => c.id !== id);
  if (payload.components.length === before) {
    throw new CliError('NOT_FOUND', `未找到元件 ${id}`, { id });
  }
  payload.wires = payload.wires.filter(
    (w) => w.start.componentId !== id && w.end.componentId !== id,
  );
  return payload;
}

export function removeWire(
  payload: VlxPayload,
  opts: { id?: string; from?: string; to?: string },
): VlxPayload {
  if (opts.id) {
    const before = payload.wires.length;
    payload.wires = payload.wires.filter((w) => w.id !== opts.id);
    if (payload.wires.length === before) {
      throw new CliError('NOT_FOUND', `未找到导线 ${opts.id}`, { id: opts.id });
    }
    return payload;
  }
  if (!opts.from || !opts.to) {
    throw new CliError('MISSING_ARGUMENT', '需要 --id 或同时给出 --from 与 --to');
  }
  const a = parseEndpoint(opts.from);
  const b = parseEndpoint(opts.to);
  const before = payload.wires.length;
  payload.wires = payload.wires.filter(
    (w) =>
      !(
        (sameEndpoint(w.start, a) && sameEndpoint(w.end, b)) ||
        (sameEndpoint(w.start, b) && sameEndpoint(w.end, a))
      ),
  );
  if (payload.wires.length === before) {
    throw new CliError('NOT_FOUND', `未找到导线 ${opts.from} → ${opts.to}`, {
      from: opts.from,
      to: opts.to,
    });
  }
  return payload;
}

export function listCodeFiles(
  payload: VlxPayload,
  boardId?: string,
): Array<{ name: string; bytes: number }> {
  const board = resolveBoard(payload, boardId);
  const files = payload.fileGroups[board.activeFileGroupId] ?? [];
  return files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.content, 'utf8') }));
}

export function getCodeFile(
  payload: VlxPayload,
  file: string,
  boardId?: string,
): { name: string; content: string } {
  const board = resolveBoard(payload, boardId);
  const files = payload.fileGroups[board.activeFileGroupId] ?? [];
  const hit = files.find((f) => f.name === file);
  if (!hit) throw new CliError('NOT_FOUND', `未找到源文件 ${file}`, { file, board: board.id });
  return hit;
}
