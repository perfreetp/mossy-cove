import { TERRAIN_RULES, WORLD } from './config';
import { mulberry32 } from './rng';

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 整数格点哈希噪声，返回 0~1 */
function hashNoise(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) +
    Math.imul(iy, 668265263) +
    Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const v00 = hashNoise(ix, iy, seed);
  const v10 = hashNoise(ix + 1, iy, seed);
  const v01 = hashNoise(ix, iy + 1, seed);
  const v11 = hashNoise(ix + 1, iy + 1, seed);

  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/**
 * 沙盘地形高度场。
 * heights 长度 (cols+1)*(rows+1)，格点间距 WORLD.cell。
 */
export class Heightfield {
  readonly cols = WORLD.cols;
  readonly rows = WORLD.rows;
  readonly cell = WORLD.cell;
  readonly w = WORLD.w;
  readonly h = WORLD.h;
  readonly heights: Float32Array;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.heights = new Float32Array((this.cols + 1) * (this.rows + 1));
    this.generate();
  }

  private idx(gx: number, gy: number): number {
    return gy * (this.cols + 1) + gx;
  }

  private generate(): void {
    const { cols, rows } = this;
    let min = Infinity;
    let max = -Infinity;
    const raw = new Float32Array(this.heights.length);

    for (let gy = 0; gy <= rows; gy++) {
      const ny = gy / rows;
      for (let gx = 0; gx <= cols; gx++) {
        const nx = gx / cols;

        // 大尺度起伏 + 山脊
        const warp = fbm(nx * 2.4 + 31.7, ny * 2.4 + 11.2, this.seed ^ 0x9e37, 3);
        const base = fbm(nx * 3.1 + warp * 0.9, ny * 3.1 + warp * 0.9, this.seed, 5);
        const ridgeN = fbm(nx * 2.3 + 80, ny * 2.6 + 40, this.seed ^ 0x51ed, 4);
        const ridge = 1 - Math.abs(ridgeN * 2 - 1);
        let v = base * 0.74 + ridge * ridge * 0.26;

        // 椭圆形海岛式边缘跌落，形成水岸与沙盘边缘
        const dx = (nx - 0.5) / 0.52;
        const dy = (ny - 0.52) / 0.5;
        const radial = Math.sqrt(dx * dx * 0.86 + dy * dy * 1.12);
        const mask = 1 - smoothstep(0.62, 1.08, radial);
        v = v * (0.32 + 0.68 * mask) - (1 - mask) * 0.34;

        raw[this.idx(gx, gy)] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    // 归一化到 0.03~0.99，让高度带阈值在任何种子下语义稳定
    const span = max - min || 1;
    for (let i = 0; i < raw.length; i++) {
      this.heights[i] = 0.03 + ((raw[i] - min) / span) * 0.96;
    }
  }

  /** 世界坐标（地形局部）处的双线性高度 */
  heightAt(x: number, y: number): number {
    const gxf = clampNum(x / this.cell, 0, this.cols);
    const gyf = clampNum(y / this.cell, 0, this.rows);
    const x0 = Math.floor(gxf);
    const y0 = Math.floor(gyf);
    const x1 = Math.min(x0 + 1, this.cols);
    const y1 = Math.min(y0 + 1, this.rows);
    const tx = gxf - x0;
    const ty = gyf - y0;

    const h00 = this.heights[this.idx(x0, y0)];
    const h10 = this.heights[this.idx(x1, y0)];
    const h01 = this.heights[this.idx(x0, y1)];
    const h11 = this.heights[this.idx(x1, y1)];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * ty;
  }

  /** 坡度（度），中心差分 */
  slopeAt(x: number, y: number): number {
    const e = 8;
    const dhdx = (this.heightAt(x + e, y) - this.heightAt(x - e, y)) / (2 * e);
    const dhdy = (this.heightAt(x, y + e) - this.heightAt(x, y - e)) / (2 * e);
    const gx = dhdx * TERRAIN_RULES.relief;
    const gy = dhdy * TERRAIN_RULES.relief;
    return (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
  }

  /** 高度直方图（供高度带控制条绘制） */
  histogram(bins = 56): number[] {
    const out = new Array<number>(bins).fill(0);
    for (const h of this.heights) {
      const b = Math.min(bins - 1, Math.max(0, Math.floor(h * bins)));
      out[b]++;
    }
    return out;
  }
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 种植适宜度 0~1：水下 / 过高 / 过陡都会降低，极端位置为 0 */
export function habitability(h: number, slopeDeg: number): number {
  const r = TERRAIN_RULES;
  if (h < r.waterLevel - 0.015) return 0;
  if (h >= r.maxHeight) return 0;
  if (slopeDeg >= r.maxSlope) return 0;

  // 紧邻水岸略稀疏
  let p = smoothstep(r.waterLevel - 0.015, r.waterLevel + 0.05, h);
  // 高海拔稀疏
  p *= 1 - smoothstep(r.softHeight, r.maxHeight, h);
  // 陡坡稀疏
  p *= 1 - smoothstep(r.softSlope, r.maxSlope, slopeDeg);
  return clamp01(p);
}

export interface SuggestedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 在地形上寻找几块相对平缓、高度适中且彼此分离的矩形作为初始散布区域，
 * 保证首次打开就能看到效果，而不是把区域划在水面或雪峰上。
 */
export function suggestZones(hf: Heightfield, count = 3): SuggestedRect[] {
  const rng = mulberry32(hf.seed ^ 0x7a0e5);

  // 三个互不重叠的搜索带（左坡 / 右坡 / 下麓），绕开中央主峰
  const searchWindows = [
    { x0: 130, x1: 760, y0: 470, y1: 1180, w: 860, h: 560 },
    { x0: 1650, x1: 2470, y0: 300, y1: 980, w: 800, h: 540 },
    { x0: 760, x1: 1760, y0: 1120, y1: 1560, w: 1020, h: 470 },
  ];

  const scoreRect = (x: number, y: number, w: number, h: number): number => {
    let sumH = 0;
    let sumSlope = 0;
    let habitable = 0;
    const samples = 30;
    for (let s = 0; s < samples; s++) {
      const px = x + rng() * w;
      const py = y + rng() * h;
      const hh = hf.heightAt(px, py);
      const sl = hf.slopeAt(px, py);
      sumH += hh;
      sumSlope += sl;
      if (habitability(hh, sl) > 0.45) habitable++;
    }
    const meanH = sumH / samples;
    const meanSlope = sumSlope / samples;
    const goodRatio = habitable / samples;
    const heightDist = Math.abs(meanH - 0.46);
    return goodRatio * 2 - heightDist * 2.4 - Math.max(0, meanSlope - 9) * 0.06;
  };

  const picked: SuggestedRect[] = [];
  for (let wi = 0; wi < searchWindows.length && picked.length < count; wi++) {
    const win = searchWindows[wi];
    let best: (SuggestedRect & { score: number }) | null = null;
    for (let i = 0; i < 120; i++) {
      const w = win.w + (rng() - 0.5) * 120;
      const h = win.h + (rng() - 0.5) * 90;
      const x = win.x0 + rng() * Math.max(1, win.x1 - win.x0 - w);
      const y = win.y0 + rng() * Math.max(1, win.y1 - win.y0 - h);
      const score = scoreRect(x, y, w, h);
      if (!best || score > best.score) best = { x, y, w, h, score };
    }
    if (best && best.score > 0.1) {
      picked.push({
        x: Math.round(best.x),
        y: Math.round(best.y),
        w: Math.round(best.w),
        h: Math.round(best.h),
      });
    }
  }

  // 兜底：固定的三块候选地
  const fallback: SuggestedRect[] = [
    { x: 150, y: 520, w: 820, h: 560 },
    { x: 1640, y: 360, w: 820, h: 540 },
    { x: 800, y: 1130, w: 1000, h: 460 },
  ];
  let fi = 0;
  while (picked.length < count && fi < fallback.length) {
    const cand = fallback[fi++];
    const overlap = picked.some(
      (p) =>
        cand.x < p.x + p.w + 40 &&
        cand.x + cand.w + 40 > p.x &&
        cand.y < p.y + p.h + 40 &&
        cand.y + cand.h + 40 > p.y,
    );
    if (!overlap) picked.push(cand);
  }
  return picked;
}
