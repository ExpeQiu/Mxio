import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOARD_PIN_GROUPS } from '../../../frontend/src/simulation/spice/boardPinGroups.ts';
import type { PinSourceState } from '../../../frontend/src/simulation/spice/types.ts';
import type { BoardKind } from '../../../frontend/src/types/board.ts';
import { isPiBoardKind } from '../../../frontend/src/types/board.ts';
import type { VlxPayload } from '../../../frontend/src/utils/vlxCore.ts';
import { logInfo } from '../output.js';
import { cliRoot } from '../paths.js';
import { CliError } from '../errors.js';

export interface DrivePin {
  pin: string;
  high: boolean;
}

export type CmpOp = '>' | '<' | '>=' | '<=';

export interface SpiceAssert {
  kind: 'current' | 'voltage';
  target: string;
  op: CmpOp;
  value: number;
  abs: boolean;
  unit: string;
}

export function parseDrive(spec: string): DrivePin[] {
  return spec
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^(?:gpio=|pin=)?([A-Za-z0-9_.]+):([01]|high|low)$/i);
      if (!m) throw new Error(`无效 --drive 项: ${p}（期望 gpio=17:1 或 D13:1）`);
      const level = m[2]!.toLowerCase();
      return { pin: m[1]!, high: level === '1' || level === 'high' };
    });
}

const VOLTAGE_UNITS = new Set(['v', 'mv', 'kv']);
const CURRENT_UNITS = new Set(['a', 'ma', 'ua']);

export function parseAssert(spec: string): SpiceAssert {
  const m = spec.trim().match(/^(abs:)?(current|voltage|i|v):(.+?)(>=|<=|>|<)(.+)$/i);
  if (!m) {
    throw new CliError(
      'INVALID_ASSERT',
      `无效 --assert: ${spec}（期望 current:m_fl>5mA、voltage:vm>-1.5V 或 abs:voltage:vm>2V）`,
      { spec },
    );
  }
  const abs = Boolean(m[1]);
  const kindRaw = m[2]!.toLowerCase();
  const kind: SpiceAssert['kind'] = kindRaw === 'v' || kindRaw === 'voltage' ? 'voltage' : 'current';
  const rawVal = m[5]!.trim();
  const um = rawVal.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(mA|uA|A|mV|kV|V)?$/i);
  if (!um) throw new CliError('INVALID_ASSERT', `无效 --assert 数值: ${spec}`, { spec });
  const n = Number(um[1]);
  if (!Number.isFinite(n)) throw new CliError('INVALID_ASSERT', `无效 --assert 数值: ${spec}`, { spec });
  const unitRaw = um[2] ?? (kind === 'voltage' ? 'V' : 'A');
  const unit = unitRaw.toLowerCase();
  if (kind === 'voltage' && !VOLTAGE_UNITS.has(unit)) {
    throw new CliError('UNIT_MISMATCH', `电压断言单位不匹配: ${spec}`, { spec, unit: unitRaw });
  }
  if (kind === 'current' && !CURRENT_UNITS.has(unit)) {
    throw new CliError('UNIT_MISMATCH', `电流断言单位不匹配: ${spec}`, { spec, unit: unitRaw });
  }
  let value = n;
  if (unit === 'ma') value = n / 1000;
  else if (unit === 'ua') value = n / 1e6;
  else if (unit === 'mv') value = n / 1000;
  else if (unit === 'kv') value = n * 1000;
  return { kind, target: m[3]!, op: m[4] as CmpOp, value, abs, unit: unitRaw };
}

function wiredPins(payload: VlxPayload, boardId: string): string[] {
  return payload.wires.flatMap((w) => {
    const names: string[] = [];
    if (w.start.componentId === boardId) names.push(w.start.pinName);
    if (w.end.componentId === boardId) names.push(w.end.pinName);
    return names;
  });
}

/** Map a drive token onto a silkscreen pin that exists on this board. */
export function resolveDrivePin(kind: string, token: string, wired: string[]): string {
  const exact = wired.find((p) => p.toLowerCase() === token.toLowerCase());
  if (exact) return exact;

  const gpioNum = token.match(/^(?:GPIO)?(\d+)$/i);
  if (gpioNum) {
    const n = gpioNum[1]!;
    const candidates = isPiBoardKind(kind)
      ? [`GPIO${n}`, n, `D${n}`]
      : [`D${n}`, n, `GPIO${n}`];
    for (const c of candidates) {
      const hit = wired.find((p) => p.toLowerCase() === c.toLowerCase());
      if (hit) return hit;
    }
    return isPiBoardKind(kind) ? `GPIO${n}` : `D${n}`;
  }

  return token;
}

