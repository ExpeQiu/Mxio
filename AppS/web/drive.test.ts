import { describe, expect, it } from 'vitest';
import { activeHops } from './drive';

describe('vap drive hops', () => {
  const now = 1_000_000;

  it('highlights STT and LISTEN while holding the mic', () => {
    const hops = activeHops({
      listening: true,
      state: 'LISTEN',
      lastBus: null,
      now,
    });
    expect(hops.has('stt')).toBe(true);
    expect(hops.has('listen')).toBe(true);
    expect(hops.has('oled')).toBe(false);
  });

  it('maps THINK to UART bridge and LED', () => {
    const hops = activeHops({
      listening: false,
      state: 'THINK',
      lastBus: { dir: 'tx', text: 'SAY 天气如何', ts: now - 200 },
      now,
    });
    expect(hops.has('bridge')).toBe(true);
    expect(hops.has('uart')).toBe(true);
    expect(hops.has('think')).toBe(true);
    expect(hops.has('led')).toBe(true);
  });

  it('maps SPEAK to OLED buzzer and speaker', () => {
    const hops = activeHops({
      listening: false,
      state: 'SPEAK',
      lastBus: { dir: 'rx', text: '[chat] state=SPEAK', ts: now - 100 },
      now,
    });
    expect(hops.has('speak')).toBe(true);
    expect(hops.has('oled')).toBe(true);
    expect(hops.has('buzzer')).toBe(true);
    expect(hops.has('speaker')).toBe(true);
  });
});
