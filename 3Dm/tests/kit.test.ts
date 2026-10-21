import { describe, expect, it } from 'vitest';
import { detectKitId, loadKit, suggestBinds } from '../src/core/kit.js';

describe('Kit 目录', () => {
  it('三轴臂与两驱小车在目录中', () => {
    expect(loadKit('arm-3dof').roles.map((r) => r.role)).toEqual(['base', 'shoulder', 'elbow']);
    expect(loadKit('car-2wd').mechanismId).toBe('car-2wd');
  });
});

describe('detectKitId', () => {
  it('视觉臂 id 仍映射四轴臂', () => {
    expect(detectKitId(['sv_base', 'sv_shld', 'led_ok'])).toBe('4dof-arm');
  });
  it('四驱 / 两驱', () => {
    expect(detectKitId(['m_fl', 'm_rr'])).toBe('4wd-chassis');
    expect(detectKitId(['m_l', 'm_r'])).toBe('car-2wd');
  });
  it('三个无名舵机映射三轴臂', () => {
    expect(detectKitId(['servo-1', 'servo-2', 'servo-3'])).toBe('arm-3dof');
  });
  it('三只角色舵机无夹爪映射三轴臂', () => {
    expect(detectKitId(['sv_base', 'sv_shld', 'sv_elbw'])).toBe('arm-3dof');
  });
  it('四条腿 id 映射机器狗', () => {
    expect(detectKitId(['sv_lf', 'sv_rr'])).toBe('quad-4dof');
  });
});

describe('suggestBinds', () => {
  it('精确 id 绑到角色', () => {
    const r = suggestBinds(loadKit('arm-3dof'), [
      { id: 'sv_base', kind: 'servo' },
      { id: 'sv_shld', kind: 'servo' },
    ]);
    expect(r.mounts.find((m) => m.jointId === 'j_base')?.componentId).toBe('sv_base');
    expect(r.suggestions.find((s) => s.role === 'elbow')?.status).toBe('missing');
    expect(r.suggestions.filter((s) => s.status === 'bound')).toHaveLength(2);
  });

  it('缺精确 id 时按种类顺序填入', () => {
    const r = suggestBinds(loadKit('arm-3dof'), [
      { id: 'servo-1', kind: 'servo' },
      { id: 'servo-2', kind: 'servo' },
      { id: 'servo-3', kind: 'servo' },
    ]);
    expect(r.mounts.map((m) => m.componentId)).toEqual(['servo-1', 'servo-2', 'servo-3']);
    expect(r.suggestions.every((s) => s.status === 'bound')).toBe(true);
  });

  it('直流电机绑两驱轮', () => {
    const r = suggestBinds(loadKit('car-2wd'), [
      { id: 'm_l', kind: 'dc-motor' },
      { id: 'extra', kind: 'servo' },
    ]);
    expect(r.mounts).toHaveLength(1);
    expect(r.suggestions.find((s) => s.role === 'right')?.status).toBe('missing');
    expect(r.extras.map((e) => e.id)).toEqual(['extra']);
  });
});
