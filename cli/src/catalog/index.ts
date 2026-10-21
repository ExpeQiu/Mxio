import { readFileSync } from 'node:fs';
import type { ComponentMetadata } from '../../../frontend/src/types/component-metadata.ts';
import { BOARD_KIND_FQBN, BOARD_KIND_LABELS, isPiBoardKind } from '../../../frontend/src/types/board.ts';
import { metadataPath } from '../paths.js';

/** Pins used when metadata has no `pins` array (CLI validate still works). */
export const FALLBACK_PINS: Record<string, string[]> = {
  'dc-motor': ['1', '2'],
  'motor-driver-l293d': [
    'EN1', 'IN1', 'OUT1', 'GND.1', 'GND.2', 'OUT2', 'IN2', 'VCC2',
    'EN2', 'IN3', 'OUT3', 'GND.3', 'GND.4', 'OUT4', 'IN4', 'VCC1',
  ],
  'battery-9v': ['+', '−', '-'],
  'battery-aa': ['+', '−', '-'],
  'battery-coin-cell': ['+', '−', '-'],
  resistor: ['1', '2'],
  'resistor-us': ['1', '2'],
  capacitor: ['1', '2'],
  'capacitor-electrolytic': ['1', '2'],
  inductor: ['1', '2'],
  diode: ['A', 'C'],
  'diode-1n4007': ['A', 'C'],
  led: ['A', 'C'],
  'signal-generator': ['SIG', 'GND'],
  'power-supply': ['SIG', 'GND'],
  'instr-voltmeter': ['V+', 'V-'],
  'instr-ammeter': ['A+', 'A-'],
  pushbutton: ['1.l', '1.r', '2.l', '2.r'],
  servo: ['PWM', 'V+', 'GND'],
  'ssd1306-i2c-4pin': ['GND', 'VCC', 'SCL', 'SDA'],
  'hc-sr04': ['VCC', 'TRIG', 'ECHO', 'GND'],
  buzzer: ['1', '2'],
  'big-sound-sensor': ['VCC', 'GND', 'AOUT', 'DOUT'],
  'small-sound-sensor': ['VCC', 'GND', 'AOUT', 'DOUT'],
};

let cache: ComponentMetadata[] | null = null;

export function loadParts(): ComponentMetadata[] {
  if (cache) return cache;
  const raw = JSON.parse(readFileSync(metadataPath(), 'utf8')) as {
    components: ComponentMetadata[];
  };
  cache = raw.components;
  return cache;
}

export function findPart(idOrTag: string): ComponentMetadata | undefined {
  const q = idOrTag.toLowerCase();
  const all = loadParts();
  return (
    all.find((p) => p.id.toLowerCase() === q) ||
    all.find((p) => p.tagName.toLowerCase() === q) ||
    all.find(
      (p) =>
        p.tagName.toLowerCase() === `wokwi-${q}` || p.tagName.toLowerCase() === `velxio-${q}`,
    )
  );
}

export function partPins(part: ComponentMetadata): string[] | undefined {
  if (part.pins && part.pins.length) return part.pins;
  return FALLBACK_PINS[part.id];
}

export function pinsForMetadataId(metadataId: string): string[] | undefined {
  const part = findPart(metadataId);
  const fromPart = part ? partPins(part) : undefined;
  return fromPart ?? FALLBACK_PINS[metadataId];
}

export function listBoards(): Array<{
  id: string;
  label: string;
  fqbn: string | null;
  pi: boolean;
  compile: 'arduino' | 'none';
}> {
  return (Object.keys(BOARD_KIND_LABELS) as Array<keyof typeof BOARD_KIND_LABELS>).map((id) => ({
    id,
    label: BOARD_KIND_LABELS[id],
    fqbn: BOARD_KIND_FQBN[id],
    pi: isPiBoardKind(id),
    compile: isPiBoardKind(id) || BOARD_KIND_FQBN[id] == null ? 'none' : 'arduino',
  }));
}
