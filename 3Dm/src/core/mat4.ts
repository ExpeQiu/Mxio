import type { Vec3 } from './types.js';

/** 行优先 4×4 */
export type Mat4 = number[];

export function matIdentity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function matMultiply(a: Mat4, b: Mat4): Mat4 {
  const o = matIdentity();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] =
        a[r * 4 + 0] * b[0 * 4 + c] +
        a[r * 4 + 1] * b[1 * 4 + c] +
        a[r * 4 + 2] * b[2 * 4 + c] +
        a[r * 4 + 3] * b[3 * 4 + c];
    }
  }
  return o;
}

export function matTranslation(xyz: Vec3): Mat4 {
  const m = matIdentity();
  m[3] = xyz[0];
  m[7] = xyz[1];
  m[11] = xyz[2];
  return m;
}

function rotX(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}

function rotY(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}

function rotZ(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** rpy = [roll X, pitch Y, yaw Z]，应用顺序 Rz * Ry * Rx */
export function matFromRpy(rpy: Vec3): Mat4 {
  return matMultiply(matMultiply(rotZ(rpy[2]), rotY(rpy[1])), rotX(rpy[0]));
}

export function matFromOrigin(xyz: Vec3, rpy: Vec3): Mat4 {
  return matMultiply(matTranslation(xyz), matFromRpy(rpy));
}

export function matFromAxisAngle(axis: Vec3, angle: number): Mat4 {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const x = axis[0] / len;
  const y = axis[1] / len;
  const z = axis[2] / len;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    0,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    0,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ];
}

export function matFromAxisPrism(axis: Vec3, dist: number): Mat4 {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  return matTranslation([
    (axis[0] / len) * dist,
    (axis[1] / len) * dist,
    (axis[2] / len) * dist,
  ]);
}

export function matPosition(m: Mat4): Vec3 {
  return [m[3], m[7], m[11]];
}

export function matRotation(m: Mat4): [Vec3, Vec3, Vec3] {
  return [
    [m[0], m[1], m[2]],
    [m[4], m[5], m[6]],
    [m[8], m[9], m[10]],
  ];
}
