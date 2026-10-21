/**
 * Map canvas component metadataId → Arduino Library Manager names.
 *
 * Keys are store `metadataId` values (e.g. `ssd1306-i2c-4pin`), not example
 * `type` strings. Sourced from the gallery `libraries:` fields. Passive parts
 * (LED, button, buzzer, resistor, sound sensor) need no external library.
 */

import { normalizeLibName } from './libraryManifest';

/** Primary Arduino-index names for a component metadataId. */
const COMPONENT_LIBRARY_HINTS: Record<string, string[]> = {
  ssd1306: ['Adafruit SSD1306', 'Adafruit GFX Library', 'Adafruit BusIO'],
  'ssd1306-i2c-4pin': ['Adafruit SSD1306', 'Adafruit GFX Library', 'Adafruit BusIO'],
  'ssd1306-i2c': ['Adafruit SSD1306', 'Adafruit GFX Library', 'Adafruit BusIO'],
  'ssd1306-spi': ['Adafruit SSD1306', 'Adafruit GFX Library', 'Adafruit BusIO'],
  ili9341: ['Adafruit ILI9341', 'Adafruit GFX Library', 'Adafruit BusIO'],
  tft43: ['Adafruit GFX Library', 'Adafruit ILI9341', 'Adafruit BusIO'],
  lcd1602: ['LiquidCrystal'],
  lcd2004: ['LiquidCrystal'],
  dht22: ['DHT sensor library', 'Adafruit Unified Sensor'],
  dht11: ['DHT sensor library', 'Adafruit Unified Sensor'],
  servo: ['Servo'],
  bmp280: ['Adafruit BMP280 Library', 'Adafruit Unified Sensor', 'Adafruit BusIO'],
  mpu6050: ['Adafruit MPU6050', 'Adafruit Unified Sensor', 'Adafruit BusIO'],
  ds1307: ['RTClib', 'Adafruit BusIO'],
  ds3231: ['RTClib', 'Adafruit BusIO'],
  neopixel: ['Adafruit NeoPixel'],
  ws2812: ['Adafruit NeoPixel'],
};

/** When the board itself changes which lib is preferred for the same part. */
const BOARD_OVERRIDES: Record<string, Record<string, string[]>> = {
  esp32: { servo: ['ESP32Servo'] },
  'esp32-s3': { servo: ['ESP32Servo'] },
  'esp32-c3': { servo: ['ESP32Servo'] },
  'esp32-cam': { servo: ['ESP32Servo'] },
  'esp32-devkit-c-v4': { servo: ['ESP32Servo'] },
};

export interface LibraryRecommendation {
  /** Arduino Library Manager display name */
  name: string;
  /** metadataIds on the canvas that asked for this library */
  fromTypes: string[];
}

function normalizeId(id: string): string {
  return (id || '')
    .trim()
    .toLowerCase()
    .replace(/^wokwi-/, '')
    .replace(/^velxio-/, '');
}

/**
 * Recommend libraries for the parts currently on the canvas.
 * Accepts either store components (`metadataId`) or example shapes (`type`).
 */
export function recommendLibrariesFromCircuit(
  components: Array<{ metadataId?: string; type?: string }>,
  boardKind?: string | null,
): LibraryRecommendation[] {
  const board = (boardKind || '').toLowerCase();
  const byNorm = new Map<string, LibraryRecommendation>();

  for (const comp of components) {
    const raw = comp.metadataId || comp.type || '';
    const id = normalizeId(raw);
    if (!id) continue;
    const override = board ? BOARD_OVERRIDES[board]?.[id] : undefined;
    const names = override ?? COMPONENT_LIBRARY_HINTS[id];
    if (!names?.length) continue;
    for (const name of names) {
      const norm = normalizeLibName(name);
      if (!norm) continue;
      const existing = byNorm.get(norm);
      if (existing) {
        if (!existing.fromTypes.includes(id)) existing.fromTypes.push(id);
      } else {
        byNorm.set(norm, { name, fromTypes: [id] });
      }
    }
  }

  const result = [...byNorm.values()];
  if (result.length) {
    console.info('[library-hints] circuit recommendations', {
      board: board || null,
      count: result.length,
      libs: result.map((r) => ({ name: r.name, from: r.fromTypes })),
    });
  }
  return result;
}

/** Human-readable short label for a metadataId / type (for UI tooltips). */
export function componentTypeLabel(type: string): string {
  const t = normalizeId(type);
  const map: Record<string, string> = {
    ssd1306: 'SSD1306',
    'ssd1306-i2c-4pin': 'SSD1306',
    'ssd1306-i2c': 'SSD1306',
    'ssd1306-spi': 'SSD1306',
    ili9341: 'ILI9341',
    tft43: 'TFT 4.3"',
    lcd1602: 'LCD1602',
    lcd2004: 'LCD2004',
    dht22: 'DHT22',
    dht11: 'DHT11',
    servo: 'Servo',
    bmp280: 'BMP280',
    mpu6050: 'MPU6050',
    ds1307: 'DS1307',
    ds3231: 'DS3231',
    neopixel: 'NeoPixel',
    ws2812: 'WS2812',
  };
  return map[t] || t;
}
