// 纯数学层：三维向量、Hermite/Catmull-Rom 样条拟合、OBB 线段相交、均匀哈希网格
import type { OcclusionSegment, Obstacle, Vec3 } from '../types';

// ---------- 基础向量运算 ----------
export const v = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3): number => length(sub(b, a));
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 1];
};
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const clone3 = (a: Vec3): Vec3 => [a[0], a[1], a[2]];

let counter = 0;
export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

// ---------- 正交基（Z 轴对齐给定方向） ----------
export function basisFromDir(dir: Vec3): { x: Vec3; y: Vec3; z: Vec3 } {
  const z = normalize(dir);
  const up: Vec3 = Math.abs(z[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return { x, y, z };
}

// ---------- 三次 Hermite 样条拟合 ----------
/** 弯曲档位 1..5 → 切线长度系数（越大越松弛、弯曲越明显） */
const BEND_FACTORS = [0.25, 0.55, 1.0, 1.45, 1.9];
export const bendFactor = (level: number): number =>
  BEND_FACTORS[Math.min(4, Math.max(0, level - 1))];

interface FitKnot {
  p: Vec3;
  /** 端点切线方向（单位向量），内部点忽略该字段 */
  dir?: Vec3;
}

/** 三次 Hermite 插值 */
function hermite(p0: Vec3, m0: Vec3, p1: Vec3, m1: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return [
    h00 * p0[0] + h10 * m0[0] + h01 * p1[0] + h11 * m1[0],
    h00 * p1[1] + h10 * m0[1] + h01 * p1[1] + h11 * m1[1],
    h00 * p0[2] + h10 * m0[2] + h01 * p1[2] + h11 * m1[2],
  ];
}

export interface FitResult {
  samples: Vec3[];
}

/**
 * 依据有序标注点拟合平滑弹道曲线。
 * - 端点切线使用射入/射出点给定方向；内部点使用 Catmull-Rom 中心差分切线
 * - bendLevel 控制切线长度（弯曲强度档位）
 * - snap=false 时内部点向首尾弦线靠拢，作为软约束处理
 */
export function fitTrajectory(knotsInput: FitKnot[], bendLevel: number, snap: boolean): FitResult {
  if (knotsInput.length < 2) return { samples: [] };

  const factor = bendFactor(bendLevel);
  const n = knotsInput.length - 1;

  // 软约束：内部节点向首尾弦线收缩 45%
  const knots: Vec3[] = knotsInput.map((k, i) => {
    if (snap || i === 0 || i === n) return clone3(k.p);
    const chord = lerp(knotsInput[0].p, knotsInput[n].p, i / n);
    return lerp(k.p, chord, 0.45);
  });

  // 各节点切线
  const tangents: Vec3[] = knots.map((_, i) => {
    if (i === 0) {
      const d = knotsInput[0].dir ?? normalize(sub(knots[1], knots[0]));
      return scale(normalize(d), factor * Math.max(1e-6, dist(knots[0], knots[1])));
    }
    if (i === n) {
      const d = knotsInput[n].dir ?? normalize(sub(knots[n], knots[n - 1]));
      return scale(normalize(d), factor * Math.max(1e-6, dist(knots[n], knots[n - 1])));
    }
    return scale(scale(sub(knots[i + 1], knots[i - 1]), 0.5), factor);
  });

  // 按各段弦长建立累计参数表，再做等距参数采样，固定输出 201 个点
  // （固定点数保证 Babylon Tube 以 instance 方式更新时顶点缓冲可复用）
  const chordLens = knots.slice(0, -1).map((p, i) => Math.max(1e-6, dist(p, knots[i + 1])));
  const totalLen = chordLens.reduce((a, b) => a + b, 0);
  const cum: number[] = [0];
  for (const l of chordLens) cum.push(cum[cum.length - 1] + l / totalLen);
  cum[cum.length - 1] = 1;

  const TOTAL = 201;
  const samples: Vec3[] = [];
  let seg = 0;
  for (let k = 0; k < TOTAL; k++) {
    const t = k / (TOTAL - 1);
    while (seg < n - 1 && t > cum[seg + 1]) seg++;
    const span = cum[seg + 1] - cum[seg] || 1e-9;
    const u = (t - cum[seg]) / span;
    samples.push(hermite(knots[seg], tangents[seg], knots[seg + 1], tangents[seg + 1], Math.min(1, Math.max(0, u))));
  }
  return { samples };
}

// ---------- OBB 线段相交（slab 法） ----------
export interface OBB {
  center: Vec3;
  axes: [Vec3, Vec3, Vec3];
  halfExtents: Vec3;
}

export interface SegmentHit {
  /** 入射参数（沿线段 0..1） */
  sEnter: number;
  /** 穿出参数 */
  sExit: number;
  enterPoint: Vec3;
  exitPoint: Vec3;
}

/** 线段 A->B 与定向包围盒的相交测试，返回线段在盒内的参数区间（标量运算，零数组分配） */
export function segmentOBB(a: Vec3, b: Vec3, obb: OBB): SegmentHit | null {
  const rx = a[0] - obb.center[0];
  const ry = a[1] - obb.center[1];
  const rz = a[2] - obb.center[2];
  const ax0 = obb.axes[0];
  const ax1 = obb.axes[1];
  const ax2 = obb.axes[2];
  const localA0 = rx * ax0[0] + ry * ax0[1] + rz * ax0[2];
  const localA1 = rx * ax1[0] + ry * ax1[1] + rz * ax1[2];
  const localA2 = rx * ax2[0] + ry * ax2[1] + rz * ax2[2];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const localD0 = dx * ax0[0] + dy * ax0[1] + dz * ax0[2];
  const localD1 = dx * ax1[0] + dy * ax1[1] + dz * ax1[2];
  const localD2 = dx * ax2[0] + dy * ax2[1] + dz * ax2[2];

  let tMin = 0;
  let tMax = 1;
  const EPS = 1e-9;
  const localA = [localA0, localA1, localA2];
  const localD = [localD0, localD1, localD2];
  for (let axis = 0; axis < 3; axis++) {
    const e = obb.halfExtents[axis];
    const p1 = localA[axis];
    const d = localD[axis];
    if (Math.abs(d) < EPS) {
      if (p1 < -e - EPS || p1 > e + EPS) return null;
      continue;
    }
    let t1 = (-e - p1) / d;
    let t2 = (e - p1) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax + EPS) return null;
  }
  tMin = Math.max(0, tMin);
  tMax = Math.min(1, tMax);
  if (tMin > tMax) return null;
  return {
    sEnter: tMin,
    sExit: tMax,
    enterPoint: [a[0] + dx * tMin, a[1] + dy * tMin, a[2] + dz * tMin],
    exitPoint: [a[0] + dx * tMax, a[1] + dy * tMax, a[2] + dz * tMax],
  };
}

// ---------- 均匀哈希网格（宽相剔除） ----------
// 整数打包 key：坐标平移 OFFSET 后压成单个整数，避免热路径上的字符串拼接
const GRID_OFFSET = 4096;
const GRID_STRIDE = 8192;
const cellKey = (x: number, y: number, z: number): number =>
  (x + GRID_OFFSET) * GRID_STRIDE * GRID_STRIDE + (y + GRID_OFFSET) * GRID_STRIDE + (z + GRID_OFFSET);

export class HashGrid {
  private cells = new Map<number, string[]>();
  /** 复用的候选集合，避免每条折线段都分配新 Set */
  private scratch = new Set<string>();

  constructor(private readonly cellSize: number) {}

  private coordOf(p: number): number {
    return Math.floor(p / this.cellSize);
  }

  /** 用障碍物世界 AABB 建格 */
  build(obstacles: Obstacle[], obbOf: (o: Obstacle) => OBB): void {
    this.cells.clear();
    for (const o of obstacles) {
      if (!o.visible) continue;
      const obb = obbOf(o);
      const e0 = obb.halfExtents[0];
      const e1 = obb.halfExtents[1];
      const e2 = obb.halfExtents[2];
      // OBB 世界 AABB：半尺寸在各世界轴上的投影之和
      const rx = e0 * Math.abs(obb.axes[0][0]) + e1 * Math.abs(obb.axes[1][0]) + e2 * Math.abs(obb.axes[2][0]);
      const ry = e0 * Math.abs(obb.axes[0][1]) + e1 * Math.abs(obb.axes[1][1]) + e2 * Math.abs(obb.axes[2][1]);
      const rz = e0 * Math.abs(obb.axes[0][2]) + e1 * Math.abs(obb.axes[1][2]) + e2 * Math.abs(obb.axes[2][2]);
      const cx0 = this.coordOf(obb.center[0] - rx);
      const cx1 = this.coordOf(obb.center[0] + rx);
      const cy0 = this.coordOf(obb.center[1] - ry);
      const cy1 = this.coordOf(obb.center[1] + ry);
      const cz0 = this.coordOf(obb.center[2] - rz);
      const cz1 = this.coordOf(obb.center[2] + rz);
      for (let x = cx0; x <= cx1; x++)
        for (let y = cy0; y <= cy1; y++)
          for (let z = cz0; z <= cz1; z++) {
            const key = cellKey(x, y, z);
            const list = this.cells.get(key);
            if (list) list.push(o.id);
            else this.cells.set(key, [o.id]);
          }
    }
  }

  /** 3D DDA：把线段经过单元内的障碍物 id 收集进复用集合（调用方无需清空，方法内部清空） */
  queryInto(a: Vec3, b: Vec3, out: Set<string>): Set<string> {
    out.clear();
    let x = this.coordOf(a[0]);
    let y = this.coordOf(a[1]);
    let z = this.coordOf(a[2]);
    const ex = this.coordOf(b[0]);
    const ey = this.coordOf(b[1]);
    const ez = this.coordOf(b[2]);
    const dvx = b[0] - a[0];
    const dvy = b[1] - a[1];
    const dvz = b[2] - a[2];
    const stepX = Math.sign(dvx);
    const stepY = Math.sign(dvy);
    const stepZ = Math.sign(dvz);
    const cs = this.cellSize;
    const next = (origin: number, dir: number, cell: number): number => {
      if (Math.abs(dir) < 1e-12) return Infinity;
      const boundary = (cell + (dir > 0 ? 1 : 0)) * cs;
      return (boundary - origin) / dir;
    };
    let tMaxX = next(a[0], dvx, x);
    let tMaxY = next(a[1], dvy, y);
    let tMaxZ = next(a[2], dvz, z);
    const tDeltaX = Math.abs(cs / (dvx || 1e-12));
    const tDeltaY = Math.abs(cs / (dvy || 1e-12));
    const tDeltaZ = Math.abs(cs / (dvz || 1e-12));

    const collect = (cx: number, cy: number, cz: number): void => {
      const list = this.cells.get(cellKey(cx, cy, cz));
      if (list) for (const id of list) out.add(id);
    };
    collect(x, y, z);
    let guard = 0;
    while ((x !== ex || y !== ey || z !== ez) && guard++ < 4096) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        tMaxX += tDeltaX;
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        tMaxY += tDeltaY;
      } else {
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
      collect(x, y, z);
    }
    return out;
  }

  /** 兼容旧接口：返回内部复用集合（不要跨调用持有引用） */
  querySegment(a: Vec3, b: Vec3): Set<string> {
    return this.queryInto(a, b, this.scratch);
  }
}

