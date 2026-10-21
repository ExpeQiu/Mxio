import { log } from './log.js';
import type {
  AssembleIssue,
  AssemblyDef,
  MechanismDef,
  MountDef,
  Origin,
  Vec3,
} from './types.js';

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function addOrigin(base: Origin, extra?: Origin): Origin {
  if (!extra) return base;
  return { xyz: addVec(base.xyz, extra.xyz), rpy: addVec(base.rpy, extra.rpy) };
}

const JOINT_KIND: Record<string, Set<string>> = {
  revolute: new Set(['servo', 'stepper']),
  continuous: new Set(['dc-motor', 'stepper', 'servo']),
  prismatic: new Set(['servo', 'stepper']),
  fixed: new Set(['servo', 'stepper', 'dc-motor']),
};

export function validateAssembly(mech: MechanismDef, assembly: AssemblyDef): AssembleIssue[] {
  const issues: AssembleIssue[] = [];
  if (assembly.mechanismId !== mech.id) {
    issues.push({
      level: 'error',
      code: 'mech_mismatch',
      message: `装配 ${assembly.id} 针对 ${assembly.mechanismId}，不是 ${mech.id}`,
    });
  }
  const jointIds = new Set(mech.joints.map((j) => j.id));
  const seenJoint = new Set<string>();
  const seenPart = new Set<string>();
  for (const m of assembly.mounts) {
    if (!jointIds.has(m.jointId)) {
      issues.push({
        level: 'error',
        code: 'unknown_joint',
        message: `关节不存在: ${m.jointId}`,
        jointId: m.jointId,
        componentId: m.componentId,
      });
    }
    if (seenJoint.has(m.jointId)) {
      issues.push({
        level: 'error',
        code: 'dup_joint',
        message: `关节重复装配: ${m.jointId}`,
        jointId: m.jointId,
      });
    }
    seenJoint.add(m.jointId);
    if (seenPart.has(m.componentId)) {
      issues.push({
        level: 'error',
        code: 'dup_part',
        message: `元件重复装配: ${m.componentId}`,
        componentId: m.componentId,
      });
    }
    seenPart.add(m.componentId);
    const joint = mech.joints.find((j) => j.id === m.jointId);
    if (joint && m.kind && !JOINT_KIND[joint.type]?.has(m.kind)) {
      issues.push({
        level: 'warn',
        code: 'kind_mismatch',
        message: `${m.kind} 不宜驱动 ${joint.type} 关节 ${m.jointId}`,
        jointId: m.jointId,
        componentId: m.componentId,
      });
    }
  }
  return issues;
}

export function parseBindSpec(spec: string): MountDef[] {
  if (!spec.trim()) return [];
  return spec.split(',').map((part) => {
    const [componentId, jointId] = part.split('=').map((s) => s.trim());
    if (!componentId || !jointId) throw new Error(`无效 --bind: ${part}（应为 元件=关节）`);
    return { componentId, jointId };
  });
}

export function assemblyFromBinds(mechId: string, mounts: MountDef[], id = 'inline'): AssemblyDef {
  return { id, name: id, mechanismId: mechId, mounts };
}

export function mountsFromMechanism(mech: MechanismDef): MountDef[] {
  return mech.joints
    .filter((j) => j.componentId && j.componentId !== '*')
    .map((j) => ({
      componentId: j.componentId,
      jointId: j.id,
      qOffsetDeg: j.qOffsetDeg,
      qScale: j.qScale,
    }));
}

/** 画布装配：把元件装到关节；目标已有元件则对调。 */
export function assignMount(mounts: MountDef[], jointId: string, componentId: string): MountDef[] {
  const next = mounts.map((m) => ({ ...m }));
  const atJoint = next.find((m) => m.jointId === jointId);
  const atPart = next.find((m) => m.componentId === componentId);
  if (atPart && atJoint && atPart !== atJoint) {
    const prev = atJoint.componentId;
    atJoint.componentId = componentId;
    atPart.componentId = prev;
    return next;
  }
  if (atPart && !atJoint) {
    atPart.jointId = jointId;
    return next;
  }
  if (atJoint) {
    atJoint.componentId = componentId;
    return next;
  }
  next.push({ jointId, componentId });
  return next;
}

export function toggleMountScale(mounts: MountDef[], jointId: string): MountDef[] {
  return mounts.map((m) => {
    if (m.jointId !== jointId) return m;
    const scale = m.qScale ?? 1;
    return { ...m, qScale: scale < 0 ? 1 : -1 };
  });
}

/** 把装配打进机构副本：改 componentId / 零位 / 传动比 / 安装偏置，从而改正解。 */
export function bindMechanism(mech: MechanismDef, assembly: AssemblyDef): MechanismDef {
  const issues = validateAssembly(mech, assembly);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
  for (const w of issues) {
    log.warn('assemble.warn', { phase: 'p2', code: w.code, joint_id: w.jointId, component_id: w.componentId });
  }

  const byJoint = new Map(assembly.mounts.map((m) => [m.jointId, m]));
  const joints = mech.joints.map((j) => {
    const m = byJoint.get(j.id);
    if (!m) {
      return { ...j, origin: { ...j.origin, xyz: [...j.origin.xyz] as Vec3, rpy: [...j.origin.rpy] as Vec3 } };
    }
    return {
      ...j,
      componentId: m.componentId,
      qOffsetDeg: m.qOffsetDeg ?? j.qOffsetDeg,
      qScale: m.qScale ?? j.qScale,
      origin: addOrigin(j.origin, m.origin),
    };
  });

  const childOf = new Map(joints.map((j) => [j.child, j]));
  const wheels = mech.wheels?.map((w) => {
    const joint = childOf.get(w.linkId);
    if (!joint?.componentId) return w;
    return { ...w, componentId: joint.componentId };
  });

  log.info('assemble.bind', {
    phase: 'p2',
    mech_id: mech.id,
    assembly_id: assembly.id,
    mounts: assembly.mounts.length,
  });

  return {
    ...mech,
    id: `${mech.id}#${assembly.id}`,
    name: `${mech.name} / ${assembly.name}`,
    joints,
    wheels,
  };
}
