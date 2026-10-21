import { describe, it, expect } from 'vitest';
import { SERVO_PIN_INFO } from '../velxio-elements/servo-element';
import { esp32camAiArm } from '../data/examples-esp32cam-ai-arm';

describe('wokwi-servo local fallback', () => {
  it('exposes GND / V+ / PWM in wokwi top-to-bottom order', () => {
    expect(SERVO_PIN_INFO.map((p) => p.name)).toEqual(['GND', 'V+', 'PWM']);
  });

  it('AI vision arm example places four labelled servos', () => {
    const servos = esp32camAiArm.components.filter((c) => /servo$/.test(c.type));
    expect(servos.map((c) => c.id)).toEqual(['sv_base', 'sv_shld', 'sv_elbw', 'sv_grip']);
    expect(servos.map((c) => c.properties?.label)).toEqual(['基座', '肩', '肘', '夹爪']);
  });
});
