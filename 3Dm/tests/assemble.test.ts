import { describe, expect, it } from 'vitest';
import { assignMount, assemblyFromBinds, bindMechanism, mountsFromMechanism, parseBindSpec, validateAssembly } from '../src/core/assemble.js';
import { loadAssembly } from '../src/core/assembly-catalog.js';
import { loadMechanism } from '../src/core/catalog.js';
import { forwardKinematics } from '../src/core/kinematics.js';
import type { ActuatorPose } from '../src/core/types.js';

const MID: ActuatorPose[] = [
  { id: 'sv_base', kind: 'servo', q: 180, t_ns: 0 },
  { id: 'sv_shld', kind: 'servo', q: 90, t_ns: 0 },
  { id: 'sv_elbw', kind: 'servo', q: 90, t_ns: 0 },
  { id: 'sv_grip', kind: 'servo', q: 70, t_ns: 0 },
];

describe('装配校验', () => {
  it('元件=关节 解析', () => {
    expect(parseBindSpec('sv_base=j_base,sv_elbw=j_elbw')).toEqual([
      { componentId: 'sv_base', jointId: 'j_base' },
      { componentId: 'sv_elbw', jointId: 'j_elbw' },
    ]);
  });

  it('重复关节报错', () => {
    const mech = loadMechanism('4dof-arm');
    const issues = validateAssembly(mech, {
      id: 'bad',
      name: 'bad',
      mechanismId: '4dof-arm',
      mounts: [
        { componentId: 'a', jointId: 'j_base' },
        { componentId: 'b', jointId: 'j_base' },
      ],
    });
    expect(issues.some((i) => i.code === 'dup_joint')).toBe(true);
  });
});

describe('装配改正解', () => {
  const mech = loadMechanism('4dof-arm');

  it('默认装配：基座 180° 末端到 +Y', () => {
    const bound = bindMechanism(mech, loadAssembly('arm-default'));
    const ee = forwardKinematics(bound, MID).ee!.xyz;
    expect(ee[0]).toBeCloseTo(0, 4);
    expect(ee[1]).toBeCloseTo(0.22, 4);
    expect(ee[2]).toBeCloseTo(0.06, 4);
  });

  it('对调基座↔肘：同一 PWM 变成俯仰，末端不再在 +Y', () => {
    const bound = bindMechanism(mech, loadAssembly('arm-swap-base-elbw'));
    const ee = forwardKinematics(bound, MID).ee!.xyz;
    expect(ee[1]).toBeCloseTo(0, 4);
    expect(ee[0]).toBeCloseTo(0.12, 4);
    expect(ee[2]).toBeCloseTo(-0.04, 4);
  });

  it('基座 qScale=-1：180° 转到 -Y', () => {
    const bound = bindMechanism(mech, loadAssembly('arm-invert-base'));
    const ee = forwardKinematics(bound, MID).ee!.xyz;
    expect(ee[0]).toBeCloseTo(0, 4);
    expect(ee[1]).toBeCloseTo(-0.22, 4);
    expect(ee[2]).toBeCloseTo(0.06, 4);
  });
});

describe('画布点选装配', () => {
  it('对调两个关节上的元件', () => {
    const mounts = mountsFromMechanism(loadMechanism('4dof-arm'));
    const next = assignMount(mounts, 'j_elbw', 'sv_base');
    expect(next.find((m) => m.jointId === 'j_elbw')?.componentId).toBe('sv_base');
    expect(next.find((m) => m.jointId === 'j_base')?.componentId).toBe('sv_elbw');
  });

  it('对调后正解与具名装配一致', () => {
    const mech = loadMechanism('4dof-arm');
    let mounts = mountsFromMechanism(mech);
    mounts = assignMount(mounts, 'j_elbw', 'sv_base');
    const bound = bindMechanism(mech, assemblyFromBinds('4dof-arm', mounts, 'canvas'));
    const ee = forwardKinematics(bound, MID).ee!.xyz;
    expect(ee[0]).toBeCloseTo(0.12, 4);
    expect(ee[2]).toBeCloseTo(-0.04, 4);
  });
});
