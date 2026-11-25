// 向量/矩阵与平面几何工具(纯函数,主线程与 worker 共用)
import type { AxisName } from './types';

export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l < 1e-12 ? [0, 0, 1] : [a[0] / l, a[1] / l, a[2] / l];
}

export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

/** 列主序 4x4 单位矩阵 */
export function identity4(): number[] {
  const m = new Array(16).fill(0);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** 列主序 4x4:旋转 + 平移(用于 manifold.transform / three.Matrix4) */
export function composeMatrix(columns: Vec3[], translation: Vec3): number[] {
  // columns: 目标基 e1,e2,e3(世界坐标),矩阵把模型坐标变换到世界坐标
  const m = identity4();
  m[0] = columns[0][0]; m[1] = columns[0][1]; m[2] = columns[0][2];
  m[4] = columns[1][0]; m[5] = columns[1][1]; m[6] = columns[1][2];
  m[8] = columns[2][0]; m[9] = columns[2][1]; m[10] = columns[2][2];
  m[12] = translation[0]; m[13] = translation[1]; m[14] = translation[2];
  return m;
}

/**
 * 构造截平面的局部正交基。
 * 约定:模型变换到局部后,法向 n 与局部 +Z 对齐,平面过局部原点,
 * 即 manifold.slice(0) 切到的就是该平面。
 * 返回 { e1, e2, n }(均为单位向量、右手系 e1 × e2 = n)。
 */
export function planeBasis(normalInput: Vec3): { e1: Vec3; e2: Vec3; n: Vec3 } {
  const n = normalize(normalInput);
  // 选与 n 最不平行的世界轴做参考
  const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = normalize(cross(ref, n));
  const e2 = normalize(cross(n, e1));
  return { e1, e2, n };
}

/** 默认(未旋转)状态下各平面的法向与平面内两轴 */
export function defaultPlaneVectors(axis: AxisName): { normal: Vec3; e1: Vec3; e2: Vec3 } {
  switch (axis) {
    case 'x':
      return { normal: [1, 0, 0], e1: [0, 1, 0], e2: [0, 0, 1] };
    case 'y':
      return { normal: [0, 1, 0], e1: [1, 0, 0], e2: [0, 0, 1] };
    case 'z':
    default:
      return { normal: [0, 0, 1], e1: [1, 0, 0], e2: [0, 1, 0] };
  }
}

/**
 * 角度吸附:把方向向量吸附到最近的正交方向(世界 ±X/±Y/±Z),
 * 或按 stepDegrees 等间隔方向吸附(取与原方向夹角较小者)。
 * 仅在偏差小于阈值时吸附,避免远距离跳变。
 */
export function snapNormal(normal: Vec3, stepDegrees: number, orthoOnly: boolean): Vec3 {
  const n = normalize(normal);
  const axisDirs: Vec3[] = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1]
  ];
  let best = n;
  let bestAngle = Infinity;
  const cos = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, dot(normalize(a), normalize(b)))));

  // 1) 正交方向吸附(阈值:步长的一半,最大 20°)
  const orthoThreshold = Math.min(20, stepDegrees * 0.5) * Math.PI / 180;
  for (const d of axisDirs) {
    const a = cos(n, d);
    if (a < orthoThreshold && a < bestAngle) {
      bestAngle = a;
      best = d;
    }
  }
  if (orthoOnly) return best;

  // 2) 等角度步长吸附:在 n 与最近世界轴构成的局部坐标内做球面步进
  if (bestAngle === Infinity) {
    const step = stepDegrees * Math.PI / 180;
    // 用旋转:找 n 的球坐标,按 step 取整
    const theta = Math.atan2(n[1], n[0]);
    const phi = Math.acos(Math.min(1, Math.max(-1, n[2])));
    const t2 = Math.round(theta / step) * step;
    const p2 = Math.round(phi / step) * step;
    const sp = Math.sin(p2);
    const candidate = normalize([sp * Math.cos(t2), sp * Math.sin(t2), Math.cos(p2)]);
    if (cos(n, candidate) < step * 0.5) best = candidate;
  }
  return best;
}

/** Shoelace 有符号面积(2D) */
export function signedArea2d(points: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return a * 0.5;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 数值范围(用于 UI 滑块) */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
