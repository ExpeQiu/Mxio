/** 执行器种类：与 Velxio 元件 metadataId 对齐 */
export type ActuatorKind = 'servo' | 'stepper' | 'dc-motor';

export type Spinning = boolean | 'rev';

/** P0 总线契约。q：舵机/步进为度；直流电机为累计转角（度）。 */
export interface ActuatorPose {
  id: string;
  kind: ActuatorKind;
  q: number;
  qdot?: number;
  spinning?: Spinning;
  t_ns: number;
}

export type Vec3 = [number, number, number];

export interface Origin {
  xyz: Vec3;
  rpy: Vec3;
}

export type JointType = 'revolute' | 'continuous' | 'prismatic' | 'fixed';

export interface JointDef {
  id: string;
  name: string;
  type: JointType;
  parent: string;
  child: string;
  origin: Origin;
  axis: Vec3;
  /** Velxio 元件 id；`*` 匹配任意同 kind 的第一个执行器 */
  componentId: string;
  qOffsetDeg?: number;
  qScale?: number;
}

export interface LinkDef {
  id: string;
  length?: number;
  radius?: number;
  color?: string;
  /** 缺省为连杆圆柱；躯干/车体用 box */
  shape?: 'cylinder' | 'box';
  /** box 时的 xyz 尺寸（米） */
  box?: Vec3;
}

export interface WheelDef {
  componentId: string;
  linkId: string;
  radius: number;
}

export type MechanismKind = 'serial' | 'vehicle' | 'quadruped' | 'humanoid';

export interface MechanismDef {
  id: string;
  name: string;
  kind: MechanismKind;
  links: LinkDef[];
  joints: JointDef[];
  wheels?: WheelDef[];
}

/** 装配：哪个画布元件驱动哪个关节（含零位 / 传动比 / 安装偏置） */
export interface MountDef {
  componentId: string;
  jointId: string;
  kind?: ActuatorKind;
  qOffsetDeg?: number;
  qScale?: number;
  origin?: Origin;
}

export interface AssemblyDef {
  id: string;
  name: string;
  mechanismId: string;
  mounts: MountDef[];
}

/** 模型组合：机构 + 默认装配 + 角色 BOM */
export interface KitRole {
  role: string;
  name: string;
  jointId: string;
  preferKind: ActuatorKind;
  aliases: string[];
  qOffsetDeg?: number;
  qScale?: number;
}

export interface KitDef {
  id: string;
  name: string;
  mechanismId: string;
  assemblyId: string;
  roles: KitRole[];
}

export interface AssembleIssue {
  level: 'error' | 'warn';
  code: string;
  message: string;
  jointId?: string;
  componentId?: string;
}

export interface LinkPose {
  id: string;
  xyz: Vec3;
  /** 行优先 3×3 旋转 */
  rot: [Vec3, Vec3, Vec3];
}

export interface FkResult {
  mechId: string;
  t_ns: number;
  links: Record<string, LinkPose>;
  ee?: LinkPose;
  joints: Record<string, number>;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
