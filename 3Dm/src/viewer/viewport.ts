import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  assemblyFromBinds,
  assignMount,
  bindMechanism,
  mountsFromMechanism,
  toggleMountScale,
} from '../core/assemble.js';
import { loadAssembly } from '../core/assembly-catalog.js';
import { actuatorBus } from '../core/bus.js';
import { detectMechanismId, loadMechanism } from '../core/catalog.js';
import { loadKit, suggestBinds, type CanvasActuator } from '../core/kit.js';
import { forwardKinematics } from '../core/kinematics.js';
import { log } from '../core/log.js';
import { mockPoseAt } from '../core/mock.js';
import type { ActuatorPose, MechanismDef, MountDef } from '../core/types.js';
import {
  applyFk,
  buildMechanism,
  collectJointHits,
  disposeNodes,
  setHitHighlight,
} from './scene.js';
import { attachXR, type XrHandle } from './xr.js';

export type PickListener = (jointId: string | null) => void;
export type MountListener = (mounts: MountDef[], mechId: string) => void;

export interface ViewportHandle {
  setMechanism: (id: string) => void;
  setAssembly: (id: string | null) => void;
  applyKit: (kitId: string, actuators?: CanvasActuator[]) => void;
  bindJoint: (componentId: string, jointId?: string) => void;
  invertSelected: () => void;
  setMounts: (next: MountDef[]) => void;
  getMounts: () => MountDef[];
  getSelectedJoint: () => string | null;
  getKitId: () => string;
  onPick: (fn: PickListener) => void;
  onMounts: (fn: MountListener) => void;
  playMock: (on: boolean) => void;
  ingest: (pose: ActuatorPose) => void;
  dispose: () => void;
}

