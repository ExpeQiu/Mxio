import { nowNs } from './clock.js';
import {
  matFromAxisAngle,
  matFromAxisPrism,
  matFromOrigin,
  matIdentity,
  matMultiply,
  matPosition,
  matRotation,
  type Mat4,
} from './mat4.js';
import { DEG2RAD, type ActuatorPose, type FkResult, type JointDef, type LinkPose, type MechanismDef } from './types.js';

function jointQ(joint: JointDef, poses: Map<string, ActuatorPose>): number {
  if (!joint.componentId) return 0;
  const pose =
    joint.componentId === '*'
      ? poses.values().next().value
      : poses.get(joint.componentId);
  const qDeg = pose?.q ?? 0;
  const offset = joint.qOffsetDeg ?? 0;
  const scale = joint.qScale ?? 1;
  const value = (qDeg + offset) * scale;
  if (joint.type === 'prismatic') return value / 1000;
  if (joint.type === 'fixed') return 0;
  return value * DEG2RAD;
}

function resolvePose(joint: JointDef, poses: Map<string, ActuatorPose>): ActuatorPose | undefined {
  if (joint.componentId === '*') return poses.values().next().value;
  return poses.get(joint.componentId);
}

export function poseMap(list: ActuatorPose[]): Map<string, ActuatorPose> {
  const m = new Map<string, ActuatorPose>();
  for (const p of list) m.set(p.id, p);
  return m;
}

export function forwardKinematics(mech: MechanismDef, poses: ActuatorPose[], t_ns = nowNs()): FkResult {
  const map = poseMap(poses);
  const byChild = new Map<string, JointDef>();
  for (const j of mech.joints) byChild.set(j.child, j);

  const cache = new Map<string, Mat4>();
  const jointQrad: Record<string, number> = {};

  const linkT = (linkId: string): Mat4 => {
    if (cache.has(linkId)) return cache.get(linkId)!;
    if (linkId === 'world') {
      cache.set(linkId, matIdentity());
      return cache.get(linkId)!;
    }
    const joint = byChild.get(linkId);
    if (!joint) {
      cache.set(linkId, matIdentity());
      return cache.get(linkId)!;
    }
    const parent = linkT(joint.parent);
    const origin = matFromOrigin(joint.origin.xyz, joint.origin.rpy);
    const q = jointQ(joint, map);
    jointQrad[joint.id] = q;
    let motion = matIdentity();
    if (joint.type === 'revolute' || joint.type === 'continuous') {
      motion = matFromAxisAngle(joint.axis, q);
    } else if (joint.type === 'prismatic') {
      motion = matFromAxisPrism(joint.axis, q);
    }
    const t = matMultiply(parent, matMultiply(origin, motion));
    cache.set(linkId, t);
    return t;
  };

  const links: Record<string, LinkPose> = {};
  for (const link of mech.links) {
    const t = linkT(link.id);
    links[link.id] = { id: link.id, xyz: matPosition(t), rot: matRotation(t) };
  }

  const last = mech.links[mech.links.length - 1];
  return {
    mechId: mech.id,
    t_ns,
    links,
    ee: last ? links[last.id] : undefined,
    joints: jointQrad,
  };
}

export { resolvePose, jointQ };
