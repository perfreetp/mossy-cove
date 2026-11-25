import { RNG, clamp, lerp } from './mathUtils';

/**
 * 确定性地形噪声模型。
 * 基于种子化梯度值噪声 + fBm + 脊线（ridged）变换，
 * 三个滑杆分别映射：山脊起伏 relief / 破碎度 fragmentation / 基准高度 baseHeight。
 */

const GRAD_SIZE = 256;

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export class TerrainNoise {
  private readonly grad: Float32Array;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const rng = new RNG(this.seed);
    this.grad = new Float32Array(GRAD_SIZE * GRAD_SIZE);
    for (let i = 0; i < this.grad.length; i++) this.grad[i] = rng.next() * 2 - 1;
  }

  /** 二维平滑值噪声，输出约 [-1, 1]。 */
  valueNoise(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const ix = ((x0 % GRAD_SIZE) + GRAD_SIZE) % GRAD_SIZE;
    const iy = ((y0 % GRAD_SIZE) + GRAD_SIZE) % GRAD_SIZE;
    const ix1 = (ix + 1) % GRAD_SIZE;
    const iy1 = (iy + 1) % GRAD_SIZE;
    const g = this.grad;
    const stride = GRAD_SIZE;
    const v00 = g[iy * stride + ix];
    const v10 = g[iy * stride + ix1];
    const v01 = g[iy1 * stride + ix];
    const v11 = g[iy1 * stride + ix1];
    return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
  }

  /** 脊线噪声：1 - |noise| 形成尖锐山脊，输出 [0, 1]。 */
  ridged(x: number, y: number, frequency: number): number {
    const n = this.valueNoise(x * frequency, y * frequency);
    return 1 - Math.abs(n);
  }

  fbm(x: number, y: number, octaves: number, lacunarity = 2.02, gain = 0.5): number {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.valueNoise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / Math.max(norm, 1e-6);
  }
}

export interface TerrainParams {
  seed: number;
  /** 山脊起伏 0..1 —— 控制地形整体落差 */
  relief: number;
  /** 破碎度 0..1 —— 控制高频细节层数与脊线锐度 */
  fragmentation: number;
  /** 基准高度 0..1 —— 整体抬升/下沉 */
  baseHeight: number;
}

export const DEFAULT_TERRAIN_PARAMS: TerrainParams = {
  seed: 1337,
  relief: 0.62,
  fragmentation: 0.5,
  baseHeight: 0.42
};

/** 世界尺寸（单位与 Babylon 场景一致）。 */
export const WORLD_SIZE = 220;
/** 高度场网格分辨率（顶点数 = (N+1)^2，默认约 3.7 万顶点）。 */
export const TERRAIN_SEGMENTS = 192;
/** 笔刷位移图分辨率。 */
export const BRUSH_MAP_SIZE = 128;

export class TerrainModel {
  readonly size = WORLD_SIZE;
  readonly segments = TERRAIN_SEGMENTS;
  readonly brushSize = BRUSH_MAP_SIZE;
  /** 程序化基础高度（不含笔刷修改），尺寸 (segments+1)^2。 */
  readonly baseHeights: Float32Array;
  /** 笔刷位移图，尺寸 brushSize^2，双线性采样后叠加到基础高度。 */
  readonly brushMap: Float32Array;

  params: TerrainParams;
  private noise: TerrainNoise;

  constructor(params: TerrainParams) {
    this.params = { ...params };
    this.noise = new TerrainNoise(this.params.seed);
    this.baseHeights = new Float32Array((TERRAIN_SEGMENTS + 1) ** 2);
    this.brushMap = new Float32Array(BRUSH_MAP_SIZE ** 2);
    this.rebuildBase();
  }

