/**
 * Attach the oscilloscope to a wire or a pin.
 *
 * A click is resolved through the same Union-Find the electrical solver
 * uses, so the probe sees the net rather than one line segment. When that
 * net touches a board GPIO, a digital channel is added (simulator-clock
 * high/low). An analog channel is always added for the net; its samples
 * come from the SPICE transient, on a separate track.
 */
import type { Wire } from '../types/wire';
import { boardPinToNumber } from '../utils/boardPinMapping';
import { BOARD_PIN_GROUPS } from './spice/boardPinGroups';
import { buildBoardPinNetMap, buildWireNetMap } from './spice/NetlistBuilder';
import type { BoardForSpice, TimeWaveforms } from './spice/types';
import { useOscilloscopeStore } from '../store/useOscilloscopeStore';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useElectricalStore } from '../store/useElectricalStore';

export interface ScopeBoardRef {
  id: string;
  boardKind: string;
}

export interface ScopeComponentRef {
  id: string;
  metadataId: string;
}

export interface ScopeDigitalHit {
  boardId: string;
  pin: number;
  /** Silkscreen name, e.g. "13", "GPIO2", "D13". */
  label: string;
}

export interface ScopeProbeTarget {
  netName: string;
  label: string;
  /** GPIO preferred for the digital track. Absent on power nets and passive-only nets. */
  digital?: ScopeDigitalHit;
}

export interface AnalogPoint {
  tSec: number;
  v: number;
}

export interface AnalogTrace {
  points: AnalogPoint[];
  /** Constant level: a DC operating point, or a transient that never moves. */
  dc: boolean;
}

const FLAT_EPS_V = 1e-4;

function boardsForSpice(boards: ScopeBoardRef[]): BoardForSpice[] {
  return boards.map((b) => {
    const group = BOARD_PIN_GROUPS[b.boardKind as keyof typeof BOARD_PIN_GROUPS] ?? BOARD_PIN_GROUPS.default;
    return {
      id: b.id,
      boardKind: b.boardKind,
      vcc: group.vcc,
      pins: {},
      groundPinNames: group.gnd,
      vccPinNames: group.vcc_pins,
      auxPinNames: group.aux?.pins,
      auxVolts: group.aux?.volts,
    };
  });
}

function spiceInput(boards: ScopeBoardRef[], components: ScopeComponentRef[], wires: Wire[]) {
  return {
    components: components.map((c) => ({
      id: c.id,
      metadataId: c.metadataId,
      properties: {},
    })),
    wires: wires.map((w) => ({
      id: w.id,
      start: { componentId: w.start.componentId, pinName: w.start.pinName },
      end: { componentId: w.end.componentId, pinName: w.end.pinName },
    })),
    boards: boardsForSpice(boards),
  };
}

function gpiosOnNet(
  netName: string,
  pinNets: Map<string, string>,
  boards: ScopeBoardRef[],
): ScopeDigitalHit[] {
  const hits: ScopeDigitalHit[] = [];
  for (const [key, net] of pinNets) {
    if (net !== netName) continue;
    const split = key.indexOf(':');
    if (split < 0) continue;
    const boardId = key.slice(0, split);
    const pinName = key.slice(split + 1);
    const board = boards.find((b) => b.id === boardId);
    if (!board) continue;
    const n = boardPinToNumber(board.boardKind, pinName);
    if (n === null || n < 0) continue;
    hits.push({ boardId, pin: n, label: pinName });
  }
  return hits;
}

function finish(
  netName: string,
  label: string,
  pinNets: Map<string, string>,
  boards: ScopeBoardRef[],
  prefer?: { boardId: string; pinName: string },
): ScopeProbeTarget {
  const hits = gpiosOnNet(netName, pinNets, boards);
  let digital = hits[0];
  if (prefer) {
    const preferred = hits.find((h) => h.boardId === prefer.boardId && h.label === prefer.pinName);
    if (preferred) digital = preferred;
  }
  return { netName, label, digital };
}

/** Net and GPIO (if any) reached by this wire. `null` when the wire is not in the net map. */
export function resolveWireProbe(
  wire: Wire,
  boards: ScopeBoardRef[],
  components: ScopeComponentRef[],
  wires: Wire[],
): ScopeProbeTarget | null {
  const input = spiceInput(boards, components, wires);
  const netName = buildWireNetMap(input).get(wire.id);
  if (!netName) return null;
  const pinNets = buildBoardPinNetMap(input);
  const startIsBoard = boards.some((b) => b.id === wire.start.componentId);
  const endIsBoard = boards.some((b) => b.id === wire.end.componentId);
  const prefer = startIsBoard
    ? { boardId: wire.start.componentId, pinName: wire.start.pinName }
    : endIsBoard
      ? { boardId: wire.end.componentId, pinName: wire.end.pinName }
      : undefined;
  return finish(netName, `${wire.start.pinName}–${wire.end.pinName}`, pinNets, boards, prefer);
}

