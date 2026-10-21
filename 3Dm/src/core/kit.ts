import type { ActuatorKind, KitDef, KitRole, MountDef } from './types.js';
import { log } from './log.js';
import { builtinGenerated } from './generate.js';

/** 画布上的执行器（不含电机驱动板）。 */
export interface CanvasActuator {
  id: string;
  kind: ActuatorKind;
}

export type BindStatus = 'bound' | 'missing' | 'kind_mismatch';

export interface BindSuggestion {
  role: string;
  name: string;
  jointId: string;
  preferKind: ActuatorKind;
  componentId?: string;
  status: BindStatus;
}

export interface SuggestResult {
  mounts: MountDef[];
  suggestions: BindSuggestion[];
  extras: CanvasActuator[];
}

const KITS: Record<string, KitDef> = {
  'servo-sweep': {
    id: 'servo-sweep',
    name: '单舵机扫摆',
    mechanismId: 'servo-sweep',
    assemblyId: '',
    roles: [
      {
        role: 'horn',
        name: '扫摆',
        jointId: 'j_servo',
        preferKind: 'servo',
        aliases: ['servo-1', 'servo'],
      },
    ],
  },
  'arm-3dof': {
    id: 'arm-3dof',
    name: '三轴机械臂',
    mechanismId: 'arm-3dof',
    assemblyId: 'arm-3dof-default',
    roles: [
      {
        role: 'base',
        name: '基座',
        jointId: 'j_base',
        preferKind: 'servo',
        aliases: ['sv_base'],
        qOffsetDeg: -90,
      },
      {
        role: 'shoulder',
        name: '肩',
        jointId: 'j_shld',
        preferKind: 'servo',
        aliases: ['sv_shld'],
        qOffsetDeg: -90,
      },
      {
        role: 'elbow',
        name: '肘',
        jointId: 'j_elbw',
        preferKind: 'servo',
        aliases: ['sv_elbw'],
        qOffsetDeg: -90,
      },
    ],
  },
  '4dof-arm': {
    id: '4dof-arm',
    name: '四自由度机械臂',
    mechanismId: '4dof-arm',
    assemblyId: 'arm-default',
    roles: [
      {
        role: 'base',
        name: '基座',
        jointId: 'j_base',
        preferKind: 'servo',
        aliases: ['sv_base'],
        qOffsetDeg: -90,
      },
      {
        role: 'shoulder',
        name: '肩',
        jointId: 'j_shld',
        preferKind: 'servo',
        aliases: ['sv_shld'],
        qOffsetDeg: -90,
      },
      {
        role: 'elbow',
        name: '肘',
        jointId: 'j_elbw',
        preferKind: 'servo',
        aliases: ['sv_elbw'],
        qOffsetDeg: -90,
      },
      {
        role: 'grip',
        name: '夹爪',
        jointId: 'j_grip',
        preferKind: 'servo',
        aliases: ['sv_grip'],
        qOffsetDeg: -70,
      },
    ],
  },
  'car-2wd': {
    id: 'car-2wd',
    name: '两驱小车',
    mechanismId: 'car-2wd',
    assemblyId: 'car-2wd-default',
    roles: [
      { role: 'left', name: '左轮', jointId: 'j_l', preferKind: 'dc-motor', aliases: ['m_l'] },
      { role: 'right', name: '右轮', jointId: 'j_r', preferKind: 'dc-motor', aliases: ['m_r'] },
    ],
  },
  '4wd-chassis': {
    id: '4wd-chassis',
    name: '四驱底盘',
    mechanismId: '4wd-chassis',
    assemblyId: '4wd-default',
    roles: [
      { role: 'fl', name: '左前轮', jointId: 'j_fl', preferKind: 'dc-motor', aliases: ['m_fl'] },
      { role: 'fr', name: '右前轮', jointId: 'j_fr', preferKind: 'dc-motor', aliases: ['m_fr'] },
      { role: 'rl', name: '左后轮', jointId: 'j_rl', preferKind: 'dc-motor', aliases: ['m_rl'] },
      { role: 'rr', name: '右后轮', jointId: 'j_rr', preferKind: 'dc-motor', aliases: ['m_rr'] },
    ],
  },
};

export function listKitIds(): string[] {
  return Object.keys(KITS);
}

export function listKits(): KitDef[] {
  return listKitIds().map((id) => KITS[id]);
}

export function loadKit(id: string): KitDef {
  const kit = KITS[id];
  if (!kit) throw new Error(`未知模型组合: ${id}`);
  return kit;
}

function isMotorId(id: string): boolean {
  return id.startsWith('m_') || id.includes('dc');
}

