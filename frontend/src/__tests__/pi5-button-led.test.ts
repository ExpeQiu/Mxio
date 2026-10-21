import { describe, expect, it } from 'vitest';
import { pi5ButtonLed } from '../data/examples-pi5-button-led';
import { exampleToVlx } from '../utils/exampleToVlx';
import { buildInputFromStore } from '../simulation/spice/storeAdapter';
import { buildNetlist } from '../simulation/spice/NetlistBuilder';

function fixtureWire(id: string, from: [string, string], to: [string, string]) {
  return {
    id,
    start: { componentId: from[0], pinName: from[1], x: 0, y: 0 },
    end: { componentId: to[0], pinName: to[1], x: 0, y: 0 },
    color: '#111111',
    waypoints: [],
  };
}

describe('Pi GPIO electrical voltage', () => {
  it.each(['raspberry-pi-3', 'raspberry-pi-4', 'raspberry-pi-5'] as const)(
    '%s separates GPIO logic from the 5V header supply',
    (boardKind) => {
      const input = buildInputFromStore({
        boards: [{ id: 'pi', boardKind, pinStates: { GPIO17: { type: 'pwm', duty: 0.5 } } }],
        components: [
          { id: 'r', metadataId: 'resistor', properties: { value: '1000' } },
          { id: 'load', metadataId: 'resistor', properties: { value: '1000' } },
        ],
        wires: [
          fixtureWire('a', ['pi', 'GPIO17'], ['r', '1']),
          fixtureWire('b', ['pi', 'GND'], ['r', '2']),
          fixtureWire('c', ['pi', '5V'], ['load', '1']),
          fixtureWire('d', ['pi', 'GND'], ['load', '2']),
        ],
      });
      const built = buildNetlist(input);
      expect(built.netlist).toMatch(/V_pi_GPIO17 .+ DC 1\.65/i);
      expect(built.netlist).toContain('V_AUX_RAIL_5 aux_rail_5 0 DC 5');
      expect(built.pinNetMap.get('pi:5V')).toBe('aux_rail_5');
    },
  );
});

describe('Pi 5 button/LED delivery', () => {
  it('exports an embedded main.py and a current-limited LED with a pulled-up input', () => {
    const payload = exampleToVlx(pi5ButtonLed);
    expect(payload.boards[0].boardKind).toBe('raspberry-pi-5');
    expect(payload.fileGroups[payload.boards[0].activeFileGroupId][0].name).toBe('main.py');
    expect(payload.components.find((c) => c.id === 'rled')?.properties.value).toBe('220');
    expect(payload.components.find((c) => c.id === 'rpull')?.properties.value).toBe('10000');
    expect(
      payload.wires.some((w) => w.start.pinName === 'GPIO17' && w.end.componentId === 'led'),
    ).toBe(false);
    expect(payload.wires).toHaveLength(7);
    expect(payload.components.every((c) => !c.id.includes('-'))).toBe(true);
  });
});