/**
 * Net reached by this pin. `null` when the pin is not wired and is not a
 * supply pin the net builder already canonicalizes (GND / VCC).
 */
export function resolvePinProbe(
  componentId: string,
  pinName: string,
  boards: ScopeBoardRef[],
  components: ScopeComponentRef[],
  wires: Wire[],
): ScopeProbeTarget | null {
  const input = spiceInput(boards, components, wires);
  const pinNets = buildBoardPinNetMap(input);
  const direct = pinNets.get(`${componentId}:${pinName}`);
  const touching = wires.find(
    (w) =>
      (w.start.componentId === componentId && w.start.pinName === pinName) ||
      (w.end.componentId === componentId && w.end.pinName === pinName),
  );
  const netName = direct ?? (touching ? buildWireNetMap(input).get(touching.id) : undefined);
  if (!netName) return null;
  const board = boards.find((b) => b.id === componentId);
  return finish(
    netName,
    pinName,
    pinNets,
    boards,
    board ? { boardId: componentId, pinName } : undefined,
  );
}

/**
 * Voltage samples for one net.
 * A transient with real swing is returned point-for-point.
 * A flat transient, a DC operating point, or ground with no solve yet
 * comes back as a single level (`dc: true`).
 */
export function analogTraceForNet(
  netName: string,
  timeWaveforms: TimeWaveforms | undefined,
  nodeVoltages: Record<string, number>,
): AnalogTrace {
  const samples = timeWaveforms?.nodes.get(netName);
  const time = timeWaveforms?.time;
  if (samples && time && samples.length > 0 && samples.length === time.length) {
    let min = samples[0];
    let max = samples[0];
    for (const v of samples) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min < FLAT_EPS_V) {
      return { points: [{ tSec: 0, v: samples[samples.length - 1] }], dc: true };
    }
    return {
      points: time.map((tSec, i) => ({ tSec, v: samples[i] })),
      dc: false,
    };
  }
  const dc = nodeVoltages[netName];
  if (typeof dc === 'number' && Number.isFinite(dc)) {
    return { points: [{ tSec: 0, v: dc }], dc: true };
  }
  if (netName === '0') return { points: [{ tSec: 0, v: 0 }], dc: true };
  return { points: [], dc: true };
}

export function formatVolts(v: number): string {
  const abs = Math.abs(v);
  if (abs < 1e-3) return '0V';
  if (abs < 1) return `${(v * 1e3).toFixed(0)}mV`;
  return `${v.toFixed(2)}V`;
}

function snapshot() {
  const { boards, components, wires } = useSimulatorStore.getState();
  return {
    boards: boards.map((b) => ({ id: b.id, boardKind: b.boardKind })),
    components: components.map((c) => ({ id: c.id, metadataId: c.metadataId })),
    wires,
  };
}

/** Push a resolved node onto the scope and open the panel. */
export function commitProbe(target: ScopeProbeTarget): void {
  const scope = useOscilloscopeStore.getState();
  scope.setOpen(true);
  if (target.digital) {
    scope.addChannel(target.digital.boardId, target.digital.pin, target.digital.label);
  }
  scope.addAnalogChannel(target.netName, target.label);

  const electrical = useElectricalStore.getState();
  const trace = analogTraceForNet(target.netName, electrical.timeWaveforms, electrical.nodeVoltages);
  const digitalText = target.digital
    ? `数字 ${target.digital.label}`
    : '该网没有 MCU 引脚';
  const voltText =
    trace.points.length === 0
      ? '电压要等求解出这个网之后才有'
      : trace.dc
        ? `直流 ${formatVolts(trace.points[0].v)}`
        : `瞬态 ${trace.points.length} 点`;
  const message = `已探测 ${target.label}（${target.netName}）：${digitalText}，${voltText}`;
  useOscilloscopeStore.getState().setProbeMessage(message);
  console.info('[scope-probe] 已挂上', {
    net: target.netName,
    label: target.label,
    digital: target.digital ?? null,
    dc: trace.dc,
    points: trace.points.length,
    volts: trace.points.length ? trace.points[trace.points.length - 1].v : null,
  });
}

export function probeWire(wire: Wire): void {
  const snap = snapshot();
  const target = resolveWireProbe(wire, snap.boards, snap.components, snap.wires);
  if (!target) {
    console.info('[scope-probe] 导线没有节点', { wireId: wire.id });
    const scope = useOscilloscopeStore.getState();
    scope.setOpen(true);
    scope.setProbeMessage('这根线没有电气节点');
    return;
  }
  commitProbe(target);
}

export function probePin(componentId: string, pinName: string): void {
  const snap = snapshot();
  const target = resolvePinProbe(componentId, pinName, snap.boards, snap.components, snap.wires);
  if (!target) {
    console.info('[scope-probe] 引脚没有节点', { componentId, pinName });
    const scope = useOscilloscopeStore.getState();
    scope.setOpen(true);
    scope.setProbeMessage('这个引脚没有连到任何线路');
    return;
  }
  commitProbe(target);
}
