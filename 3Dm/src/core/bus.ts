import { log } from './log.js';
import type { ActuatorPose } from './types.js';

export type PoseHandler = (pose: ActuatorPose, snapshot: ActuatorPose[]) => void;

const TRAJ_CAP = 4000;

export class ActuatorBus {
  private latest = new Map<string, ActuatorPose>();
  private traj: ActuatorPose[] = [];
  private handlers = new Set<PoseHandler>();
  private lastLogMs = 0;

  publish(pose: ActuatorPose): void {
    this.latest.set(pose.id, pose);
    this.traj.push(pose);
    if (this.traj.length > TRAJ_CAP) this.traj.splice(0, this.traj.length - TRAJ_CAP);
    const snap = this.snapshot();
    for (const h of this.handlers) h(pose, snap);

    const t = Date.now();
    if (t - this.lastLogMs >= 200) {
      this.lastLogMs = t;
      log.debug('pose', {
        phase: 'p0',
        component_id: pose.id,
        kind: pose.kind,
        q: Number(pose.q.toFixed(3)),
        qdot: pose.qdot,
      });
    }
  }

  subscribe(handler: PoseHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  snapshot(): ActuatorPose[] {
    return Array.from(this.latest.values());
  }

  get(id: string): ActuatorPose | undefined {
    return this.latest.get(id);
  }

  trajectory(): ActuatorPose[] {
    return this.traj.slice();
  }

  clear(): void {
    this.latest.clear();
    this.traj = [];
  }
}

export const actuatorBus = new ActuatorBus();
