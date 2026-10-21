/**
 * RA8875 子集：4.3 寸 800×480 SPI 屏。
 *
 * 主机侧与 Adafruit_RA8875 / BuyDisplay 示例相同的成对字节：
 *   0x80, 寄存器   写命令
 *   0x00, 数据     写数据
 * 图形加速（0x90 填矩形/画线）和内部字库（MWCR0 文本模式 + MRWC）
 * 直接改 800×480 帧缓冲，玻璃上看到的就是控制器画出的像素。
 */

import { glyphRows } from './font5x7';
import { TFT43_FB_H, TFT43_FB_W } from './tft43Geom';

const CMD_WRITE = 0x80;
const DATA_WRITE = 0x00;
const STATUS_READ = 0x40;

export class Ra8875Panel {
  readonly width = TFT43_FB_W;
  readonly height = TFT43_FB_H;
  readonly pixels = new Uint8ClampedArray(TFT43_FB_W * TFT43_FB_H * 4);

  displayOn = false;
  pinBacklight = true;
  gpioBacklight = true;
  dirty = false;

  bytes = 0;
  pixelWrites = 0;
  rects = 0;
  lastText = '';

  private waitPayload = false;
  private prefix = 0;
  private cmd = 0;
  private streaming = false;
  private textMode = false;
  private pixelHi = -1;
  private textBuf = '';

  private fgR = 31;
  private fgG = 63;
  private fgB = 31;
  private r = 248;
  private g = 252;
  private b = 248;

  private gx = 0;
  private gy = 0;
  private tx = 0;
  private ty = 0;
  private hScale = 0;
  private vScale = 0;

  private x0 = 0;
  private y0 = 0;
  private x1 = 0;
  private y1 = 0;

  private winX0 = 0;
  private winY0 = 0;
  private winX1 = TFT43_FB_W - 1;
  private winY1 = TFT43_FB_H - 1;

  constructor() {
    this.clear();
  }

  get lit(): boolean {
    return this.displayOn && this.pinBacklight && this.gpioBacklight;
  }

  /** CS 上升沿调用，让下一字节重新作为命令/数据前缀。 */
  align(): void {
    this.waitPayload = false;
    this.pixelHi = -1;
  }

  setBacklight(on: boolean): void {
    if (this.pinBacklight === on) return;
    this.pinBacklight = on;
    this.dirty = true;
    console.info(`[tft43] backlight=${on ? 1 : 0} lit=${this.lit ? 1 : 0}`);
  }

  reset(): void {
    this.softReset();
    this.displayOn = false;
    this.dirty = true;
    console.info('[tft43] state=RESET w=800 h=480');
  }

  pushByte(value: number): number {
    this.bytes++;
    if (!this.waitPayload) {
      this.prefix = value;
      this.waitPayload = true;
      return this.prefix === STATUS_READ ? 0x00 : 0x00;
    }
    this.waitPayload = false;
    if (this.prefix === CMD_WRITE) {
      this.endText();
      this.cmd = value;
      this.streaming = value === 0x02;
      this.pixelHi = -1;
      return 0x00;
    }
    if (this.prefix === DATA_WRITE) {
      if (this.streaming) {
        if (this.textMode) this.drawChar(value);
        else this.pixelByte(value);
      } else {
        this.writeReg(this.cmd, value);
      }
    }
    return 0x00;
  }

  private softReset(): void {
    this.clear();
    this.streaming = false;
    this.textMode = false;
    this.pixelHi = -1;
    this.textBuf = '';
    this.gx = 0;
    this.gy = 0;
    this.tx = 0;
    this.ty = 0;
    this.hScale = 0;
    this.vScale = 0;
    this.x0 = this.y0 = this.x1 = this.y1 = 0;
    this.winX0 = 0;
    this.winY0 = 0;
    this.winX1 = TFT43_FB_W - 1;
    this.winY1 = TFT43_FB_H - 1;
    this.recomputeFg();
  }

  private clear(): void {
    this.pixels.fill(0);
    for (let i = 3; i < this.pixels.length; i += 4) this.pixels[i] = 255;
    this.dirty = true;
  }

  private endText(): void {
    if (!this.textBuf) return;
    console.info(`[tft43] text="${this.textBuf}" x=${this.tx} y=${this.ty}`);
    this.lastText = this.textBuf;
    this.textBuf = '';
  }

  private recomputeFg(): void {
    this.r = (this.fgR & 31) << 3;
    this.g = (this.fgG & 63) << 2;
    this.b = (this.fgB & 31) << 3;
  }

