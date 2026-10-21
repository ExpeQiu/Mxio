/**
 * Board visual dimensions (width × height) in world px.
 * Kept here (not in BoardOnCanvas) so the wire router can treat board
 * bodies as obstacles without importing React/store.
 *
 * ESP32 sizes match the wokwi-boards SVG rendered at 5 px/mm.
 * Arduino sizes: wokwi-elements at 96 dpi — 1mm ≈ 3.7795px.
 */
export const BOARD_SIZE: Record<string, { w: number; h: number }> = {
  'arduino-uno': { w: 274, h: 202 },
  'arduino-nano': { w: 170, h: 67 },
  'arduino-mega': { w: 388, h: 192 },
  'raspberry-pi-pico': { w: 105, h: 264 },
  'raspberry-pi-zero': { w: 250, h: 160 },
  'raspberry-pi-1': { w: 250, h: 160 },
  'raspberry-pi-2': { w: 250, h: 160 },
  'raspberry-pi-3': { w: 250, h: 160 },
  'raspberry-pi-4': { w: 330, h: 215 },
  'raspberry-pi-5': { w: 330, h: 220 },
  esp32: { w: 141, h: 265 },
  'esp32-s3': { w: 128, h: 350 },
  'esp32-c3': { w: 127, h: 215 },
  'pi-pico-w': { w: 105, h: 264 },
  'esp32-devkit-c-v4': { w: 140, h: 283 },
  'esp32-cam': { w: 136, h: 202 },
  'wemos-lolin32-lite': { w: 128, h: 250 },
  'xiao-esp32-s3': { w: 91, h: 117 },
  'arduino-nano-esp32': { w: 217, h: 90 },
  'xiao-esp32-c3': { w: 91, h: 117 },
  'aitewinrobot-esp32c3-supermini': { w: 90, h: 123 },
  'stm32-bluepill': { w: 114, h: 271 },
  'stm32-blackpill': { w: 103, h: 266 },
  'stm32-bluepill-f103cb': { w: 114, h: 271 },
  'stm32-blackpill-f401': { w: 103, h: 266 },
  'stm32-f4-discovery': { w: 158, h: 235 },
  'stm32-olimex-h405': { w: 158, h: 196 },
  'stm32-netduino-plus2': { w: 158, h: 196 },
  'stm32-netduino2': { w: 158, h: 196 },
  attiny85: { w: 160, h: 132 },
};

export function boardSizeOf(boardKind: string): { w: number; h: number } {
  return BOARD_SIZE[boardKind] ?? { w: 300, h: 200 };
}
