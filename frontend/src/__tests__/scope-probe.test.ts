/**
 * Scope probe resolution: a wire or pin becomes one net, plus a GPIO
 * when that net touches a board pin. Analog traces stay on the SPICE
 * clock (a transient curve, or a single DC level).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Wire } from '../types/wire';
import {
  analogTraceForNet,
  commitProbe,
  resolvePinProbe,
  resolveWireProbe,
} from '../simulation/scopeProbe';
import { useOscilloscopeStore } from '../store/useOscilloscopeStore';
import type { TimeWaveforms } from '../simulation/spice/types';

function wire(id: string, aComp: string, aPin: string, bComp: string, bPin: string): Wire {
  return {
    id,
    start: { componentId: aComp, pinName: aPin, x: 0, y: 0 },
    end: { componentId: bComp, pinName: bPin, x: 40, y: 0 },
    waypoints: [],
    color: '#22c55e',
  };
}

const uno = [{ id: 'arduino-uno', boardKind: 'arduino-uno' }];
const led = [{ id: 'led1', metadataId: 'led' }];

describe('resolveWireProbe', () => {
  it('maps a GPIO wire to that pin and a net', () => {
    const wires = [wire('w1', 'arduino-uno', '13', 'led1', 'A')];
    const hit = resolveWireProbe(wires[0], uno, led, wires);
    expect(hit).not.toBeNull();
    expect(hit!.digital).toEqual({ boardId: 'arduino-uno', pin: 13, label: '13' });
    expect(hit!.netName).toMatch(/^n/);
    expect(hit!.label).toBe('13–A');
  });

  it('treats a ground wire as net 0 with no GPIO', () => {
    const wires = [wire('g', 'arduino-uno', 'GND', 'led1', 'C')];
    const hit = resolveWireProbe(wires[0], uno, led, wires);
    expect(hit?.netName).toBe('0');
    expect(hit?.digital).toBeUndefined();
  });

  it('keeps a passive-only net on the voltage track', () => {
    const parts = [
      { id: 'r1', metadataId: 'resistor' },
      { id: 'r2', metadataId: 'resistor' },
    ];
    const wires = [wire('m', 'r1', '2', 'r2', '1')];
    const hit = resolveWireProbe(wires[0], [], parts, wires);
    expect(hit?.digital).toBeUndefined();
    expect(hit?.netName).toMatch(/^n/);
  });

  it('prefers the board pin the wire actually leaves', () => {
    const wires = [wire('short', 'arduino-uno', '12', 'arduino-uno', '13')];
    const hit = resolveWireProbe(wires[0], uno, [], wires);
    expect(hit?.digital?.pin).toBe(12);
  });
});

describe('resolvePinProbe', () => {
  it('follows a component pin onto the GPIO it is wired to', () => {
    const wires = [wire('w1', 'arduino-uno', '13', 'led1', 'A')];
    const hit = resolvePinProbe('led1', 'A', uno, led, wires);
    expect(hit?.digital?.pin).toBe(13);
    expect(hit?.label).toBe('A');
  });

  it('returns null for a pin that is not connected', () => {
    expect(resolvePinProbe('led1', 'A', uno, led, [])).toBeNull();
  });

  it('still resolves an unwired ground pin to net 0', () => {
    const hit = resolvePinProbe('arduino-uno', 'GND', uno, [], []);
    expect(hit?.netName).toBe('0');
    expect(hit?.digital).toBeUndefined();
  });
});

describe('analogTraceForNet', () => {
  it('returns the transient when the net swings', () => {
    const wf: TimeWaveforms = {
      time: [0, 0.001, 0.002],
      nodes: new Map([['n0', [0, 2.5, 5]]]),
      branches: new Map(),
    };
    const trace = analogTraceForNet('n0', wf, {});
    expect(trace.dc).toBe(false);
    expect(trace.points).toHaveLength(3);
    expect(trace.points[2].v).toBe(5);
  });

  it('collapses a flat transient to one DC level', () => {
    const wf: TimeWaveforms = {
      time: [0, 0.001],
      nodes: new Map([['n0', [3.3, 3.3]]]),
      branches: new Map(),
    };
    const trace = analogTraceForNet('n0', wf, {});
    expect(trace.dc).toBe(true);
    expect(trace.points).toEqual([{ tSec: 0, v: 3.3 }]);
  });

  it('reads a DC operating point when there is no transient', () => {
    const trace = analogTraceForNet('n0', undefined, { n0: 1.65 });
    expect(trace.dc).toBe(true);
    expect(trace.points).toEqual([{ tSec: 0, v: 1.65 }]);
  });

  it('shows ground at 0 V before a solve', () => {
    expect(analogTraceForNet('0', undefined, {}).points).toEqual([{ tSec: 0, v: 0 }]);
  });

  it('is empty when the net has never been solved', () => {
    expect(analogTraceForNet('n9', undefined, {}).points).toEqual([]);
  });
});

describe('commitProbe', () => {
  beforeEach(() => {
    useOscilloscopeStore.setState({
      open: false,
      channels: [],
      samples: {},
      probeMessage: '',
      probeArmed: false,
    });
  });

  it('opens the scope and adds a digital track plus a voltage track', () => {
    const wires = [wire('w1', 'arduino-uno', '13', 'led1', 'A')];
    const hit = resolveWireProbe(wires[0], uno, led, wires)!;
    commitProbe(hit);
    const { open, channels, probeMessage } = useOscilloscopeStore.getState();
    expect(open).toBe(true);
    expect(channels.filter((c) => c.kind !== 'analog')).toHaveLength(1);
    expect(channels.filter((c) => c.kind === 'analog')).toHaveLength(1);
    expect(channels.find((c) => c.kind === 'analog')?.netName).toBe(hit.netName);
    expect(probeMessage).toContain('已探测');
  });

  it('does not duplicate a net that is probed twice', () => {
    const wires = [wire('w1', 'arduino-uno', '13', 'led1', 'A')];
    const hit = resolveWireProbe(wires[0], uno, led, wires)!;
    commitProbe(hit);
    commitProbe(hit);
    const { channels } = useOscilloscopeStore.getState();
    expect(channels).toHaveLength(2);
  });
});
