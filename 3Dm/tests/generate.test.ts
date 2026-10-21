import { describe, expect, it } from 'vitest';
import { generateMechanism, generatePreset } from '../src/core/generate.js';
import { forwardKinematics } from '../src/core/kinematics.js';
import { loadMechanism } from '../src/core/catalog.js';
import { loadKit, missingBom } from '../src/core/kit.js';

describe('generateMechanism', () => {
  it('串联 5 轴产出 5 个舵机角色', () => {
    const g = generateMechanism({ kind: 'serial', n: 5 });
    expect(g.kit.id).toBe('serial-5');
    expect(g.kit.roles).toHaveLength(5);
    expect(g.mechanism.joints.filter((j) => j.type === 'revolute')).toHaveLength(5);
    expect(g.assembly.mounts.map((m) => m.componentId)).toContain('sv_j5');
  });

  it('四足 4×2 含膝关节', () => {
    const g = generateMechanism({ kind: 'quadruped', legs: 4, dofPerLeg: 2 });
    expect(g.mechanism.joints.some((j) => j.id === 'j_knee_lf')).toBe(true);
    expect(g.kit.roles).toHaveLength(8);
  });

  it('预设四足 8 轴', () => {
    expect(generatePreset('quad:4:2').kit.roles).toHaveLength(8);
  });
});

describe('builtin P1/P2', () => {
  it('四轴机器狗在目录中', () => {
    expect(loadKit('quad-4dof').roles.map((r) => r.aliases[0])).toEqual([
      'sv_lf',
      'sv_rf',
      'sv_lr',
      'sv_rr',
    ]);
    const fk = forwardKinematics(loadMechanism('quad-4dof'), [
      { id: 'sv_lf', kind: 'servo', q: 0, t_ns: 0 },
    ]);
    expect(fk.links.thigh_lf.xyz[0]).toBeCloseTo(0.06, 4);
    expect(fk.links.thigh_lf.xyz[1]).toBeCloseTo(0.045, 4);
    expect(fk.links.thigh_lf.xyz[2]).toBeCloseTo(0.1, 4);
  });

  it('简易人形 5 舵机', () => {
    expect(loadKit('humanoid-lite').roles).toHaveLength(5);
    const fk = forwardKinematics(loadMechanism('humanoid-lite'), [
      { id: 'sv_head', kind: 'servo', q: 0, t_ns: 0 },
    ]);
    expect(fk.links.head.xyz[2]).toBeGreaterThan(0.15);
  });

  it('空画布补四条腿', () => {
    const parts = missingBom(loadKit('quad-4dof'), []);
    expect(parts.map((p) => p.id)).toEqual(['sv_lf', 'sv_rf', 'sv_lr', 'sv_rr']);
    expect(parts.every((p) => p.metadataId === 'servo')).toBe(true);
  });
});
