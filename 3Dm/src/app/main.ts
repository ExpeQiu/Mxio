import { actuatorBus } from '../core/bus.js';
import { actuatorRole, actuatorSpec, formatAxis, inferKind, jointQdeg } from '../core/actuator-info.js';
import { listAssemblyIds, loadAssembly } from '../core/assembly-catalog.js';
import { adoptGenerated } from '../core/adopt.js';
import { loadMechanism } from '../core/catalog.js';
import { GEN_PRESETS, generatePreset, type GeneratedKit } from '../core/generate.js';
import {
  listKits,
  loadKit,
  suggestBinds,
  type BindSuggestion,
  type CanvasActuator,
} from '../core/kit.js';
import { log, setRunId } from '../core/log.js';
import type { MountDef } from '../core/types.js';
import { mountViewport } from '../viewer/viewport.js';

setRunId(`3dm-ui-${Date.now().toString(36)}`);

const params = new URLSearchParams(location.search);
const embed = params.get('embed') === '1';
if (embed) document.body.classList.add('embed');

const initial = params.get('kit') || params.get('mech') || localStorage.getItem('velxio.3dm.mech') || '4dof-arm';
const mockDefault = params.get('mock') === '1';

const mechSel = document.querySelector('#mech') as HTMLSelectElement;
const asmSel = document.querySelector('#assembly') as HTMLSelectElement;
const mockBtn = document.querySelector('#mock') as HTMLButtonElement;
const invertBtn = document.querySelector('#invert') as HTMLButtonElement;
const genSel = document.querySelector('#gen') as HTMLSelectElement;
const status = document.querySelector('#status') as HTMLElement;
const view = document.querySelector('#view') as HTMLElement;
const partsEl = document.querySelector('#parts') as HTMLElement;

for (const kit of listKits()) {
  const opt = document.createElement('option');
  opt.value = kit.id;
  opt.textContent = kit.name;
  if (kit.id === initial) opt.selected = true;
  mechSel.appendChild(opt);
}
if (![...mechSel.options].some((o) => o.value === initial) && mechSel.options.length) {
  mechSel.selectedIndex = 0;
}

for (const p of GEN_PRESETS) {
  const opt = document.createElement('option');
  opt.value = p.token;
  opt.textContent = p.label;
  genSel.appendChild(opt);
}

function ensureKitOption(id: string, label: string): void {
  if ([...mechSel.options].some((o) => o.value === id)) return;
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = label;
  mechSel.appendChild(opt);
}

function applyGenerated(g: GeneratedKit): void {
  adoptGenerated(g);
  ensureKitOption(g.kit.id, g.kit.name);
  mechSel.value = g.kit.id;
  fillAssemblies(g.mechanism.id, g.assembly.id);
  vp.applyKit(g.kit.id, lastActuators);
  localStorage.setItem('velxio.3dm.mech', g.kit.id);
  log.info('kit.generate', { phase: 'p2', kit_id: g.kit.id, joints: g.mechanism.joints.length });
}

function kitMechanism(kitId: string): string {
  try {
    return loadKit(kitId).mechanismId;
  } catch {
    return kitId;
  }
}

function fillAssemblies(mechId: string, preferred?: string) {
  asmSel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '装配：机构默认';
  asmSel.appendChild(none);
  for (const id of listAssemblyIds(mechId)) {
    const a = loadAssembly(id);
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = a.name;
    asmSel.appendChild(opt);
  }
  const pick = preferred ?? params.get('assembly') ?? '';
  if (pick && listAssemblyIds(mechId).includes(pick)) asmSel.value = pick;
}

fillAssemblies(kitMechanism(mechSel.value));

const vp = mountViewport(view, kitMechanism(mechSel.value));
try {
  vp.applyKit(mechSel.value);
} catch {
  /* 未知 kit 时保留机构默认 */
}
if (asmSel.value) vp.setAssembly(asmSel.value);

let pendingPart: string | null = null;
let lastActuators: CanvasActuator[] = [];
let lastSuggest: BindSuggestion[] = [];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function postSuggest(): void {
  if (window.parent === window) return;
  window.parent.postMessage(
    { type: 'velxio.3dm.suggest', kit: mechSel.value, suggestions: lastSuggest },
    '*',
  );
}

