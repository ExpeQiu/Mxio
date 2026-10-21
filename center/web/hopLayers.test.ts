import { describe, expect, it } from 'vitest';
import type { DriveHopId } from '@apps/drive';
import { hopsForLayer, layerOfHop, motionHops, splitHops } from './hopLayers';

describe('center hop layers', () => {
  it('puts window/stt/bridge on the app column', () => {
    expect(layerOfHop('window')).toBe('app');
    expect(layerOfHop('stt')).toBe('app');
    expect(layerOfHop('bridge')).toBe('app');
    expect(layerOfHop('uart')).toBe('hardware');
    expect(layerOfHop('think')).toBe('hardware');
    expect(layerOfHop('oled')).toBe('hardware');
  });

  it('splits THINK hops across app and hardware', () => {
    const split = splitHops({
      listening: false,
      state: 'THINK',
      lastBus: { dir: 'tx', text: 'SAY hi', ts: 999_800 },
      now: 1_000_000,
    });
    expect(split.app.has('bridge')).toBe(true);
    expect(split.hardware.has('think')).toBe(true);
    expect(split.hardware.has('uart')).toBe(true);
    expect(split.hardware.has('led')).toBe(true);
    expect(split.app.has('think')).toBe(false);
  });

  it('lights motion joints when the arm has a lock or frames', () => {
    expect(motionHops({ face: false, n: 0, base: 90, shld: 90, elbw: 90, grip: 70 }).size).toBe(0);
    const on = motionHops({ face: true, n: 12, base: 95, shld: 88, elbw: 91, grip: 20 });
    expect([...on]).toEqual(expect.arrayContaining(['pose', 'sv_base', 'sv_grip']));
  });

  it('filters a hop set by layer', () => {
    const hops = new Set<DriveHopId>(['window', 'uart', 'speak', 'oled']);
    expect([...hopsForLayer('app', hops)]).toEqual(['window']);
    expect(hopsForLayer('hardware', hops).has('uart')).toBe(true);
    expect(hopsForLayer('hardware', hops).has('window')).toBe(false);
  });
});
