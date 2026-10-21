import { describe, expect, it } from 'vitest';
import { actuatorRole, actuatorSpec, inferKind, jointQdeg } from '../src/core/actuator-info.js';

describe('执行元件信息', () => {
  it('按 id 推断种类与角色', () => {
    expect(inferKind('sv_base')).toBe('servo');
    expect(inferKind('m_fl')).toBe('dc-motor');
    expect(actuatorRole('sv_elbw')).toBe('肘舵机');
    expect(actuatorSpec('sv_base').pins).toContain('PWM');
  });

  it('关节量 = (q + 零位) × 传动比', () => {
    expect(jointQdeg({ componentId: 'sv_base', jointId: 'j_base', qOffsetDeg: -90, qScale: 1 }, {
      id: 'sv_base',
      kind: 'servo',
      q: 180,
      t_ns: 0,
    })).toBe(90);
  });
});