  /** 滑杆调整或换种子后重算基础高度场。 */
  rebuildBase(params?: TerrainParams): void {
    if (params) {
      this.params = { ...params };
      this.noise = new TerrainNoise(this.params.seed);
    }
    const { relief, fragmentation } = this.params;
    const n = TERRAIN_SEGMENTS + 1;
    const octaves = 3 + Math.round(fragmentation * 5); // 3..8
    const ridgeSharpness = lerp(1.1, 2.6, fragmentation);
    const detailGain = lerp(0.35, 0.62, fragmentation);
    const amplitude = lerp(20, 96, relief);
    const base = lerp(-14, 30, this.params.baseHeight);
    const noise = this.noise;

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u = i / TERRAIN_SEGMENTS;
        const v = j / TERRAIN_SEGMENTS;
        // 宽尺度基底起伏
        const broad = noise.fbm(u * 2.2 + 7.3, v * 2.2 - 3.1, 3, 2.1, 0.55) * 0.5 + 0.5;
        // 脊线多层叠加
        let ridge = 0;
        let amp = 0.55;
        let freq = 3.2;
        let norm = 0;
        for (let o = 0; o < octaves; o++) {
          const r = noise.ridged(u + 11.7, v - 5.2, freq);
          ridge += amp * Math.pow(r, ridgeSharpness);
          norm += amp;
          amp *= detailGain;
          freq *= 2.03;
        }
        ridge /= Math.max(norm, 1e-6);
        // 脊线占主导，配合峰值拉伸形成清晰山体而非平缓起伏
        const h01 = clamp(broad * 0.3 + ridge * 0.7, 0, 1);
        // 峰值略作指数拉伸，让高山更突出
        const shaped = Math.pow(h01, lerp(1.2, 0.75, relief));
        this.baseHeights[j * n + i] = base + shaped * amplitude;
      }
    }
  }

  /** 世界坐标 -> 网格索引浮点位置。 */
  private toGrid(x: number, z: number): [number, number] {
    const u = clamp((x + WORLD_SIZE / 2) / WORLD_SIZE, 0, 1);
    const v = clamp((z + WORLD_SIZE / 2) / WORLD_SIZE, 0, 1);
    return [u * TERRAIN_SEGMENTS, v * TERRAIN_SEGMENTS];
  }

  private sampleBilinear(data: Float32Array, dim: number, fu: number, fv: number): number {
    const x0 = Math.floor(fu);
    const y0 = Math.floor(fv);
    const tx = fu - x0;
    const ty = fv - y0;
    const x1 = Math.min(x0 + 1, dim - 1);
    const y1 = Math.min(y0 + 1, dim - 1);
    const h00 = data[y0 * dim + x0];
    const h10 = data[y0 * dim + x1];
    const h01 = data[y1 * dim + x0];
    const h11 = data[y1 * dim + x1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), ty);
  }

  /** 笔刷位移在世界坐标处的采样值。 */
  brushOffsetAt(x: number, z: number): number {
    const [gx, gy] = this.toGrid(x, z);
    const fu = (gx / TERRAIN_SEGMENTS) * (BRUSH_MAP_SIZE - 1);
    const fv = (gy / TERRAIN_SEGMENTS) * (BRUSH_MAP_SIZE - 1);
    return this.sampleBilinear(this.brushMap, BRUSH_MAP_SIZE, fu, fv);
  }

  /** 合成高度（基础 + 笔刷），云团贴合与投影定位都用它。 */
  heightAt(x: number, z: number): number {
    const [gx, gy] = this.toGrid(x, z);
    const base = this.sampleBilinear(this.baseHeights, TERRAIN_SEGMENTS + 1, gx, gy);
    return base + this.brushOffsetAt(x, z);
  }

  /**
   * 在世界坐标处施加笔刷。
   * @returns 受影响的笔刷图索引与修改后的新值（用于历史记录/局部刷新）
   */
  applyBrush(
    worldX: number,
    worldZ: number,
    radius: number,
    strength: number,
    direction: 1 | -1
  ): BrushPatch {
    const half = WORLD_SIZE / 2;
    const cellsPerUnit = BRUSH_MAP_SIZE / WORLD_SIZE;
    const rCells = radius * cellsPerUnit;
    const cx = ((worldX + half) / WORLD_SIZE) * (BRUSH_MAP_SIZE - 1);
    const cz = ((worldZ + half) / WORLD_SIZE) * (BRUSH_MAP_SIZE - 1);
    const minX = Math.max(0, Math.floor(cx - rCells));
    const maxX = Math.min(BRUSH_MAP_SIZE - 1, Math.ceil(cx + rCells));
    const minZ = Math.max(0, Math.floor(cz - rCells));
    const maxZ = Math.min(BRUSH_MAP_SIZE - 1, Math.ceil(cz + rCells));
    const indices: number[] = [];
    const values: number[] = [];
    const r2 = rCells * rCells;
    const maxOffset = 42;

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        const t = 1 - Math.sqrt(d2) / rCells;
        const falloff = t * t * (3 - 2 * t);
        const idx = z * BRUSH_MAP_SIZE + x;
        const next = clamp(
          this.brushMap[idx] + direction * strength * falloff,
          -maxOffset,
          maxOffset
        );
        if (next !== this.brushMap[idx]) {
          this.brushMap[idx] = next;
          indices.push(idx);
          values.push(next);
        }
      }
    }
    return { indices, values, bounds: { minX, maxX, minZ, maxZ } };
  }

  /**
   * 山脊评分：相对周围邻域的凸起程度 + 绝对高度，
   * 供云团沿山脊自动环绕分布使用。
   */
  ridgeScore(x: number, z: number): number {
    const h = this.heightAt(x, z);
    const span = WORLD_SIZE * 0.06;
    const neighbors = [
      this.heightAt(x - span, z),
      this.heightAt(x + span, z),
      this.heightAt(x, z - span),
      this.heightAt(x, z + span),
      this.heightAt(x - span * 0.7, z - span * 0.7),
      this.heightAt(x + span * 0.7, z + span * 0.7)
    ];
    const avg = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
    const prominence = Math.max(0, h - avg);
    return prominence * 1.4 + h * 0.25;
  }
}

export interface BrushPatch {
  indices: number[];
  values: number[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}