function pinStatesForBoard(
  payload: VlxPayload,
  boardId: string,
  kind: string,
  drive: DrivePin[],
): Record<string, PinSourceState> {
  const group = BOARD_PIN_GROUPS[kind as BoardKind] ?? BOARD_PIN_GROUPS.default;
  const wired = wiredPins(payload, boardId);
  const pins: Record<string, PinSourceState> = {};
  for (const d of drive) {
    const name = resolveDrivePin(kind, d.pin, wired);
    pins[name] = { type: 'digital', v: d.high ? group.vcc : 0 };
  }
  return pins;
}

const DEFAULT_FIXTURE = join(cliRoot(), 'fixtures', 'spice-4wd-forward.json');

export function loadFixtureCurrents(path: string): Record<string, number> {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    currents?: Record<string, number>;
    voltages?: Record<string, number>;
  };
  return raw.currents ?? {};
}

export function loadFixtureVoltages(path: string): Record<string, number> {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { voltages?: Record<string, number> };
  return raw.voltages ?? {};
}

function cmp(op: CmpOp, left: number, right: number): boolean {
  switch (op) {
    case '>':
      return left > right;
    case '<':
      return left < right;
    case '>=':
      return left >= right;
    case '<=':
      return left <= right;
  }
}

export function evaluateAssertions(
  asserts: SpiceAssert[],
  currents: Record<string, number>,
  voltages: Record<string, number>,
  probes: Record<string, number>,
  pinNetMap: Record<string, string> = {},
): Array<{ spec: string; ok: boolean; actual: number | null; missing: boolean; abs: boolean }> {
  return asserts.map((a) => {
    const actual =
      a.kind === 'current'
        ? lookupCurrent(currents, a.target)
        : lookupVoltage(voltages, pinNetMap, a.target) ?? probes[a.target];
    const missing = typeof actual !== 'number' || !Number.isFinite(actual);
    const left = missing ? NaN : a.abs ? Math.abs(actual) : actual;
    const ok = !missing && cmp(a.op, left, a.value);
    return {
      spec: `${a.abs ? 'abs:' : ''}${a.kind}:${a.target}${a.op}${a.value}`,
      ok,
      actual: missing ? null : actual,
      missing,
      abs: a.abs,
    };
  });
}

function lookupCurrent(currents: Record<string, number>, target: string): number | undefined {
  const keys = [
    `v_${target}_sense`,
    target,
    target.toLowerCase(),
    `v_${target}`,
    `v_${target.toLowerCase()}_sense`,
  ];
  for (const k of keys) {
    if (typeof currents[k] === 'number') return currents[k];
  }
  return undefined;
}

function lookupVoltage(
  voltages: Record<string, number>,
  pinNetMap: Record<string, string>,
  target: string,
): number | undefined {
  if (typeof voltages[target] === 'number') return voltages[target];
  if (target.includes(':')) {
    const net = pinNetMap[target] ?? pinNetMap[target.toLowerCase()];
    if (net && typeof voltages[net] === 'number') return voltages[net];
  }
  const plus = pinNetMap[`${target}:V+`];
  const minus = pinNetMap[`${target}:V-`];
  if (plus && minus) {
    const vp = voltages[plus] ?? (plus === '0' ? 0 : undefined);
    const vm = voltages[minus] ?? (minus === '0' ? 0 : undefined);
    if (typeof vp === 'number' && typeof vm === 'number') return vp - vm;
  }
  for (const pin of ['2', 'SIG', 'OUT', 'V+', '1']) {
    const net = pinNetMap[`${target}:${pin}`];
    if (net && typeof voltages[net] === 'number') return voltages[net];
  }
  return undefined;
}

