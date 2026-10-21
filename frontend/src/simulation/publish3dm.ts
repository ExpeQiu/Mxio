/**
 * 3Dm 适配：把执行器状态打到 iframe / CustomEvent。
 * 核心类型与 FK 在 velxio/3Dm，这里只发契约。
 */

export type MotionKind = 'servo' | 'stepper' | 'dc-motor';

export interface MotionPose {
  id: string;
  kind: MotionKind;
  q: number;
  qdot?: number;
  spinning?: boolean | 'rev';
  t_ns: number;
}

export function publish3dm(pose: Omit<MotionPose, 't_ns'> & { t_ns?: number }): void {
  const payload: MotionPose = {
    ...pose,
    t_ns: pose.t_ns ?? Math.round(performance.now() * 1e6),
  };
  window.dispatchEvent(new CustomEvent('velxio:3dm:pose', { detail: payload }));
  const iframe = document.getElementById('velxio-3dm-frame') as HTMLIFrameElement | null;
  iframe?.contentWindow?.postMessage({ type: 'velxio.3dm.pose', pose: payload }, '*');
}

function protoDesc(el: object, key: string): PropertyDescriptor | undefined {
  let proto: object | null = Object.getPrototypeOf(el);
  while (proto && proto !== Object.prototype) {
    const d = Object.getOwnPropertyDescriptor(proto, key);
    if (d) return d;
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getOwnPropertyDescriptor(el, key);
}

export function bind3dmAngle(
  el: { angle?: number },
  componentId: string,
  kind: 'servo' | 'stepper',
): void {
  if (!componentId) return;
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
      publish3dm({ id: componentId, kind, q: internal });
    },
  });
}

export function bind3dmSpinning(el: { spinning?: boolean | 'rev' | '' }, componentId: string): void {
  if (!componentId) return;
  const desc = protoDesc(el, 'spinning');
  let internal: boolean | 'rev' | '' = el.spinning ?? false;
  let q = 0;
  Object.defineProperty(el, 'spinning', {
    configurable: true,
    enumerable: true,
    get() {
      if (desc?.get) return desc.get.call(el);
      return internal;
    },
    set(v: boolean | 'rev' | '') {
      internal = v;
      if (desc?.set) desc.set.call(el, v);
      const spinning = v === 'rev' ? 'rev' : Boolean(v);
      const qdot = spinning === 'rev' ? -360 : spinning ? 360 : 0;
      if (qdot) q += qdot / 60;
      publish3dm({ id: componentId, kind: 'dc-motor', q, qdot, spinning });
    },
  });
}
