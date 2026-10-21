import { describe, expect, it } from 'vitest';
import {
  recommendLibrariesFromCircuit,
  componentTypeLabel,
} from '../utils/componentLibraryHints';

describe('recommendLibrariesFromCircuit', () => {
  it('recommends SSD1306 stack from store metadataId (speaker-agent)', () => {
    const hints = recommendLibrariesFromCircuit(
      [
        { metadataId: 'big-sound-sensor' },
        { metadataId: 'ssd1306-i2c-4pin' },
        { metadataId: 'pushbutton' },
        { metadataId: 'resistor' },
        { metadataId: 'led' },
        { metadataId: 'buzzer' },
      ],
      'esp32',
    );
    const names = hints.map((h) => h.name);
    expect(names).toEqual([
      'Adafruit SSD1306',
      'Adafruit GFX Library',
      'Adafruit BusIO',
    ]);
  });

  it('also accepts example type strings', () => {
    const hints = recommendLibrariesFromCircuit(
      [{ type: 'velxio-ssd1306-i2c-4pin' }],
      'esp32',
    );
    expect(hints.map((h) => h.name)).toContain('Adafruit SSD1306');
  });

  it('uses ESP32Servo on ESP32 boards', () => {
    const hints = recommendLibrariesFromCircuit([{ metadataId: 'servo' }], 'esp32');
    expect(hints.map((h) => h.name)).toEqual(['ESP32Servo']);
  });

  it('uses Servo on Uno', () => {
    const hints = recommendLibrariesFromCircuit([{ metadataId: 'servo' }], 'arduino-uno');
    expect(hints.map((h) => h.name)).toEqual(['Servo']);
  });

  it('dedupes shared deps across parts', () => {
    const hints = recommendLibrariesFromCircuit(
      [{ metadataId: 'ssd1306' }, { metadataId: 'bmp280' }],
      'esp32',
    );
    const busio = hints.filter((h) => h.name === 'Adafruit BusIO');
    expect(busio).toHaveLength(1);
    expect(busio[0].fromTypes).toEqual(expect.arrayContaining(['ssd1306', 'bmp280']));
  });
});

describe('componentTypeLabel', () => {
  it('shortens known ids', () => {
    expect(componentTypeLabel('ssd1306-i2c-4pin')).toBe('SSD1306');
    expect(componentTypeLabel('velxio-ssd1306-i2c-4pin')).toBe('SSD1306');
  });
});
