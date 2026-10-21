import { actuatorBus } from './bus.js';
import { nowNs } from './clock.js';
import type { ActuatorKind, Spinning } from './types.js';

type AngleEl = {
  angle?: number;
};

type SpinEl = {
  spinning?: Spinning | '';
};

function protoDesc(el: object, key: string): PropertyDescriptor | undefined {
  let proto: object | null = Object.getPrototypeOf(el);
  while (proto && proto !== Object.prototype) {
    const d = Object.getOwnPropertyDescriptor(proto, key);
    if (d) return d;
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getOwnPropertyDescriptor(el, key);
}

/** 拦截元件 angle 写入并发布到总线（不破坏原 Web Component setter）。 */
export function bindActuatorAngle(el: AngleEl, componentId: string, kind: ActuatorKind): void {
  const desc = protoDesc(el, 'angle');
  let internal = Number(el.angle ?? 0);
  Object.defineProperty(el, 'angle', {
    configurable: true,
    enumerable: true,
    get() {
      if (desc?.get) return desc.get.call(el);
      return internal;
    },
    set(v: number) {
      internal = Number(v) || 0;
      if (desc?.set) desc.set.call(el, internal);
      actuatorBus.publish({ id: componentId, kind, q: internal, t_ns: nowNs() });
    },
  });
}

export function bindActuatorSpinning(el: SpinEl, componentId: string, kind: ActuatorKind): void {
  const desc = protoDesc(el, 'spinning');
  let internal: Spinning | '' = el.spinning ?? false;
  let q = 0;
  Object.defineProperty(el, 'spinning', {
    configurable: true,
    enumerable: true,
    get() {
      if (desc?.get) return desc.get.call(el);
      return internal;
    },
    set(v: Spinning | '') {
      internal = v;
      if (desc?.set) desc.set.call(el, v);
      const spinning: Spinning = v === 'rev' ? 'rev' : Boolean(v);
      const qdot = spinning === 'rev' ? -360 : spinning ? 360 : 0;
      if (qdot) q += qdot / 60;
      actuatorBus.publish({
        id: componentId,
        kind,
        q,
        qdot,
        spinning,
        t_ns: nowNs(),
      });
    },
  });
}
