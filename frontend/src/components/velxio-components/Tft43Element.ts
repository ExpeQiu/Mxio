/**
 * `<velxio-tft43>` — 4.3 寸 800×480 IPS 模组。
 * 引脚与常见 RA8875 SPI 模块一致，线接到引脚尖端。
 * `canvas` 是 800×480 帧缓冲，仿真把控制器像素画到上面。
 */

import {
  TFT43_BEZEL,
  TFT43_BODY_H,
  TFT43_BODY_W,
  TFT43_FB_H,
  TFT43_FB_W,
  TFT43_GLASS_H,
  TFT43_GLASS_W,
  TFT43_GUTTER,
  TFT43_PIN_SPACING,
  TFT43_PINS,
} from '../../simulation/displays/tft43Geom';

class Tft43Element extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    queueMicrotask(() => {
      this.dispatchEvent(new CustomEvent('canvas-ready', { bubbles: false }));
    });
  }

  get pinInfo() {
    const n = TFT43_PINS.length;
    const span = (n - 1) * TFT43_PIN_SPACING;
    const y0 = TFT43_BEZEL + (TFT43_GLASS_H - span) / 2;
    return TFT43_PINS.map((name, i) => ({
      name,
      x: 0,
      y: y0 + i * TFT43_PIN_SPACING,
      number: i + 1,
      signals:
        name === 'VCC'
          ? [{ type: 'power', signal: 'VCC' }]
          : name === 'GND'
            ? [{ type: 'power', signal: 'GND' }]
            : [],
    }));
  }

  get canvas(): HTMLCanvasElement | null {
    return this.shadowRoot?.querySelector('canvas') ?? null;
  }

  set lit(on: boolean) {
    if (on) this.setAttribute('data-lit', '1');
    else this.setAttribute('data-lit', '0');
  }

  get lit(): boolean {
    return this.getAttribute('data-lit') !== '0';
  }

  private render(): void {
    if (!this.shadowRoot) return;
    const ax = TFT43_GUTTER;
    const ay = TFT43_BEZEL;
    const n = TFT43_PINS.length;
    const span = (n - 1) * TFT43_PIN_SPACING;
    const y0 = TFT43_BEZEL + (TFT43_GLASS_H - span) / 2;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          position: relative;
          line-height: 0;
          width: ${TFT43_BODY_W}px;
          height: ${TFT43_BODY_H}px;
        }
        canvas {
          position: absolute;
          left: ${TFT43_GUTTER}px;
          top: ${ay}px;
          width: ${TFT43_GLASS_W}px;
          height: ${TFT43_GLASS_H}px;
          background: #07111c;
          pointer-events: none;
        }
        :host([data-lit="0"]) canvas { filter: brightness(0.08); }
        .label {
          font-family: ui-sans-serif, sans-serif;
          fill: #9aa4b2;
          font-size: 9px;
        }
      </style>
      <svg width="${TFT43_BODY_W}" height="${TFT43_BODY_H}" viewBox="0 0 ${TFT43_BODY_W} ${TFT43_BODY_H}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0.5" y="0.5" width="${TFT43_BODY_W - 1}" height="${TFT43_BODY_H - 1}" rx="6" fill="#1c1f26" stroke="#3a4150"/>
        <rect x="${ax - 2}" y="${ay - 2}" width="${TFT43_GLASS_W + 4}" height="${TFT43_GLASS_H + 4}" rx="2" fill="#05080d" stroke="#2a3344"/>
        <text class="label" x="${ax + TFT43_GLASS_W / 2}" y="${ay + TFT43_GLASS_H + 12}" text-anchor="middle">4.3" 800×480  RA8875</text>
        ${TFT43_PINS.map(
          (name, i) => `
            <rect x="0" y="${y0 + i * TFT43_PIN_SPACING - 3}" width="10" height="6" fill="#e6c36a"/>
            <text class="label" x="${TFT43_GUTTER - 6}" y="${y0 + i * TFT43_PIN_SPACING + 2}" text-anchor="end" font-size="8">${name}</text>
          `,
        ).join('')}
      </svg>
      <canvas width="${TFT43_FB_W}" height="${TFT43_FB_H}"></canvas>
    `;
  }
}

if (!customElements.get('velxio-tft43')) {
  customElements.define('velxio-tft43', Tft43Element);
}

export type { Tft43Element };
