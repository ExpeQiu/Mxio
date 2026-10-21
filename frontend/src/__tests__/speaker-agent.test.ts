import { describe, it, expect } from 'vitest';
import { esp32SpeakerAgent } from '../data/examples-esp32-speaker';

describe('ESP32 speaker agent example', () => {
  it('wires OLED / PTT / mic / LED / jack buzzer on ESP32', () => {
    expect(esp32SpeakerAgent.id).toBe('esp32-speaker-agent');
    expect(esp32SpeakerAgent.boards?.[0]?.boardKind).toBe('esp32');
    const ids = esp32SpeakerAgent.components.map((c) => c.id);
    expect(ids).toEqual(['mic', 'oled', 'ptt', 'rled', 'ledok', 'jack']);
    const jack = esp32SpeakerAgent.components.find((c) => c.id === 'jack');
    expect(jack?.type).toBe('wokwi-buzzer');
    const mic = esp32SpeakerAgent.components.find((c) => c.id === 'mic');
    expect(mic?.type).toBe('wokwi-big-sound-sensor');
    const pins = esp32SpeakerAgent.wires.map((wire) => {
      return wire.start.componentId === 'esp32' ? wire.start.pinName : wire.end.pinName;
    });
    expect(pins).toEqual(
      expect.arrayContaining(['3V3', 'GND', 'GND2', '21', '22', '4', '2', '15', '34']),
    );
  });

  it('keeps the mic off the headphone-jack substitute', () => {
    const micToJack = esp32SpeakerAgent.wires.some((wire) => {
      const ids = [wire.start.componentId, wire.end.componentId];
      return ids.includes('mic') && ids.includes('jack');
    });
    expect(micToJack).toBe(false);
  });

  it('keeps component ids ngspice-safe (no hyphen)', () => {
    for (const c of esp32SpeakerAgent.components) {
      expect(c.id).not.toMatch(/-/);
    }
  });

  it('speaks to AgentCenter with core-only firmware', () => {
    const files = esp32SpeakerAgent.boards?.[0]?.files ?? [];
    const sketch = files.map((f) => f.content).join('\n');
    expect(sketch).not.toMatch(/Adafruit_SSD1306|Adafruit_GFX|ArduinoJson/);
    expect(sketch).toMatch(/\/api\/super-ai\/device\/turn/);
    expect(sketch).toMatch(/X-Device-Token/);
    expect(sketch).toMatch(/micBase \+ MIC_DELTA/);
    expect(sketch).toMatch(/Velxio-GUEST/);
    expect(esp32SpeakerAgent.libraries ?? []).toEqual([]);
  });
});
