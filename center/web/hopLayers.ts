import { activeHops, type DriveHopId, type DriveSnapshot } from '@apps/drive';

export type CenterLayer = 'app' | 'hardware' | 'motion';

export type MotionHopId = 'pose' | 'sv_base' | 'sv_shld' | 'sv_elbw' | 'sv_grip';

const APP_HOPS: ReadonlySet<DriveHopId> = new Set(['window', 'stt', 'bridge']);

export function layerOfHop(id: DriveHopId): CenterLayer {
  return APP_HOPS.has(id) ? 'app' : 'hardware';
}

export interface MotionSnap {
  face: boolean;
  n: number;
  base: number;
  shld: number;
  elbw: number;
  grip: number;
}

export function hopsForLayer(
  layer: 'app' | 'hardware',
  hops: ReadonlySet<DriveHopId>,
): Set<DriveHopId> {
  const out = new Set<DriveHopId>();
  for (const h of hops) {
    if (layerOfHop(h) === layer) out.add(h);
  }
  return out;
}

/** 运动栏：有人脸锁定或有效帧时点亮关节。 */
export function motionHops(arm: MotionSnap | null | undefined): Set<MotionHopId> {
  const out = new Set<MotionHopId>();
  if (!arm) return out;
  if (arm.face || arm.n > 0) {
    out.add('pose');
    out.add('sv_base');
    out.add('sv_shld');
    out.add('sv_elbw');
    out.add('sv_grip');
  }
  return out;
}

export function splitHops(snap: DriveSnapshot, arm?: MotionSnap | null) {
  const hops = activeHops(snap);
  return {
    app: hopsForLayer('app', hops),
    hardware: hopsForLayer('hardware', hops),
    motion: motionHops(arm),
    uart: hops.has('uart'),
  };
}
