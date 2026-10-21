import type {
  ActuatorKind,
  AssemblyDef,
  JointDef,
  KitDef,
  KitRole,
  LinkDef,
  MechanismDef,
  Origin,
  Vec3,
} from './types.js';

export type GenerateKind = 'serial' | 'wheeled' | 'quadruped' | 'humanoid';

export interface GenerateSpec {
  kind: GenerateKind;
  id?: string;
  name?: string;
  /** 串联关节数，或轮数 */
  n?: number;
  legs?: number;
  dofPerLeg?: number;
  linkLength?: number;
}

export interface GeneratedKit {
  kit: KitDef;
  mechanism: MechanismDef;
  assembly: AssemblyDef;
}

const PI2 = Math.PI / 2;

function origin(xyz: Vec3, rpy: Vec3 = [0, 0, 0]): Origin {
  return { xyz, rpy };
}

function role(
  roleId: string,
  name: string,
  jointId: string,
  preferKind: ActuatorKind,
  aliases: string[],
  extra: Partial<KitRole> = {},
): KitRole {
  return { role: roleId, name, jointId, preferKind, aliases, ...extra };
}

function pack(mech: MechanismDef, roles: KitRole[], name: string): GeneratedKit {
  const mounts = roles.map((r) => ({
    componentId: r.aliases[0],
    jointId: r.jointId,
    kind: r.preferKind,
    qOffsetDeg: r.qOffsetDeg,
    qScale: r.qScale,
  }));
  const kit: KitDef = {
    id: mech.id,
    name,
    mechanismId: mech.id,
    assemblyId: `${mech.id}-default`,
    roles,
  };
  const assembly: AssemblyDef = {
    id: kit.assemblyId,
    name: `${name}默认装配`,
    mechanismId: mech.id,
    mounts,
  };
  return { kit, mechanism: mech, assembly };
}

function serialArm(spec: GenerateSpec): GeneratedKit {
  const n = Math.max(2, Math.min(8, Math.round(spec.n ?? 3)));
  const len = spec.linkLength ?? 0.08;
  const id = spec.id ?? `serial-${n}`;
  const name = spec.name ?? `串联 ${n} 轴臂`;
  const links: LinkDef[] = [{ id: 'world', length: 0 }];
  const joints: JointDef[] = [];
  const roles: KitRole[] = [];
  for (let i = 1; i <= n; i++) {
    const lid = `l${i}`;
    const jid = `j${i}`;
    const cid = `sv_j${i}`;
    links.push({
      id: lid,
      length: i === 1 ? 0.05 : len,
      radius: i === 1 ? 0.024 : 0.012,
      color: i === 1 ? '#64748b' : i % 2 ? '#38bdf8' : '#22c55e',
    });
    const yaw = i === 1;
    joints.push({
      id: jid,
      name: i === 1 ? '基座' : i === n ? '末端' : `轴${i}`,
      type: 'revolute',
      parent: i === 1 ? 'world' : `l${i - 1}`,
      child: lid,
      origin: i === 1 ? origin([0, 0, 0.02]) : origin([i === 2 ? 0.05 : len, 0, 0]),
      axis: yaw ? [0, 0, 1] : [0, 1, 0],
      componentId: cid,
      qOffsetDeg: 0,
      qScale: 1,
    });
    roles.push(role(`j${i}`, joints[joints.length - 1].name, jid, 'servo', [cid]));
  }
  const mech: MechanismDef = { id, name, kind: 'serial', links, joints };
  return pack(mech, roles, name);
}

