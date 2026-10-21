import { describe, it, expect } from 'vitest';
import { pi53dofArm } from '../data/examples-pi5-3dof-arm';
import { detectKitId } from '@3dm/core/kit';

describe('Pi 5 三轴机械摆臂', () => {
  it('wires three labelled servos on raspberry-pi-5 PWM pins', () => {
    expect(pi53dofArm.id).toBe('pi5-3dof-arm');
    expect(pi53dofArm.boards?.[0]?.boardKind).toBe('raspberry-pi-5');
    const servos = pi53dofArm.components.filter((c) => /servo$/.test(c.type));
    expect(servos.map((c) => c.id)).toEqual(['sv_base', 'sv_shld', 'sv_elbw']);
    expect(servos.map((c) => c.properties?.label)).toEqual(['基座', '肩', '肘']);
    const pwm = pi53dofArm.wires
      .filter((w) => w.end.pinName === 'PWM')
      .map((w) => [w.start.pinName, w.end.componentId]);
    expect(pwm).toEqual([
      ['GPIO12', 'sv_base'],
      ['GPIO13', 'sv_shld'],
      ['GPIO18', 'sv_elbw'],
    ]);
  });

  it('keeps component ids ngspice-safe and LED behind 220Ω', () => {
    for (const c of pi53dofArm.components) {
      expect(c.id).not.toMatch(/-/);
    }
    const ids = pi53dofArm.components.map((c) => c.id);
    expect(ids).toContain('rled');
    expect(ids).toContain('ledok');
    expect(pi53dofArm.wires).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          start: expect.objectContaining({ componentId: 'raspberry-pi-5', pinName: 'GPIO17' }),
          end: expect.objectContaining({ componentId: 'rled', pinName: '1' }),
        }),
        expect.objectContaining({
          start: expect.objectContaining({ componentId: 'rled', pinName: '2' }),
          end: expect.objectContaining({ componentId: 'ledok', pinName: 'A' }),
        }),
      ]),
    );
  });

  it('ships gpiozero AngularServo firmware without extra libraries', () => {
    const py = pi53dofArm.boards?.[0]?.vfsFiles?.['script.py'] ?? '';
    expect(py).toContain('from gpiozero import AngularServo, LED');
    expect(py).toContain('GPIO12');
    expect(py).toContain('def demo');
    expect(py).not.toMatch(/Adafruit_|ArduinoJson/);
    expect(pi53dofArm.libraries ?? []).toEqual([]);
  });

  it('detects arm-3dof when three role servos are present without a gripper', () => {
    expect(detectKitId(['sv_base', 'sv_shld', 'sv_elbw'])).toBe('arm-3dof');
  });
});
