/**
 * <velxio-servo> — visible hobby-servo part.
 *
 * Upstream <wokwi-servo> (Lit, @wokwi/elements 1.9.x) has no :host
 * { display:inline-block }, so the custom-element box collapses to 0×0:
 * pinInfo still exists (wires land) but the body is invisible. We therefore
 * ship our own tag and point metadata.tagName at it.
 */

interface ElementPin {
  name: string;
  x: number;
  y: number;
  signals: unknown[];
}

export const SERVO_PIN_INFO: ElementPin[] = [
  { name: 'GND', x: 0, y: 18, signals: [] },
  { name: 'V+', x: 0, y: 36, signals: [] },
  { name: 'PWM', x: 0, y: 54, signals: [] },
];

const HORN_CX = 118;
const HORN_CY = 36;

const SVG = `
<style>
  :host{display:inline-block;line-height:0;width:150px;height:72px}
</style>
<svg width="150" height="72" viewBox="0 0 150 72" xmlns="http://www.w3.org/2000/svg">
  <line x1="0" y1="18" x2="18" y2="18" stroke="#6b3a12" stroke-width="3"/>
  <line x1="0" y1="36" x2="18" y2="36" stroke="#dc2626" stroke-width="3"/>
  <line x1="0" y1="54" x2="18" y2="54" stroke="#f59e0b" stroke-width="3"/>
  <circle cx="3" cy="18" r="3" fill="#6b3a12"/>
  <circle cx="3" cy="36" r="3" fill="#dc2626"/>
  <circle cx="3" cy="54" r="3" fill="#f59e0b"/>
  <text x="20" y="16" font-family="sans-serif" font-size="7" fill="#9ca3af">GND</text>
  <text x="20" y="34" font-family="sans-serif" font-size="7" fill="#fca5a5">V+</text>
  <text x="20" y="52" font-family="sans-serif" font-size="7" fill="#fcd34d">PWM</text>
  <rect x="18" y="8" width="78" height="56" rx="6" fill="#1d4ed8" stroke="#0f172a" stroke-width="1.6"/>
  <rect x="24" y="14" width="66" height="12" rx="2" fill="#1e3a8a"/>
  <text x="57" y="42" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold" fill="#e0e7ff">SERVO</text>
  <text id="label" x="57" y="56" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#fde68a"></text>
  <rect x="96" y="28" width="10" height="16" fill="#d4af37" stroke="#8a6d1b"/>
  <g id="horn" transform="translate(118 36)">
    <circle r="16" fill="#111827" stroke="#fbbf24" stroke-width="2"/>
    <circle r="5" fill="#fbbf24"/>
    <rect x="-3" y="-22" width="6" height="22" rx="2" fill="#e5e7eb"/>
  </g>
</svg>
`;

const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

export class ServoElement extends HTMLElementBase {
  readonly pinInfo: ElementPin[] = SERVO_PIN_INFO;

  private _angle = 0;
  private _horn = 'single';
  private _hornColor = '#e5e7eb';
  private _label = '';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = SVG;
  }

  get angle(): number {
    return this._angle;
  }
  set angle(v: number | string) {
    const n = Number(v);
    this._angle = Number.isFinite(n) ? n : 0;
    this.syncHorn();
  }

  get horn(): string {
    return this._horn;
  }
  set horn(v: string) {
    this._horn = v || 'single';
  }

  get hornColor(): string {
    return this._hornColor;
  }
  set hornColor(v: string) {
    this._hornColor = v || '#e5e7eb';
  }

  get label(): string {
    return this._label;
  }
  set label(v: string) {
    this._label = v ?? '';
    const el = this.shadowRoot?.getElementById('label');
    if (el) el.textContent = this._label;
  }

  private syncHorn() {
    const horn = this.shadowRoot?.getElementById('horn');
    if (!horn) return;
    horn.setAttribute('transform', `translate(${HORN_CX} ${HORN_CY}) rotate(${this._angle})`);
  }
}

function injectHostCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('velxio-servo-host-css')) return;
  const s = document.createElement('style');
  s.id = 'velxio-servo-host-css';
  // Upstream wokwi-servo collapses to 0×0 without this.
  s.textContent =
    'wokwi-servo,velxio-servo{display:inline-block!important;line-height:0}';
  document.head.appendChild(s);
}

injectHostCss();

if (typeof customElements !== 'undefined') {
  if (!customElements.get('velxio-servo')) {
    customElements.define('velxio-servo', ServoElement);
  }
  if (!customElements.get('wokwi-servo')) {
    customElements.define('wokwi-servo', ServoElement);
  }
}