function refreshSuggest(mounts: MountDef[], kitId: string): void {
  try {
    const kit = loadKit(kitId);
    if (lastActuators.length) {
      lastSuggest = suggestBinds(kit, lastActuators).suggestions;
    } else {
      lastSuggest = kit.roles.map((role) => {
        const mount = mounts.find((m) => m.jointId === role.jointId);
        return {
          role: role.role,
          name: role.name,
          jointId: role.jointId,
          preferKind: role.preferKind,
          componentId: mount?.componentId,
          status: mount?.componentId ? ('bound' as const) : ('missing' as const),
        };
      });
    }
    postSuggest();
  } catch {
    lastSuggest = [];
  }
}

function renderParts(mounts: MountDef[], mechId: string) {
  const src = loadMechanism(mechId);
  const kit = (() => {
    try {
      return loadKit(mechSel.value);
    } catch {
      return null;
    }
  })();
  refreshSuggest(mounts, mechSel.value);

  const roleCards = kit
    ? kit.roles.map((role) => {
        const mount = mounts.find((m) => m.jointId === role.jointId);
        const hint = lastSuggest.find((s) => s.role === role.role);
        return {
          id: mount?.componentId || role.aliases[0] || role.role,
          roleName: role.name,
          mount,
          missing: hint?.status === 'missing',
          preferKind: role.preferKind,
        };
      })
    : [...new Set(src.joints.map((j) => j.componentId).filter((id) => id && id !== '*'))].map((id) => ({
        id,
        roleName: actuatorRole(id),
        mount: mounts.find((m) => m.componentId === id),
        missing: false,
        preferKind: inferKind(id),
      }));

  const selected = vp.getSelectedJoint();
  const snap = new Map(actuatorBus.snapshot().map((p) => [p.id, p]));
  const missingN = roleCards.filter((c) => c.missing).length;

  partsEl.innerHTML = `<h3>执行元件</h3><p class="hint">${
    missingN ? `缺 ${missingN} 件，点卡片再点关节球装配` : '点卡片再点关节球装配'
  }</p>`;

  for (const cardDef of roleCards) {
    const id = cardDef.id;
    const mount = cardDef.mount;
    const joint = src.joints.find((j) => j.id === (mount?.jointId ?? ''));
    const spec = actuatorSpec(id, mount?.kind ?? cardDef.preferKind);
    const pose = snap.get(id);
    const jq = jointQdeg(mount, pose);
    const card = document.createElement('button');
    card.type = 'button';
    card.dataset.part = id;
    card.disabled = cardDef.missing;
    card.className =
      'part-card' +
      (pendingPart === id ? ' active' : '') +
      (selected && mount?.jointId === selected ? ' mounted-sel' : '') +
      (cardDef.missing ? ' missing' : '');
    card.innerHTML = `
      <div class="role">${escapeHtml(cardDef.roleName)}</div>
      <div class="id">${escapeHtml(cardDef.missing ? '未绑定' : id)} · ${escapeHtml(spec.kindLabel)}</div>
      <div class="meta">引脚 ${escapeHtml(spec.pins.join(' / '))}</div>
      <div class="meta">${escapeHtml(spec.protocol)}</div>
      <div class="q" data-q="${escapeHtml(id)}">${
        cardDef.missing
          ? `建议补 ${escapeHtml(spec.kindLabel)}`
          : pose
            ? `元件 ${pose.q.toFixed(1)}°${pose.spinning ? ` · ${pose.spinning === 'rev' ? '反转' : '正转'}` : ''}`
            : `量程 ${escapeHtml(spec.range)}`
      }</div>
      <div class="bound">${
        cardDef.missing
          ? '缺件'
          : mount && joint
            ? `→ ${escapeHtml(joint.name)} <code>${escapeHtml(joint.id)}</code><br/>轴 ${escapeHtml(formatAxis(joint))} · 零位 ${mount.qOffsetDeg ?? joint.qOffsetDeg ?? 0}° · ×${mount.qScale ?? 1}${
                jq !== null ? `<br/>关节 ${jq.toFixed(1)}°` : ''
              }`
            : '未装配'
      }</div>`;
    card.addEventListener('click', () => {
      if (cardDef.missing) return;
      const jointId = vp.getSelectedJoint();
      if (jointId) {
        pendingPart = null;
        vp.bindJoint(id, jointId);
        return;
      }
      pendingPart = id;
      status.textContent = `已选 ${cardDef.roleName}（${id}），再点画布关节球`;
      renderParts(vp.getMounts(), kitMechanism(mechSel.value));
    });
    partsEl.appendChild(card);
  }
}