  private writeReg(reg: number, val: number): void {
    switch (reg) {
      case 0x01: {
        if (val & 0x01) this.softReset();
        this.displayOn = (val & 0x80) !== 0;
        this.dirty = true;
        console.info(`[tft43] state=${this.displayOn ? 'ON' : 'OFF'} w=800 h=480 lit=${this.lit ? 1 : 0}`);
        break;
      }
      case 0x22:
        this.hScale = val & 3;
        this.vScale = (val >> 2) & 3;
        break;
      case 0x2a:
        this.tx = (this.tx & 0xff00) | val;
        break;
      case 0x2b:
        this.tx = (this.tx & 0x00ff) | (val << 8);
        break;
      case 0x2c:
        this.ty = (this.ty & 0xff00) | val;
        break;
      case 0x2d:
        this.ty = (this.ty & 0x00ff) | (val << 8);
        break;
      case 0x30:
        this.winX0 = (this.winX0 & 0xff00) | val;
        break;
      case 0x31:
        this.winX0 = (this.winX0 & 0x00ff) | (val << 8);
        break;
      case 0x32:
        this.winY0 = (this.winY0 & 0xff00) | val;
        break;
      case 0x33:
        this.winY0 = (this.winY0 & 0x00ff) | (val << 8);
        break;
      case 0x34:
        this.winX1 = (this.winX1 & 0xff00) | val;
        break;
      case 0x35:
        this.winX1 = (this.winX1 & 0x00ff) | (val << 8);
        break;
      case 0x36:
        this.winY1 = (this.winY1 & 0xff00) | val;
        break;
      case 0x37:
        this.winY1 = (this.winY1 & 0x00ff) | (val << 8);
        break;
      case 0x40:
        this.textMode = (val & 0x80) !== 0;
        break;
      case 0x46:
        this.gx = (this.gx & 0xff00) | val;
        break;
      case 0x47:
        this.gx = (this.gx & 0x00ff) | (val << 8);
        break;
      case 0x48:
        this.gy = (this.gy & 0xff00) | val;
        break;
      case 0x49:
        this.gy = (this.gy & 0x00ff) | (val << 8);
        break;
      case 0x63:
        this.fgR = val;
        this.recomputeFg();
        break;
      case 0x64:
        this.fgG = val;
        this.recomputeFg();
        break;
      case 0x65:
        this.fgB = val;
        this.recomputeFg();
        break;
      case 0x91:
        this.x0 = (this.x0 & 0xff00) | val;
        break;
      case 0x92:
        this.x0 = (this.x0 & 0x00ff) | (val << 8);
        break;
      case 0x93:
        this.y0 = (this.y0 & 0xff00) | val;
        break;
      case 0x94:
        this.y0 = (this.y0 & 0x00ff) | (val << 8);
        break;
      case 0x95:
        this.x1 = (this.x1 & 0xff00) | val;
        break;
      case 0x96:
        this.x1 = (this.x1 & 0x00ff) | (val << 8);
        break;
      case 0x97:
        this.y1 = (this.y1 & 0xff00) | val;
        break;
      case 0x98:
        this.y1 = (this.y1 & 0x00ff) | (val << 8);
        break;
      case 0x99:
        this.x0 = (this.x0 & 0xff00) | val;
        break;
      case 0x9a:
        this.x0 = (this.x0 & 0x00ff) | (val << 8);
        break;
      case 0x9b:
        this.y0 = (this.y0 & 0xff00) | val;
        break;
      case 0x9c:
        this.y0 = (this.y0 & 0x00ff) | (val << 8);
        break;
      case 0x9d:
        this.x1 = val;
        break;
      case 0x90:
        this.execDraw(val);
        break;
      case 0xc7:
        this.gpioBacklight = (val & 0x01) !== 0;
        this.dirty = true;
        console.info(`[tft43] gpiox=${val} lit=${this.lit ? 1 : 0}`);
        break;
      default:
        break;
    }
  }

