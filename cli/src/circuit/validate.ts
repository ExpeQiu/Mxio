import { BOARD_PIN_GROUPS } from '../../../frontend/src/simulation/spice/boardPinGroups.ts';
import { boardPinToNumber } from '../../../frontend/src/utils/boardPinMapping.ts';
import type { BoardKind } from '../../../frontend/src/types/board.ts';
import type { VlxPayload } from '../../../frontend/src/utils/vlxCore.ts';
import { findPart, pinsForMetadataId } from '../catalog/index.js';

export interface ValidateIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

const ASCII_MINUS = '-';
const UNICODE_MINUS = '−';

export function normalizePinName(name: string): string {
  return name === ASCII_MINUS ? UNICODE_MINUS : name;
}

function boardKnownPins(kind: string): Set<string> {
  const group = BOARD_PIN_GROUPS[kind as BoardKind] ?? BOARD_PIN_GROUPS.default;
  const set = new Set<string>([...group.gnd, ...group.vcc_pins, ...(group.aux?.pins ?? [])]);
  return set;
}

export function pinAllowedOnBoard(kind: string, pinName: string): boolean {
  const known = boardKnownPins(kind);
  if (known.has(pinName) || known.has(normalizePinName(pinName))) return true;
  const n = boardPinToNumber(kind, pinName);
  if (n === -1) return true; // power pin recognised
  return n != null && n >= 0;
}

export function pinAllowedOnPart(metadataId: string, pinName: string): { ok: boolean; known: boolean } {
  const pins = pinsForMetadataId(metadataId);
  if (!pins || pins.length === 0) return { ok: true, known: false };
  const norm = normalizePinName(pinName);
  const ok = pins.some((p) => p === pinName || p === norm || normalizePinName(p) === norm);
  return { ok, known: true };
}

export function validateProject(payload: VlxPayload): {
  ok: boolean;
  issues: ValidateIssue[];
} {
  const issues: ValidateIssue[] = [];
  const ids = new Set<string>();

  for (const b of payload.boards) {
    if (ids.has(b.id)) {
      issues.push({ severity: 'error', code: 'duplicate-id', message: `重复 id: ${b.id}` });
    }
    ids.add(b.id);
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      issues.push({
        severity: 'error',
        code: 'invalid-coordinate',
        message: `板 ${b.id} 坐标无效`,
      });
    }
    if (!payload.fileGroups[b.activeFileGroupId]) {
      issues.push({
        severity: 'error',
        code: 'missing-file-group',
        message: `板 ${b.id} 引用缺失文件组 ${b.activeFileGroupId}`,
      });
    }
  }
  if (payload.activeBoardId && !payload.boards.some((b) => b.id === payload.activeBoardId)) {
    issues.push({
      severity: 'error',
      code: 'unknown-active-board',
      message: `活动板不存在: ${payload.activeBoardId}`,
    });
  }

  for (const c of payload.components) {
    if (ids.has(c.id)) {
      issues.push({ severity: 'error', code: 'duplicate-id', message: `重复 id: ${c.id}` });
    }
    ids.add(c.id);
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) {
      issues.push({
        severity: 'error',
        code: 'invalid-coordinate',
        message: `元件 ${c.id} 坐标无效`,
      });
    }
    if (c.id.includes('-')) {
      issues.push({
        severity: 'error',
        code: 'hyphen-id',
        message: `元件 id 含连字符会截断 ngspice 名: ${c.id}`,
      });
    }
    const part = findPart(c.metadataId);
    if (!part && !pinsForMetadataId(c.metadataId)) {
      issues.push({
        severity: 'warning',
        code: 'unknown-part',
        message: `未知元件 ${c.metadataId} (id=${c.id})`,
      });
    }
  }

  const wireIds = new Set<string>();
  for (const w of payload.wires) {
    if (!w.id) {
      issues.push({ severity: 'error', code: 'missing-wire-id', message: '导线缺少 id' });
    } else if (wireIds.has(w.id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate-wire-id',
        message: `重复导线 id: ${w.id}`,
      });
    } else {
      wireIds.add(w.id);
    }
    for (const ep of [w.start, w.end]) {
      if (!ids.has(ep.componentId)) {
        issues.push({
          severity: 'error',
          code: 'dangling-wire',
          message: `导线 ${w.id} 指向不存在的 ${ep.componentId}:${ep.pinName}`,
        });
        continue;
      }
      const board = payload.boards.find((b) => b.id === ep.componentId);
      if (board) {
        if (!pinAllowedOnBoard(board.boardKind, ep.pinName)) {
          issues.push({
            severity: 'error',
            code: 'unknown-board-pin',
            message: `板 ${board.id} 无引脚 ${ep.pinName}`,
          });
        }
        continue;
      }
      const comp = payload.components.find((c) => c.id === ep.componentId);
      if (comp) {
        const { ok, known } = pinAllowedOnPart(comp.metadataId, ep.pinName);
        if (!ok) {
          issues.push({
            severity: 'error',
            code: 'unknown-part-pin',
            message: `${comp.id} (${comp.metadataId}) 无引脚 ${ep.pinName}`,
          });
        } else if (!known) {
          issues.push({
            severity: 'warning',
            code: 'unverified-pin',
            message: `${comp.id} 的引脚 ${ep.pinName} 未在元数据中列出，已放行`,
          });
        }
      }
    }
  }

  const ok = !issues.some((i) => i.severity === 'error');
  return { ok, issues };
}