export function mountViewport(host: HTMLElement, initialMech = '4dof-arm'): ViewportHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 20);
  camera.position.set(0.35, -0.45, 0.32);
  camera.up.set(0, 0, 1);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.xr.enabled = false;
  host.appendChild(renderer.domElement);

  const hud = document.createElement('div');
  hud.className = 'joint-hud';
  host.appendChild(hud);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.08, 0, 0.06);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(0.4, -0.3, 0.8);
  scene.add(sun);
  const grid = new THREE.GridHelper(1.2, 24, 0x334155, 0x1e2937);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);
  scene.add(new THREE.AxesHelper(0.12));

  let templateId = initialMech;
  let kitId = initialMech;
  let assemblyId: string | null = null;
  let template = loadMechanism(templateId);
  let mounts: MountDef[] = mountsFromMechanism(template);
  let mech: MechanismDef = bindLive();
  let nodes = buildMechanism(scene, mech);
  let selectedJoint: string | null = null;
  let hoverJoint: string | null = null;
  const pickFns: PickListener[] = [];
  const mountFns: MountListener[] = [];

  function bindLive(): MechanismDef {
    const src = loadMechanism(templateId);
    if (!mounts.length) return src;
    try {
      return bindMechanism(src, assemblyFromBinds(templateId, mounts, assemblyId ?? 'canvas'));
    } catch (err) {
      log.error('mech.set', { phase: 'p2', error: String(err) });
      return src;
    }
  }

  function emitMounts(): void {
    for (const fn of mountFns) fn(mounts, templateId);
  }

  function emitPick(): void {
    for (const fn of pickFns) fn(selectedJoint);
  }

  function rebuildMeshes(): void {
    disposeNodes(scene, nodes);
    mech = bindLive();
    nodes = buildMechanism(scene, mech);
    log.info('mech.set', { phase: 'p2', mech_id: mech.id, assembly_id: assemblyId ?? 'canvas' });
    emitMounts();
  }

  function applyMountsOnly(): void {
    mech = bindLive();
    log.info('assemble.canvas', { phase: 'p2', mech_id: mech.id, mounts: mounts.length });
    emitMounts();
  }

  const resize = () => {
    const w = host.clientWidth || 640;
    const h = host.clientHeight || 400;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  let mockOn = false;
  let mockT0 = performance.now();
  let lastFkEe = '';

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const ndc = new THREE.Vector3();

  function hits(): THREE.Mesh[] {
    return collectJointHits(scene);
  }

  function hitFromEvent(ev: PointerEvent): THREE.Mesh | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const found = raycaster.intersectObjects(hits(), false);
    return (found[0]?.object as THREE.Mesh) ?? null;
  }

  function paintHits(): void {
    for (const mesh of hits()) {
      if (!String(mesh.name).startsWith('hit:')) continue;
      const id = String(mesh.userData.jointId ?? '');
      setHitHighlight(mesh, id === selectedJoint || id === hoverJoint);
    }
  }

  function projectLabels(): void {
    hud.innerHTML = '';
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    for (const j of mech.joints) {
      const obj = nodes.get(j.child);
      if (!obj) continue;
      ndc.copy(obj.position).project(camera);
      if (ndc.z > 1) continue;
      const el = document.createElement('span');
      el.className = 'joint-label' + (j.id === selectedJoint ? ' selected' : '');
      el.textContent = `${j.name} · ${j.componentId || '未装'}${j.qScale === -1 ? ' −' : ''}`;
      el.style.left = `${((ndc.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - ndc.y) / 2) * h}px`;
      hud.appendChild(el);
    }
  }

  const tick = (time: number) => {
    if (mockOn) {
      const tSec = (time - mockT0) / 1000;
      for (const p of mockPoseAt(mech, tSec)) actuatorBus.publish(p);
    }
    const snap = actuatorBus.snapshot();
    if (snap.length) {
      const fk = forwardKinematics(mech, snap);
      applyFk(nodes, fk);
      const key = fk.ee?.xyz.map((n) => n.toFixed(3)).join(',') ?? '';
      if (key !== lastFkEe) {
        lastFkEe = key;
        log.debug('fk.ee', { phase: 'p2', mech_id: mech.id, ee: fk.ee?.xyz });
      }
    }
    paintHits();
    projectLabels();
    controls.update();
    renderer.render(scene, camera);
  };

  renderer.setAnimationLoop(tick);

  let xr: XrHandle | null = null;
  const startXr = () => {
    xr?.detach();
    xr = attachXR(renderer, host, tick);
  };
  startXr();

  let downX = 0;
  let downY = 0;
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    downX = ev.clientX;
    downY = ev.clientY;
  });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    const mesh = hitFromEvent(ev);
    hoverJoint = mesh ? String(mesh.userData.jointId) : null;
    renderer.domElement.style.cursor = hoverJoint ? 'pointer' : 'grab';
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6) return;
    const mesh = hitFromEvent(ev);
    selectedJoint = mesh ? String(mesh.userData.jointId) : null;
    log.info('assemble.pick', { phase: 'p2', joint_id: selectedJoint ?? '' });
    emitPick();
  });
  renderer.domElement.addEventListener('dblclick', (ev) => {
    const mesh = hitFromEvent(ev);
    if (!mesh) return;
    ev.preventDefault();
    mounts = toggleMountScale(mounts, String(mesh.userData.jointId));
    assemblyId = 'canvas';
    applyMountsOnly();
  });

  const unsub = actuatorBus.subscribe((pose) => {
    const ids = actuatorBus.snapshot().map((p) => p.id);
    const guessed = detectMechanismId(ids);
    if (guessed !== templateId && pose.id !== 'servo-1') {
      if (templateId === 'servo-sweep' && guessed !== 'servo-sweep') {
        templateId = guessed;
        template = loadMechanism(templateId);
        mounts = mountsFromMechanism(template);
        assemblyId = null;
        rebuildMeshes();
        log.info('mech.auto', { phase: 'p2', mech_id: guessed });
      }
    }
  });

  log.info('viewport.mount', { phase: 'p1', mech_id: mech.id });
  emitMounts();

  return {
    setMechanism(id: string) {
      templateId = id;
      kitId = id;
      template = loadMechanism(id);
      mounts = mountsFromMechanism(template);
      assemblyId = null;
      selectedJoint = null;
      rebuildMeshes();
      actuatorBus.clear();
      emitPick();
    },
    setAssembly(id: string | null) {
      assemblyId = id;
      template = loadMechanism(templateId);
      mounts = id ? loadAssembly(id).mounts.map((m) => ({ ...m })) : mountsFromMechanism(template);
      applyMountsOnly();
    },
    applyKit(id: string, actuators: CanvasActuator[] = []) {
      const kit = loadKit(id);
      kitId = kit.id;
      templateId = kit.mechanismId;
      template = loadMechanism(templateId);
      assemblyId = kit.assemblyId || null;
      if (actuators.length) {
        const suggested = suggestBinds(kit, actuators);
        mounts = suggested.mounts.length ? suggested.mounts : mountsFromMechanism(template);
      } else if (kit.assemblyId) {
        mounts = loadAssembly(kit.assemblyId).mounts.map((m) => ({ ...m }));
      } else {
        mounts = mountsFromMechanism(template);
      }
      selectedJoint = null;
      rebuildMeshes();
      log.info('kit.apply', {
        phase: 'p2',
        kit_id: kit.id,
        mech_id: templateId,
        mounts: mounts.length,
        from_canvas: actuators.length,
      });
      emitPick();
    },
    bindJoint(componentId: string, jointId?: string) {
      const target = jointId ?? selectedJoint;
      if (!target) {
        log.warn('assemble.canvas', { phase: 'p2', error: '未选关节' });
        return;
      }
      mounts = assignMount(mounts, target, componentId);
      assemblyId = 'canvas';
      applyMountsOnly();
    },
    invertSelected() {
      if (!selectedJoint) return;
      mounts = toggleMountScale(mounts, selectedJoint);
      assemblyId = 'canvas';
      applyMountsOnly();
    },
    setMounts(next: MountDef[]) {
      mounts = next.map((m) => ({ ...m }));
      assemblyId = 'canvas';
      applyMountsOnly();
    },
    getMounts: () => mounts.map((m) => ({ ...m })),
    getSelectedJoint: () => selectedJoint,
    getKitId: () => kitId,
    onPick: (fn) => {
      pickFns.push(fn);
    },
    onMounts: (fn) => {
      mountFns.push(fn);
    },
    playMock(on: boolean) {
      mockOn = on;
      mockT0 = performance.now();
      log.info('mock.toggle', { phase: 'p0', on, mech_id: mech.id });
    },
    ingest(pose: ActuatorPose) {
      actuatorBus.publish(pose);
    },
    dispose() {
      unsub();
      xr?.detach();
      ro.disconnect();
      renderer.setAnimationLoop(null);
      disposeNodes(scene, nodes);
      renderer.dispose();
      renderer.domElement.remove();
      hud.remove();
    },
  };
}