  private execDraw(val: number): void {
    const circle = (val & 0x40) !== 0 && (val & 0x80) === 0;
    const fill = (val & 0x20) !== 0;
    const square = (val & 0x10) !== 0;
    if (circle) {
      this.strokeCircle(this.x0, this.y0, this.x1, fill);
      return;
    }
    if ((val & 0x80) === 0) return;
    let x0 = this.x0;
    let y0 = this.y0;
    let x1 = this.x1;
    let y1 = this.y1;
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (square && fill) {
      this.fillRect(x0, y0, x1, y1);
      this.rects++;
      if (this.rects % 40 === 1) {
        console.info(`[tft43] fill x=${x0} y=${y0} w=${x1 - x0 + 1} h=${y1 - y0 + 1} rgb=${this.r},${this.g},${this.b} n=${this.rects}`);
      }
      return;
    }
    if (square) {
      this.hline(x0, x1, y0);
      this.hline(x0, x1, y1);
      this.vline(x0, y0, y1);
      this.vline(x1, y0, y1);
      return;
    }
    this.line(this.x0, this.y0, this.x1, this.y1);
  }

  private fillRect(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y <= y1; y++) this.hline(x0, x1, y);
  }

  private hline(x0: number, x1: number, y: number): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = x0; x <= x1; x++) this.setPixel(x, y);
  }

  private vline(x: number, y0: number, y1: number): void {
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = y0; y <= y1; y++) this.setPixel(x, y);
  }

  private line(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (let n = 0; n < 4000; n++) {
      this.setPixel(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  private strokeCircle(cx: number, cy: number, radius: number, fill: boolean): void {
    const r = Math.max(0, radius);
    let x = r;
    let y = 0;
    let err = 1 - x;
    while (x >= y) {
      if (fill) {
        this.hline(cx - x, cx + x, cy + y);
        this.hline(cx - x, cx + x, cy - y);
        this.hline(cx - y, cx + y, cy + x);
        this.hline(cx - y, cx + y, cy - x);
      } else {
        this.setPixel(cx + x, cy + y);
        this.setPixel(cx + y, cy + x);
        this.setPixel(cx - y, cy + x);
        this.setPixel(cx - x, cy + y);
        this.setPixel(cx - x, cy - y);
        this.setPixel(cx - y, cy - x);
        this.setPixel(cx + y, cy - x);
        this.setPixel(cx + x, cy - y);
      }
      y++;
      if (err < 0) err += 2 * y + 1;
      else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }

  private pixelByte(value: number): void {
    if (this.pixelHi < 0) {
      this.pixelHi = value;
      return;
    }
    const color = (this.pixelHi << 8) | value;
    this.pixelHi = -1;
    const pr = ((color >> 11) & 31) << 3;
    const pg = ((color >> 5) & 63) << 2;
    const pb = (color & 31) << 3;
    const saved = [this.r, this.g, this.b];
    this.r = pr;
    this.g = pg;
    this.b = pb;
    this.setPixel(this.gx, this.gy);
    this.r = saved[0];
    this.g = saved[1];
    this.b = saved[2];
    this.pixelWrites++;
    this.gx++;
    if (this.gx > this.winX1) {
      this.gx = this.winX0;
      this.gy++;
      if (this.gy > this.winY1) this.gy = this.winY0;
    }
  }

  private drawChar(code: number): void {
    if (code === 0x0d) {
      this.tx = this.winX0;
      return;
    }
    const scaleH = this.hScale + 1;
    const scaleV = this.vScale + 1;
    const cellW = 8 * scaleH;
    const cellH = 16 * scaleV;
    if (code === 0x0a) {
      this.tx = this.winX0;
      this.ty += cellH;
      return;
    }
    if (this.tx + cellW - 1 > this.winX1) {
      this.tx = this.winX0;
      this.ty += cellH;
    }
    const rows = glyphRows(code);
    for (let row = 0; row < 7; row++) {
      const bits = rows?.[row] ?? '#####';
      for (let col = 0; col < 5; col++) {
        if (bits[col] !== '#') continue;
        const px = this.tx + (col + 1) * scaleH;
        const py = this.ty + (row * 2 + 1) * scaleV;
        for (let dy = 0; dy < scaleV * 2; dy++) {
          for (let dx = 0; dx < scaleH; dx++) this.setPixel(px + dx, py + dy);
        }
      }
    }
    this.textBuf += code >= 32 && code < 127 ? String.fromCharCode(code) : '?';
    this.tx += cellW;
  }

  private setPixel(x: number, y: number): void {
    if (x < this.winX0 || y < this.winY0 || x > this.winX1 || y > this.winY1) return;
    if (x < 0 || y < 0 || x >= TFT43_FB_W || y >= TFT43_FB_H) return;
    const i = (y * TFT43_FB_W + x) * 4;
    this.pixels[i] = this.r;
    this.pixels[i + 1] = this.g;
    this.pixels[i + 2] = this.b;
    this.pixels[i + 3] = 255;
    this.dirty = true;
  }
}
