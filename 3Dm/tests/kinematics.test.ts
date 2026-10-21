import { describe, expect, it } from 'vitest';
import { loadMechanism } from '../src/core/catalog.js';
import { forwardKinematics } from '../src/core/kinematics.js';
import type { ActuatorPose } from '../src/core/types.js';

function poses(spec: Record<string, number>): ActuatorPose[] {
  return Object.entries(spec).map(([id, q]) => ({ id, kind: 'servo' as const, q, t_ns: 0 }));
}

describe('P2 4dof-arm FK', () => {
  const mech = loadMechanism('4dof-arm');

  it('中位 90/90/90/70 末端在 +X', () => {
    const fk = forwardKinematics(mech, poses({ sv_base: 90, sv_shld: 90, sv_elbw: 90, sv_grip: 70 }));
    const ee = fk.ee!.xyz;
    expect(ee[0]).toBeCloseTo(0.22, 4);
    expect(ee[1]).toBeCloseTo(0, 4);
    expect(ee[2]).toBeCloseTo(0.06, 4);
  });

  it('基座 180° 末端转到 +Y', () => {
    const fk = forwardKinematics(mech, poses({ sv_base: 180, sv_shld: 90, sv_elbw: 90, sv_grip: 70 }));
    const ee = fk.ee!.xyz;
    expect(ee[0]).toBeCloseTo(0, 4);
    expect(ee[1]).toBeCloseTo(0.22, 4);
    expect(ee[2]).toBeCloseTo(0.06, 4);
  });
});

describe('P1 servo-sweep FK', () => {
  it('0° 与 90° 角位移不同', () => {
    const mech = loadMechanism('servo-sweep');
    const a = forwardKinematics(mech, [{ id: 's', kind: 'servo', q: 0, t_ns: 0 }]);
    const b = forwardKinematics(mech, [{ id: 's', kind: 'servo', q: 90, t_ns: 0 }]);
    expect(a.joints.j_servo).toBeCloseTo(0, 6);
    expect(b.joints.j_servo).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('P2 4wd 车轮关节', () => {
  it('连续关节把电机转角接到轮上', () => {
    const mech = loadMechanism('4wd-chassis');
    const fk = forwardKinematics(mech, [
      { id: 'm_fl', kind: 'dc-motor', q: 90, t_ns: 0 },
      { id: 'm_fr', kind: 'dc-motor', q: 0, t_ns: 0 },
      { id: 'm_rl', kind: 'dc-motor', q: 0, t_ns: 0 },
      { id: 'm_rr', kind: 'dc-motor', q: 0, t_ns: 0 },
    ]);
    expect(fk.joints.j_fl).toBeCloseTo(Math.PI / 2, 6);
    expect(fk.links.w_fl.xyz[0]).toBeCloseTo(0.08, 4);
    expect(fk.links.w_fl.xyz[1]).toBeCloseTo(0.07, 4);
  });
});

describe('P2 arm-3dof FK', () => {
  const mech = loadMechanism('arm-3dof');

  it('中位 90/90/90 肘原点在 +X', () => {
    const fk = forwardKinematics(mech, poses({ sv_base: 90, sv_shld: 90, sv_elbw: 90 }));
    const ee = fk.ee!.xyz;
    expect(ee[0]).toBeCloseTo(0.12, 4);
    expect(ee[1]).toBeCloseTo(0, 4);
    expect(ee[2]).toBeCloseTo(0.06, 4);
  });

  it('基座 180° 末端转到 +Y', () => {
    const fk = forwardKinematics(mech, poses({ sv_base: 180, sv_shld: 90, sv_elbw: 90 }));
    const ee = fk.ee!.xyz;
    expect(ee[0]).toBeCloseTo(0, 4);
    expect(ee[1]).toBeCloseTo(0.12, 4);
    expect(ee[2]).toBeCloseTo(0.06, 4);
  });
});

describe('P2 car-2wd 车轮', () => {
  it('左轮 90° 接到连续关节', () => {
    const mech = loadMechanism('car-2wd');
    const fk = forwardKinematics(mech, [
      { id: 'm_l', kind: 'dc-motor', q: 90, t_ns: 0 },
      { id: 'm_r', kind: 'dc-motor', q: 0, t_ns: 0 },
    ]);
    expect(fk.joints.j_l).toBeCloseTo(Math.PI / 2, 6);
    expect(fk.links.w_l.xyz[0]).toBeCloseTo(-0.07, 4);
    expect(fk.links.w_l.xyz[1]).toBeCloseTo(0.07, 4);
  });
});
