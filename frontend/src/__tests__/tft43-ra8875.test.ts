import { describe, expect, it } from 'vitest';
import { Ra8875Panel } from '../simulation/displays/Ra8875';
import { TFT43_FB_H, TFT43_FB_W } from '../simulation/displays/tft43Geom';

function wrReg(panel: Ra8875Panel, reg: number, value: number) {
  panel.pushByte(0x80);
  panel.pushByte(reg);
  panel.pushByte(0x00);
  panel.pushByte(value);
}

function rgb(panel: Ra8875Panel, x: number, y: number) {
  const i = (y * TFT43_FB_W + x) * 4;
  return [panel.pixels[i], panel.pixels[i + 1], panel.pixels[i + 2]];
}

describe('4.3" RA8875 800×480', () => {
  it('fills a rectangle with the RGB565 color the host wrote', () => {
    const panel = new Ra8875Panel();
    wrReg(panel, 0x01, 0x80);
    wrReg(panel, 0x63, 0x1f);
    wrReg(panel, 0x64, 0x00);
    wrReg(panel, 0x65, 0x00);
    wrReg(panel, 0x91, 10);
    wrReg(panel, 0x92, 0);
    wrReg(panel, 0x93, 20);
    wrReg(panel, 0x94, 0);
    wrReg(panel, 0x95, 13);
    wrReg(panel, 0x96, 0);
    wrReg(panel, 0x97, 23);
    wrReg(panel, 0x98, 0);
    wrReg(panel, 0x90, 0xb0);

    expect(panel.lit).toBe(true);
    expect(rgb(panel, 10, 20)).toEqual([248, 0, 0]);
    expect(rgb(panel, 13, 23)).toEqual([248, 0, 0]);
    expect(rgb(panel, 9, 20)).toEqual([0, 0, 0]);
    expect(panel.width).toBe(800);
    expect(panel.height).toBe(TFT43_FB_H);
  });

  it('fills a circle so a face can be drawn on the glass', () => {
    const panel = new Ra8875Panel();
    wrReg(panel, 0x63, 0x1f);
    wrReg(panel, 0x64, 0x00);
    wrReg(panel, 0x65, 0x00);
    wrReg(panel, 0x99, 40);
    wrReg(panel, 0x9a, 0);
    wrReg(panel, 0x9b, 40);
    wrReg(panel, 0x9c, 0);
    wrReg(panel, 0x9d, 12);
    wrReg(panel, 0x90, 0x60);
    expect(rgb(panel, 40, 40)).toEqual([248, 0, 0]);
    expect(rgb(panel, 40, 10)).toEqual([0, 0, 0]);
  });

  it('writes an RGB565 pixel through the memory window', () => {
    const panel = new Ra8875Panel();
    wrReg(panel, 0x40, 0x00);
    wrReg(panel, 0x46, 2);
    wrReg(panel, 0x47, 0);
    wrReg(panel, 0x48, 3);
    wrReg(panel, 0x49, 0);
    panel.pushByte(0x80);
    panel.pushByte(0x02);
    panel.pushByte(0x00);
    panel.pushByte(0xf8);
    panel.pushByte(0x00);
    panel.pushByte(0x00);
    expect(rgb(panel, 2, 3)).toEqual([248, 0, 0]);
    expect(panel.pixelWrites).toBe(1);
  });

  it('draws a glyph in text mode and clears it on soft reset', () => {
    const panel = new Ra8875Panel();
    wrReg(panel, 0x63, 31);
    wrReg(panel, 0x64, 63);
    wrReg(panel, 0x65, 31);
    wrReg(panel, 0x40, 0x80);
    wrReg(panel, 0x22, 0x00);
    wrReg(panel, 0x2a, 0);
    wrReg(panel, 0x2b, 0);
    wrReg(panel, 0x2c, 0);
    wrReg(panel, 0x2d, 0);
    panel.pushByte(0x80);
    panel.pushByte(0x02);
    panel.pushByte(0x00);
    panel.pushByte('A'.charCodeAt(0));

    let lit = 0;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 16; x++) {
        if (rgb(panel, x, y)[0] > 0) lit++;
      }
    }
    expect(lit).toBeGreaterThan(8);

    wrReg(panel, 0x01, 0x01);
    expect(rgb(panel, 2, 2)).toEqual([0, 0, 0]);
    expect(panel.displayOn).toBe(false);
  });
});