function wheeled(spec: GenerateSpec): GeneratedKit {
  const n = spec.n === 4 ? 4 : 2;
  const id = spec.id ?? `wheeled-${n}`;
  const name = spec.name ?? (n === 4 ? '四驱底盘' : '两驱小车');
  const links: LinkDef[] = [
    { id: 'world', length: 0 },
    { id: 'chassis', length: 0.22, radius: 0.04, color: '#334155', shape: 'box', box: [0.22, 0.14, 0.04] },
  ];
  const joints: JointDef[] = [
    {
      id: 'j_chassis',
      name: '车体',
      type: 'fixed',
      parent: 'world',
      child: 'chassis',
      origin: origin([0, 0, 0.03]),
      axis: [0, 0, 1],
      componentId: '*',
    },
  ];
  const roles: KitRole[] = [];
  const wheels: { componentId: string; linkId: string; radius: number }[] = [];
  const slots =
    n === 4
      ? [
          { id: 'fl', name: '左前轮', xyz: [0.08, 0.07, 0] as Vec3, cid: 'm_fl' },
          { id: 'fr', name: '右前轮', xyz: [0.08, -0.07, 0] as Vec3, cid: 'm_fr' },
          { id: 'rl', name: '左后轮', xyz: [-0.08, 0.07, 0] as Vec3, cid: 'm_rl' },
          { id: 'rr', name: '右后轮', xyz: [-0.08, -0.07, 0] as Vec3, cid: 'm_rr' },
        ]
      : [
          { id: 'l', name: '左轮', xyz: [-0.07, 0.07, 0] as Vec3, cid: 'm_l' },
          { id: 'r', name: '右轮', xyz: [-0.07, -0.07, 0] as Vec3, cid: 'm_r' },
        ];
  for (const s of slots) {
    const lid = `w_${s.id}`;
    links.push({ id: lid, length: 0.02, radius: 0.03, color: '#1f2937' });
    joints.push({
      id: `j_${s.id}`,
      name: s.name,
      type: 'continuous',
      parent: 'chassis',
      child: lid,
      origin: origin(s.xyz, [PI2, 0, 0]),
      axis: [0, 0, 1],
      componentId: s.cid,
    });
    roles.push(role(s.id, s.name, `j_${s.id}`, 'dc-motor', [s.cid]));
    wheels.push({ componentId: s.cid, linkId: lid, radius: 0.03 });
  }
  if (n === 2) {
    links.push({ id: 'w_cast', length: 0.016, radius: 0.018, color: '#475569' });
    joints.push({
      id: 'j_cast',
      name: '前轮脚轮',
      type: 'fixed',
      parent: 'chassis',
      child: 'w_cast',
      origin: origin([0.08, 0, -0.008], [PI2, 0, 0]),
      axis: [0, 0, 1],
      componentId: '',
    });
  }
  const mech: MechanismDef = { id, name, kind: 'vehicle', links, joints, wheels };
  return pack(mech, roles, name);
}

const LEGS = [
  { id: 'lf', name: '左前', xyz: [0.06, 0.045, 0] as Vec3 },
  { id: 'rf', name: '右前', xyz: [0.06, -0.045, 0] as Vec3 },
  { id: 'lr', name: '左后', xyz: [-0.06, 0.045, 0] as Vec3 },
  { id: 'rr', name: '右后', xyz: [-0.06, -0.045, 0] as Vec3 },
];

function quadruped(spec: GenerateSpec): GeneratedKit {
  const legs = Math.max(2, Math.min(4, Math.round(spec.legs ?? 4)));
  const dof = spec.dofPerLeg === 2 ? 2 : 1;
  const thigh = spec.linkLength ?? 0.07;
  const id = spec.id ?? `quad-${legs}x${dof}`;
  const name = spec.name ?? (dof === 1 ? '四轴机器狗' : `${legs} 腿 × ${dof} 轴机器狗`);
  const links: LinkDef[] = [
    { id: 'world', length: 0 },
    { id: 'body', length: 0.16, radius: 0.03, color: '#475569', shape: 'box', box: [0.16, 0.1, 0.04] },
  ];
  const joints: JointDef[] = [
    {
      id: 'j_body',
      name: '躯干',
      type: 'fixed',
      parent: 'world',
      child: 'body',
      origin: origin([0, 0, 0.1]),
      axis: [0, 0, 1],
      componentId: '',
    },
  ];
  const roles: KitRole[] = [];
  const chosen = LEGS.slice(0, legs);
  for (const leg of chosen) {
    const hipId = `thigh_${leg.id}`;
    const hipJ = `j_hip_${leg.id}`;
    const hipC = dof === 1 ? `sv_${leg.id}` : `sv_${leg.id}_hip`;
    links.push({ id: hipId, length: thigh, radius: 0.012, color: '#38bdf8' });
    joints.push({
      id: hipJ,
      name: `${leg.name}髋`,
      type: 'revolute',
      parent: 'body',
      child: hipId,
      origin: origin(leg.xyz, [0, PI2, 0]),
      axis: [0, 1, 0],
      componentId: hipC,
      qOffsetDeg: 0,
      qScale: 1,
    });
    roles.push(role(`${leg.id}_hip`, `${leg.name}髋`, hipJ, 'servo', [hipC, `sv_${leg.id}`]));
    if (dof === 2) {
      const shinId = `shin_${leg.id}`;
      const kneeJ = `j_knee_${leg.id}`;
      const kneeC = `sv_${leg.id}_knee`;
      links.push({ id: shinId, length: thigh * 0.85, radius: 0.01, color: '#22c55e' });
      joints.push({
        id: kneeJ,
        name: `${leg.name}膝`,
        type: 'revolute',
        parent: hipId,
        child: shinId,
        origin: origin([thigh, 0, 0]),
        axis: [0, 1, 0],
        componentId: kneeC,
      });
      roles.push(role(`${leg.id}_knee`, `${leg.name}膝`, kneeJ, 'servo', [kneeC]));
    }
  }
  const mech: MechanismDef = { id, name, kind: 'quadruped', links, joints };
  return pack(mech, roles, name);
}

