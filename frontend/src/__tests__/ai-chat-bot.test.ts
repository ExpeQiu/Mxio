import { describe, it, expect } from 'vitest';
import { esp32AiChat } from '../data/examples-esp32-ai-chat';

describe('ESP32 AI chat robot example', () => {
  it('wires OLED / PTT / mic / LED / buzzer on ESP32', () => {
    expect(esp32AiChat.id).toBe('esp32-ai-chat');
    expect(esp32AiChat.boards?.[0]?.boardKind).toBe('esp32');
    const ids = esp32AiChat.components.map((c) => c.id);
    expect(ids).toEqual(['oled', 'btn', 'ledok', 'rled', 'buz', 'mic']);
    const pins = esp32AiChat.wires.map((w) => {
      const board = w.start.componentId === 'esp32' ? w.start.pinName : w.end.pinName;
      return board;
    });
    expect(pins).toEqual(
      expect.arrayContaining(['3V3', 'GND', '21', '22', '4', '2', '15', '34']),
    );
  });

  it('keeps component ids ngspice-safe (no hyphen)', () => {
    for (const c of esp32AiChat.components) {
      expect(c.id).not.toMatch(/-/);
    }
  });

  it('does not pull Adafruit SSD1306 (AVR util/delay.h breaks ESP32)', () => {
    const files = esp32AiChat.boards?.[0]?.files ?? [];
    const sketch = files.map((f) => f.content).join('\n');
    expect(sketch).not.toMatch(/Adafruit_SSD1306|Adafruit_GFX/);
    expect(sketch).toMatch(/192\.168\.4\.2\/v1\/chat\/completions/);
    expect(esp32AiChat.libraries ?? []).toEqual([]);
  });
});
