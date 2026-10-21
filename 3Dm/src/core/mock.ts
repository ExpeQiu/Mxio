import { actuatorBus } from './bus.js';
import { nowNs } from './clock.js';
import { log } from './log.js';
import type { ActuatorPose, MechanismDef } from './types.js';

export interface MockPlayOpts {
  durationMs?: number;
  hz?: number;
  now?: () => number;
}

function servoSweep(t: number, period = 2): number {
  const u = (t % period) / period;
  return u < 0.5 ? u * 2 * 180 : (1 - (u - 0.5) * 2) * 180;
}

export function mockPoseAt(mech: MechanismDef, tSec: number): ActuatorPose[] {
  const t_ns = nowNs();
  if (mech.kind === 'vehicle') {
    return (mech.wheels ?? []).map((w, i) => {
      const qdot = 360 * (i % 2 === 0 ? 1 : 0.92);
      return {
        id: w.componentId,
        kind: 'dc-motor' as const,
        q: qdot * tSec,
        qdot,
        spinning: true as const,
        t_ns,
      };
    });
  }

  return mech.joints
    .filter((j) => j.type !== 'fixed' && j.componentId !== '')
    .map((j, idx) => {
      const phase = idx * 0.25;
      const q = servoSweep(tSec + phase);
      return {
        id: j.componentId === '*' ? 'servo-1' : j.componentId,
        kind: 'servo' as const,
        q,
        t_ns,
      };
    });
}

/** 同步回放（CLI / 测试）。返回轨迹。 */
export function playMockSync(mech: MechanismDef, opts: MockPlayOpts = {}): ActuatorPose[] {
  const durationMs = opts.durationMs ?? 2000;
  const hz = opts.hz ?? 20;
  const steps = Math.max(1, Math.round((durationMs / 1000) * hz));
  const out: ActuatorPose[] = [];
  log.info('mock.play', { phase: 'p0', mech_id: mech.id, durationMs, hz, steps });
  for (let i = 0; i <= steps; i++) {
    const tSec = (i / hz);
    const poses = mockPoseAt(mech, tSec);
    for (const p of poses) {
      actuatorBus.publish(p);
      out.push(p);
    }
  }
  return out;
}