function humanoid(spec: GenerateSpec): GeneratedKit {
  const id = spec.id ?? 'humanoid-lite';
  const name = spec.name ?? '简易人形';
  const upper = spec.linkLength ?? 0.08;
  const links: LinkDef[] = [
    { id: 'world', length: 0 },
    { id: 'torso', length: 0.12, radius: 0.04, color: '#64748b', shape: 'box', box: [0.08, 0.12, 0.16] },
    { id: 'head', length: 0.04, radius: 0.028, color: '#cbd5e1' },
    { id: 'u_l', length: upper, radius: 0.012, color: '#38bdf8' },
    { id: 'f_l', length: upper * 0.85, radius: 0.01, color: '#22c55e' },
    { id: 'u_r', length: upper, radius: 0.012, color: '#38bdf8' },
    { id: 'f_r', length: upper * 0.85, radius: 0.01, color: '#22c55e' },
  ];
  const joints: JointDef[] = [
    {
      id: 'j_torso',
      name: '躯干',
      type: 'fixed',
      parent: 'world',
      child: 'torso',
      origin: origin([0, 0, 0.12]),
      axis: [0, 0, 1],
      componentId: '',
    },
    {
      id: 'j_head',
      name: '头',
      type: 'revolute',
      parent: 'torso',
      child: 'head',
      origin: origin([0, 0, 0.1]),
      axis: [0, 0, 1],
      componentId: 'sv_head',
    },
    {
      id: 'j_shld_l',
      name: '左肩',
      type: 'revolute',
      parent: 'torso',
      child: 'u_l',
      origin: origin([0, 0.08, 0.06], [0, PI2, 0]),
      axis: [0, 1, 0],
      componentId: 'sv_shld_l',
    },
    {
      id: 'j_elbw_l',
      name: '左肘',
      type: 'revolute',
      parent: 'u_l',
      child: 'f_l',
      origin: origin([upper, 0, 0]),
      axis: [0, 1, 0],
      componentId: 'sv_elbw_l',
    },
    {
      id: 'j_shld_r',
      name: '右肩',
      type: 'revolute',
      parent: 'torso',
      child: 'u_r',
      origin: origin([0, -0.08, 0.06], [0, PI2, 0]),
      axis: [0, 1, 0],
      componentId: 'sv_shld_r',
    },
    {
      id: 'j_elbw_r',
      name: '右肘',
      type: 'revolute',
      parent: 'u_r',
      child: 'f_r',
      origin: origin([upper, 0, 0]),
      axis: [0, 1, 0],
      componentId: 'sv_elbw_r',
    },
  ];
  const roles: KitRole[] = [
    role('head', '头', 'j_head', 'servo', ['sv_head']),
    role('shld_l', '左肩', 'j_shld_l', 'servo', ['sv_shld_l']),
    role('elbw_l', '左肘', 'j_elbw_l', 'servo', ['sv_elbw_l']),
    role('shld_r', '右肩', 'j_shld_r', 'servo', ['sv_shld_r']),
    role('elbw_r', '右肘', 'j_elbw_r', 'servo', ['sv_elbw_r']),
  ];
  const mech: MechanismDef = { id, name, kind: 'humanoid', links, joints };
  return pack(mech, roles, name);
}

export function generateMechanism(spec: GenerateSpec): GeneratedKit {
  if (spec.kind === 'wheeled') return wheeled(spec);
  if (spec.kind === 'quadruped') return quadruped(spec);
  if (spec.kind === 'humanoid') return humanoid(spec);
  return serialArm(spec);
}

export const GEN_PRESETS: { token: string; label: string; spec: GenerateSpec }[] = [
  { token: 'serial:3', label: '串联 3 轴', spec: { kind: 'serial', n: 3 } },
  { token: 'serial:5', label: '串联 5 轴', spec: { kind: 'serial', n: 5 } },
  { token: 'wheeled:2', label: '轮式 2 驱', spec: { kind: 'wheeled', n: 2 } },
  { token: 'wheeled:4', label: '轮式 4 驱', spec: { kind: 'wheeled', n: 4 } },
  { token: 'quad:4:1', label: '四足 4×1', spec: { kind: 'quadruped', legs: 4, dofPerLeg: 1 } },
  { token: 'quad:4:2', label: '四足 8 轴', spec: { kind: 'quadruped', legs: 4, dofPerLeg: 2 } },
  { token: 'humanoid', label: '简易人形', spec: { kind: 'humanoid' } },
];

export function generatePreset(token: string): GeneratedKit {
  const p = GEN_PRESETS.find((x) => x.token === token);
  if (!p) throw new Error(`未知生成预设: ${token}`);
  return generateMechanism(p.spec);
}

export function builtinGenerated(): GeneratedKit[] {
  return [
    generateMechanism({ kind: 'quadruped', legs: 4, dofPerLeg: 1, id: 'quad-4dof', name: '四轴机器狗' }),
    generateMechanism({ kind: 'humanoid', id: 'humanoid-lite', name: '简易人形' }),
  ];
}