export async function runSpice(
  payload: VlxPayload,
  opts: { drive: DrivePin[]; asserts: SpiceAssert[]; demo: boolean; fixture?: string },
): Promise<{
  ok: boolean;
  solved: boolean;
  currents: Record<string, number>;
  voltages: Record<string, number>;
  probes: Record<string, number>;
  assertions: Array<{ spec: string; ok: boolean; actual: number | null; missing: boolean; abs: boolean }>;
  netlist_lines?: number;
  netlist_ok?: boolean;
  mode?: 'live' | 'fixture' | 'netlist-only';
  fixture_used?: string;
  error?: string;
}> {
  const { buildInputFromStore } = await import(
    '../../../frontend/src/simulation/spice/storeAdapter.ts'
  );
  const { buildNetlist } = await import('../../../frontend/src/simulation/spice/NetlistBuilder.ts');

  const snap = {
    components: payload.components.map((c) => ({
      id: c.id,
      metadataId: c.metadataId,
      properties: c.properties,
    })),
    wires: payload.wires.map((w) => ({
      id: w.id,
      start: { componentId: w.start.componentId, pinName: w.start.pinName },
      end: { componentId: w.end.componentId, pinName: w.end.pinName },
    })),
    boards: payload.boards.map((b) => ({
      id: b.id,
      boardKind: b.boardKind as BoardKind,
      pinStates: pinStatesForBoard(payload, b.id, b.boardKind, opts.drive),
    })),
  };
  const input = buildInputFromStore(snap);
  input.analysis = { kind: 'op' };
  const built = buildNetlist(input);
  const pinNetMap: Record<string, string> = {};
  for (const [k, v] of built.pinNetMap) pinNetMap[k] = v;

  let currents: Record<string, number> = {};
  let voltages: Record<string, number> = {};
  let solved = false;
  let mode: 'live' | 'fixture' | 'netlist-only' = 'live';
  let fixture_used: string | undefined;

  if (opts.demo) {
    const hasFixtureKeys = payload.components.some((c) => c.id === 'm_fl');
    const path = opts.fixture ?? (hasFixtureKeys ? DEFAULT_FIXTURE : undefined);
    if (path) {
      logInfo('sim.spice demo fixture', { path, netlist_lines: built.netlist.split('\n').length });
      currents = loadFixtureCurrents(path);
      voltages = loadFixtureVoltages(path);
      mode = 'fixture';
      fixture_used = path;
    } else {
      logInfo('sim.spice demo netlist-only', {
        netlist_lines: built.netlist.split('\n').length,
        boards: payload.boards.map((b) => b.id),
      });
      mode = 'netlist-only';
    }
  } else {
    logInfo('sim.spice live ngspice', {
      boards: payload.boards.map((b) => b.id),
      drive: opts.drive,
      netlist_lines: built.netlist.split('\n').length,
    });
    const { runNetlist } = await import('../../../frontend/src/simulation/spice/runNetlist.ts');
    const result = await runNetlist(built.netlist);
    solved = true;
    for (const vs of built.voltageSources) {
      const key = vs.toLowerCase();
      try {
        currents[key] = result.dcValue(`i(${key})`);
      } catch {
        /* missing branch */
      }
    }
    for (const net of built.nets) {
      try {
        voltages[net] = result.dcValue(`v(${net})`);
      } catch {
        try {
          voltages[net] = result.dcValue(net);
        } catch {
          /* missing node */
        }
      }
    }
    voltages['0'] = 0;
  }

  const probes: Record<string, number> = {};
  for (const c of payload.components) {
    if (c.metadataId === 'instr-voltmeter' || c.metadataId === 'voltmeter') {
      const v = lookupVoltage(voltages, pinNetMap, c.id);
      if (typeof v === 'number') probes[c.id] = v;
    }
    if (c.metadataId === 'instr-ammeter' || c.metadataId === 'ammeter') {
      const i = lookupCurrent(currents, c.id);
      if (typeof i === 'number') probes[c.id] = i;
    }
  }

  const assertions = evaluateAssertions(opts.asserts, currents, voltages, probes, pinNetMap);
  if (assertions.some((x) => x.missing)) {
    const miss = assertions.find((x) => x.missing)!;
    logInfo('sim.spice missing probe', { spec: miss.spec });
  }
  const ok = assertions.length === 0 || assertions.every((x) => x.ok);
  return {
    ok,
    solved,
    netlist_ok: true,
    mode,
    fixture_used,
    currents,
    voltages,
    probes,
    assertions,
    netlist_lines: built.netlist.split('\n').length,
  };
}