// ---------- 遮挡判定：对整条采样折线求交并合并连续区间 ----------
/** 跨帧复用的候选集合与原始命中数组，降低 GC 压力 */
const sharedCandidates = new Set<string>();

export function computeOcclusions(
  samples: Vec3[],
  obstacles: Obstacle[],
  obbOf: (o: Obstacle) => OBB,
  grid: HashGrid,
): OcclusionSegment[] {
  if (samples.length < 2) return [];
  const byId = new Map(obstacles.map((o) => [o.id, o]));
  interface RawHit {
    obstacleId: string;
    tStart: number;
    tEnd: number;
    enter: Vec3;
    exit: Vec3;
  }
  const raw: RawHit[] = [];
  const n = samples.length - 1;
  const invN = 1 / n;
  for (let i = 0; i < n; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const candidates = grid.queryInto(a, b, sharedCandidates);
    for (const id of candidates) {
      const o = byId.get(id);
      if (!o || !o.visible) continue;
      const hit = segmentOBB(a, b, obbOf(o));
      if (!hit) continue;
      const base = i * invN;
      raw.push({
        obstacleId: id,
        tStart: base + hit.sEnter * invN,
        tEnd: base + hit.sExit * invN,
        enter: hit.enterPoint,
        exit: hit.exitPoint,
      });
    }
  }
  if (raw.length === 0) return [];

  // 按障碍物分组，按 t 排序后合并相邻区间（间隙小于 2 个采样步长视为连续）
  const groups = new Map<string, RawHit[]>();
  for (const h of raw) {
    const list = groups.get(h.obstacleId);
    if (list) list.push(h);
    else groups.set(h.obstacleId, [h]);
  }
  const mergeGap = 2 / n;
  const segments: OcclusionSegment[] = [];
  for (const [id, hits] of groups) {
    hits.sort((p, q) => p.tStart - q.tStart);
    let cur = { ...hits[0] };
    for (let i = 1; i < hits.length; i++) {
      const h = hits[i];
      if (h.tStart <= cur.tEnd + mergeGap) {
        cur.tEnd = Math.max(cur.tEnd, h.tEnd);
        cur.exit = h.exit;
      } else {
        segments.push(toSegment(id, byId, cur));
        cur = { ...h };
      }
    }
    segments.push(toSegment(id, byId, cur));
  }
  segments.sort((a, b) => a.tStart - b.tStart);
  return segments;
}

function toSegment(
  id: string,
  byId: Map<string, Obstacle>,
  h: { tStart: number; tEnd: number; enter: Vec3; exit: Vec3 },
): OcclusionSegment {
  const o = byId.get(id);
  return {
    obstacleId: id,
    obstacleName: o?.name ?? id,
    tStart: h.tStart,
    tEnd: h.tEnd,
    enterPosition: clone3(h.enter),
    exitPosition: clone3(h.exit),
  };
}

/** 按全局 t 在采样折线上取点 */
export function sampleAt(samples: Vec3[], t: number): Vec3 {
  if (samples.length < 2) return [0, 0, 0];
  const clamped = Math.min(1, Math.max(0, t));
  const f = clamped * (samples.length - 1);
  const i = Math.min(samples.length - 2, Math.floor(f));
  return lerp(samples[i], samples[i + 1], f - i);
}
