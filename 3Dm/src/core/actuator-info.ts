import type { ActuatorKind, ActuatorPose, JointDef, MountDef } from './types.js';

export interface ActuatorSpec {
  kind: ActuatorKind;
  kindLabel: string;
  metadataId: string;
  pins: string[];
  range: string;
  protocol: string;
}

const KIND_SPEC: Record<ActuatorKind, ActuatorSpec> = {
  servo: {
    kind: 'servo',
    kindLabel: '舵机',
    metadataId: 'servo',
    pins: ['PWM', 'V+', 'GND'],
    range: '0–180°',
    protocol: 'PWM 544–2400 µs',
  },
  stepper: {
    kind: 'stepper',
    kindLabel: '步进电机',
    metadataId: 'stepper-motor',
    pins: ['A+', 'A-', 'B+', 'B-'],
    range: '1.8°/步',
    protocol: '全步/半步线圈',
  },
  'dc-motor': {
    kind: 'dc-motor',
    kindLabel: '直流电机',
    metadataId: 'dc-motor',
    pins: ['1', '2'],
    range: '连续旋转',
    protocol: '绕组电流正反转',
  },
};

const ROLE: Record<string, string> = {
  sv_base: '基座舵机',
  sv_shld: '肩舵机',
  sv_elbw: '肘舵机',
  sv_grip: '夹爪舵机',
  'servo-1': '扫摆舵机',
  m_l: '左轮电机',
  m_r: '右轮电机',
  m_fl: '左前轮电机',
  m_fr: '右前轮电机',
  m_rl: '左后轮电机',
  m_rr: '右后轮电机',
  sv_lf: '左前腿舵机',
  sv_rf: '右前腿舵机',
  sv_lr: '左后腿舵机',
  sv_rr: '右后腿舵机',
  sv_head: '头部舵机',
  sv_shld_l: '左肩舵机',
  sv_elbw_l: '左肘舵机',
  sv_shld_r: '右肩舵机',
  sv_elbw_r: '右肘舵机',
};

export function inferKind(componentId: string, hint?: ActuatorKind): ActuatorKind {
  if (hint) return hint;
  if (componentId.startsWith('m_') || componentId.includes('dc')) return 'dc-motor';
  if (componentId.includes('stp') || componentId.includes('stepper')) return 'stepper';
  return 'servo';
}

export function actuatorSpec(componentId: string, hint?: ActuatorKind): ActuatorSpec {
  return KIND_SPEC[inferKind(componentId, hint)];
}

export function actuatorRole(componentId: string): string {
  return ROLE[componentId] ?? componentId;
}

export function jointQdeg(mount: MountDef | undefined, pose: ActuatorPose | undefined): number | null {
  if (!pose) return null;
  const offset = mount?.qOffsetDeg ?? 0;
  const scale = mount?.qScale ?? 1;
  return (pose.q + offset) * scale;
}

export function formatAxis(joint: JointDef | undefined): string {
  if (!joint) return '—';
  const [x, y, z] = joint.axis;
  if (Math.abs(z) > 0.9) return 'Z 偏航';
  if (Math.abs(y) > 0.9) return 'Y 俯仰';
  if (Math.abs(x) > 0.9) return 'X 滚转';
  return `${x},${y},${z}`;
}
