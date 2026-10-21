import { describe, expect, it, beforeEach } from 'vitest';
import { ActuatorBus } from '../src/core/bus.js';
import { bindActuatorAngle } from '../src/core/bind.js';
import { actuatorBus } from '../src/core/bus.js';

describe('P0 ActuatorBus', () => {
  let bus: ActuatorBus;

  beforeEach(() => {
    bus = new ActuatorBus();
  });

  it('publish 后 snapshot 按 id 覆盖', () => {
    bus.publish({ id: 'sv1', kind: 'servo', q: 10, t_ns: 1 });
    bus.publish({ id: 'sv1', kind: 'servo', q: 90, t_ns: 2 });
    expect(bus.snapshot()).toHaveLength(1);
    expect(bus.get('sv1')?.q).toBe(90);
    expect(bus.trajectory()).toHaveLength(2);
  });

  it('subscribe 收到每次 publish', () => {
    const qs: number[] = [];
    bus.subscribe((p) => qs.push(p.q));
    bus.publish({ id: 'a', kind: 'stepper', q: 1.8, t_ns: 1 });
    bus.publish({ id: 'a', kind: 'stepper', q: 3.6, t_ns: 2 });
    expect(qs).toEqual([1.8, 3.6]);
  });
});

describe('P0 bindActuatorAngle', () => {
  beforeEach(() => actuatorBus.clear());

  it('写入 angle 即上总线', () => {
    const el: { angle?: number } = { angle: 0 };
    bindActuatorAngle(el, 'uno-sv1', 'servo');
    el.angle = 45;
    expect(actuatorBus.get('uno-sv1')?.q).toBe(45);
    expect(actuatorBus.get('uno-sv1')?.kind).toBe('servo');
  });
});