/** 按画布元件 id 猜测 Kit。视觉臂有夹爪时仍映射四轴臂；三角色舵机无夹爪走三轴臂。 */
export function detectKitId(componentIds: string[]): string {
  const set = new Set(componentIds);
  if (set.has('m_fl') || set.has('m_fr') || set.has('m_rl') || set.has('m_rr')) return '4wd-chassis';
  if (set.has('m_l') || set.has('m_r')) return 'car-2wd';
  if (set.has('sv_grip')) return '4dof-arm';
  if (set.has('sv_base') && set.has('sv_shld') && set.has('sv_elbw')) return 'arm-3dof';
  if (set.has('sv_base') || set.has('sv_shld')) return '4dof-arm';
  if (set.has('sv_head') || set.has('sv_shld_l') || set.has('sv_elbw_l')) return 'humanoid-lite';
  if (set.has('sv_lf') || set.has('sv_rf') || set.has('sv_lr') || set.has('sv_rr')) return 'quad-4dof';
  if (set.has('sv_elbw')) return 'arm-3dof';
  const motors = componentIds.filter(isMotorId);
  if (motors.length >= 4) return '4wd-chassis';
  if (motors.length >= 2) return 'car-2wd';
  const servos = componentIds.filter((id) => !isMotorId(id) && (id.startsWith('sv_') || id.includes('servo')));
  if (servos.length >= 5) return 'humanoid-lite';
  if (servos.length === 4) return 'quad-4dof';
  if (servos.length >= 3) return 'arm-3dof';
  return 'servo-sweep';
}

function kindCompatible(prefer: ActuatorKind, actual: ActuatorKind): boolean {
  if (prefer === actual) return true;
  if (prefer === 'servo' && actual === 'stepper') return true;
  if (prefer === 'stepper' && actual === 'servo') return true;
  return false;
}

function takeExact(role: KitRole, pool: CanvasActuator[], used: Set<string>): CanvasActuator | undefined {
  return pool.find((a) => !used.has(a.id) && role.aliases.includes(a.id));
}

function takeByKind(role: KitRole, pool: CanvasActuator[], used: Set<string>): CanvasActuator | undefined {
  return pool.find((a) => !used.has(a.id) && kindCompatible(role.preferKind, a.kind));
}

/**
 * 按角色装配：精确 id → 同种类顺序填入。缺件列入 suggestions，不发明元件。
 */
export function suggestBinds(kit: KitDef, actuators: CanvasActuator[]): SuggestResult {
  const used = new Set<string>();
  const suggestions: BindSuggestion[] = [];
  const mounts: MountDef[] = [];

  for (const role of kit.roles) {
    const hit = takeExact(role, actuators, used) ?? takeByKind(role, actuators, used);
    if (!hit) {
      suggestions.push({
        role: role.role,
        name: role.name,
        jointId: role.jointId,
        preferKind: role.preferKind,
        status: 'missing',
      });
      continue;
    }
    used.add(hit.id);
    const ok = kindCompatible(role.preferKind, hit.kind);
    suggestions.push({
      role: role.role,
      name: role.name,
      jointId: role.jointId,
      preferKind: role.preferKind,
      componentId: hit.id,
      status: ok ? 'bound' : 'kind_mismatch',
    });
    mounts.push({
      componentId: hit.id,
      jointId: role.jointId,
      kind: hit.kind,
      qOffsetDeg: role.qOffsetDeg,
      qScale: role.qScale,
    });
  }

  const extras = actuators.filter((a) => !used.has(a.id));
  log.info('kit.suggest', {
    phase: 'p2',
    kit_id: kit.id,
    bound: suggestions.filter((s) => s.status === 'bound').length,
    missing: suggestions.filter((s) => s.status === 'missing').length,
    extras: extras.length,
  });
  return { mounts, suggestions, extras };
}

const META: Record<ActuatorKind, string> = {
  servo: 'servo',
  stepper: 'stepper-motor',
  'dc-motor': 'dc-motor',
};

export interface BomPart {
  id: string;
  kind: ActuatorKind;
  metadataId: string;
  name: string;
}

/** 缺件 BOM：角色别名作画布 id，元件只来自 OSS 目录（servo / dc-motor / stepper）。 */
export function missingBom(kit: KitDef, actuators: CanvasActuator[], existingIds: string[] = []): BomPart[] {
  const taken = new Set([...existingIds, ...actuators.map((a) => a.id)]);
  const missing = suggestBinds(kit, actuators).suggestions.filter((s) => s.status === 'missing');
  return missing.map((s) => {
    const role = kit.roles.find((r) => r.role === s.role);
    const base = role?.aliases[0] ?? s.role;
    let id = base;
    let n = 2;
    while (taken.has(id)) {
      id = `${base}_${n}`;
      n += 1;
    }
    taken.add(id);
    return {
      id,
      kind: s.preferKind,
      metadataId: META[s.preferKind],
      name: s.name,
    };
  });
}

export function registerKit(kit: KitDef): void {
  KITS[kit.id] = kit;
  log.info('kit.register', { phase: 'p2', kit_id: kit.id, roles: kit.roles.length });
}

for (const g of builtinGenerated()) {
  registerKit(g.kit);
}

export { KITS };
export type { KitDef, KitRole };