function patchLiveQ(): void {
  for (const pose of actuatorBus.snapshot()) {
    const el = partsEl.querySelector(`[data-q="${pose.id}"]`);
    if (!el) continue;
    const spin = pose.spinning ? ` · ${pose.spinning === 'rev' ? '反转' : '正转'}` : '';
    el.textContent = `元件 ${pose.q.toFixed(1)}°${spin}`;
  }
}

vp.onMounts((mounts, mechId) => {
  renderParts(mounts, mechId);
});
renderParts(vp.getMounts(), kitMechanism(mechSel.value));

vp.onPick((jointId) => {
  if (jointId && pendingPart) {
    vp.bindJoint(pendingPart, jointId);
    pendingPart = null;
    return;
  }
  status.textContent = jointId ? `关节 ${jointId} · 点左侧执行元件装配` : '点白色关节球，再点左侧执行元件';
  renderParts(vp.getMounts(), kitMechanism(mechSel.value));
});

mechSel.addEventListener('change', () => {
  pendingPart = null;
  vp.applyKit(mechSel.value, lastActuators);
  fillAssemblies(kitMechanism(mechSel.value));
  localStorage.setItem('velxio.3dm.mech', mechSel.value);
});

genSel.addEventListener('change', () => {
  const token = genSel.value;
  genSel.value = '';
  if (!token) return;
  pendingPart = null;
  applyGenerated(generatePreset(token));
});

asmSel.addEventListener('change', () => {
  pendingPart = null;
  vp.setAssembly(asmSel.value || null);
});

let mockOn = false;
function setMock(on: boolean) {
  mockOn = on;
  vp.playMock(on);
  mockBtn.classList.toggle('active', on);
  mockBtn.textContent = on ? '停止 Mock' : 'Mock 回放';
}
mockBtn.addEventListener('click', () => setMock(!mockOn));
invertBtn.addEventListener('click', () => vp.invertSelected());
if (mockDefault || embed === false) {
  if (!embed) setMock(true);
}

let lastPaint = 0;
actuatorBus.subscribe((pose, snap) => {
  const now = performance.now();
  if (now - lastPaint > 80) {
    lastPaint = now;
    patchLiveQ();
  }
  if (!pendingPart && !vp.getSelectedJoint()) {
    status.textContent = `${actuatorRole(pose.id)} ${pose.q.toFixed(1)}°  n=${snap.length}`;
  }
});

window.addEventListener('message', (ev: MessageEvent) => {
  const data = ev.data as {
    type?: string;
    pose?: Parameters<typeof vp.ingest>[0];
    mech?: string;
    kit?: string;
    assembly?: string;
    actuators?: CanvasActuator[];
    generated?: GeneratedKit;
    token?: string;
  };
  if (data?.type === 'velxio.3dm.pose' && data.pose) {
    if (mockOn) setMock(false);
    vp.ingest(data.pose);
  }
  if (data?.type === 'velxio.3dm.register' && data.generated) {
    lastActuators = data.actuators ?? lastActuators;
    applyGenerated(data.generated);
  }
  if (data?.type === 'velxio.3dm.generate' && data.token) {
    lastActuators = data.actuators ?? lastActuators;
    applyGenerated(generatePreset(data.token));
  }
  if (data?.type === 'velxio.3dm.kit' && data.kit) {
    lastActuators = data.actuators ?? lastActuators;
    mechSel.value = data.kit;
    fillAssemblies(kitMechanism(data.kit));
    vp.applyKit(data.kit, lastActuators);
    log.info('kit.embed', { phase: 'p2', kit_id: data.kit, from_canvas: lastActuators.length });
  }
  if (data?.type === 'velxio.3dm.actuators') {
    lastActuators = data.actuators ?? [];
    vp.applyKit(mechSel.value, lastActuators);
  }
  if (data?.type === 'velxio.3dm.mech' && data.mech) {
    mechSel.value = data.mech;
    fillAssemblies(kitMechanism(data.mech));
    vp.applyKit(data.mech, lastActuators);
  }
  if (data?.type === 'velxio.3dm.assembly') {
    fillAssemblies(kitMechanism(mechSel.value), data.assembly);
    vp.setAssembly(data.assembly || null);
  }
});

log.info('app.ready', { phase: 'p1', embed, kit_id: mechSel.value, assembly: asmSel.value });
