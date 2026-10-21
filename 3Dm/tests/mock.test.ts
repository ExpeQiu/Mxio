import { describe, expect, it, beforeEach } from 'vitest';
import { actuatorBus } from '../src/core/bus.js';
import { loadMechanism, detectMechanismId } from '../src/core/catalog.js';
import { playMockSync } from '../src/core/mock.js';

describe('P0 mock dump', () => {
  beforeEach(() => actuatorBus.clear());

  it('舵机扫摆覆盖 0–180', () => {
    const mech = loadMechanism('servo-sweep');
    const traj = playMockSync(mech, { durationMs: 2000, hz: 20 });
    const qs = traj.map((p) => p.q);
    expect(Math.min(...qs)).toBeLessThanOrEqual(10);
    expect(Math.max(...qs)).toBeGreaterThanOrEqual(170);
  });

  it('4dof 产出四个执行器', () => {
    const traj = playMockSync(loadMechanism('4dof-arm'), { durationMs: 500, hz: 10 });
    const ids = new Set(traj.map((p) => p.id));
    expect(ids).toEqual(new Set(['sv_base', 'sv_shld', 'sv_elbw', 'sv_grip']));
  });
});

describe('detect', () => {
  it('视觉臂元件映射 4dof-arm', () => {
    expect(detectMechanismId(['sv_base', 'sv_shld', 'led_ok'])).toBe('4dof-arm');
  });
  it('四驱映射 4wd-chassis', () => {
    expect(detectMechanismId(['m_fl', 'm_rr'])).toBe('4wd-chassis');
  });
  it('两驱映射 car-2wd', () => {
    expect(detectMechanismId(['m_l', 'm_r'])).toBe('car-2wd');
  });
});
