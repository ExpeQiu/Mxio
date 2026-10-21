/**
 * velxio-dc-motor — 2-pin hobby DC motor with a visible wheel.
 *
 * Pins 1 / 2 sit on the back of the can so an L293D OUT pair wires like a
 * winding. The rotor spins when SPICE branch current is non-zero
 * (see MotorDriverParts.ts).
 *
 * Tag: velxio-dc-motor  (metadataId 'dc-motor' via stripBrandPrefix).
 */

const STYLE = `
:host{display:inline-block;line-height:0}
.rotor{transform-origin:center;transform-box:fill-box}
:host([spinning]) .rotor{animation:vx-dc-spin .35s linear infinite}
:host([spinning="rev"]) .rotor{animation:vx-dc-spin .35s linear infinite reverse}
@keyframes vx-dc-spin{to{transform:rotate(360deg)}}
`;

const SVG = `
<style>${STYLE}</style>
<svg width="110" height="64" viewBox="0 0 110 64" xmlns="http://www.w3.org/2000/svg">
  <!-- leads -->
  <line x1="0" y1="22" x2="14" y2="22" stroke="#555" stroke-width="2"/>
  <line x1="0" y1="42" x2="14" y2="42" stroke="#555" stroke-width="2"/>
  <circle cx="3" cy="22" r="2.4" fill="#c9a227"/>
  <circle cx="3" cy="42" r="2.4" fill="#555"/>
  <text x="8" y="16" font-family="sans-serif" font-size="7" fill="#888">1</text>
  <text x="8" y="56" font-family="sans-serif" font-size="7" fill="#888">2</text>
  <!-- can -->
  <rect x="14" y="12" width="52" height="40" rx="6" fill="#4b5563" stroke="#111" stroke-width="1.4"/>
  <rect x="18" y="16" width="44" height="8" rx="2" fill="#374151"/>
  <text x="40" y="38" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#e5e7eb" font-weight="bold">DC</text>
  <!-- bushing + shaft -->
  <rect x="66" y="26" width="8" height="12" fill="#d4af37" stroke="#8a6d1b"/>
  <rect x="74" y="30" width="6" height="4" fill="#9ca3af"/>
  <!-- wheel -->
  <g class="rotor">
    <circle cx="88" cy="32" r="18" fill="#1f2937" stroke="#111" stroke-width="2"/>
    <circle cx="88" cy="32" r="12" fill="#6b7280"/>
    <circle cx="88" cy="32" r="4" fill="#111"/>
    <line x1="88" y1="16" x2="88" y2="48" stroke="#111" stroke-width="1.5"/>
    <line x1="72" y1="32" x2="104" y2="32" stroke="#111" stroke-width="1.5"/>
  </g>
</svg>
`;

class DcMotorElement extends HTMLElement {
  readonly pinInfo = [
    { name: '1', x: 0, y: 22, number: 1, signals: [] as string[] },
    { name: '2', x: 0, y: 42, number: 2, signals: [] as string[] },
  ];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = SVG;
  }

  set spinning(value: boolean | 'rev' | '') {
    if (!value) this.removeAttribute('spinning');
    else this.setAttribute('spinning', value === 'rev' ? 'rev' : '');
  }

  get spinning(): boolean | 'rev' {
    const v = this.getAttribute('spinning');
    if (v === null) return false;
    return v === 'rev' ? 'rev' : true;
  }
}

if (!customElements.get('velxio-dc-motor')) {
  customElements.define('velxio-dc-motor', DcMotorElement);
}

export {};
