import { clamp, smoothstep, WORLD_SIZE } from './config';

export function indexAt(i: number, j: number, rowLength: number): number {
  return j * rowLength + i;
}

function gaussian(x: number, z: number, cx: number, cz: number, amp: number, sx: number, sz = sx): number {
  const dx = (x - cx) / sx;
  const dz = (z - cz) / sz;
  return amp * Math.exp(-0.5 * (dx * dx + dz * dz));
}

export function generateHeightField(resolution: number): Float32Array {
  const row = resolution + 1;
  const heights = new Float32Array(row * row);
  const half = WORLD_SIZE / 2;

  for (let j = 0; j <= resolution; j++) {
    const z = (j / resolution - 0.5) * WORLD_SIZE;
    for (let i = 0; i <= resolution; i++) {
      const x = (i / resolution - 0.5) * WORLD_SIZE;
      let h = 0.72;
      h += gaussian(x, z, -4.4, -3.2, 4.1, 3.2, 2.7);
      h += gaussian(x, z, 3.8, 1.6, 3.1, 2.2, 3.8);
      h += gaussian(x, z, 4.8, -4.7, 1.65, 1.7, 1.5);
      h += gaussian(x, z, -1.2, 4.6, 1.35, 3.8, 1.8);
      h += 0.22 * Math.sin(x * 0.72 + 1.4) * Math.cos(z * 0.58 - 0.6);
      h += 0.11 * Math.sin(x * 1.7 + z * 0.9);
      h += 0.07 * Math.cos(z * 2.1 - x * 0.35);

      const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
      h -= 2.35 * smoothstep(0.7, 1.03, edge);
      heights[indexAt(i, j, row)] = clamp(h, -4.8, 9);
    }
  }
  return heights;
}

export function resampleHeightField(old: Float32Array, oldRes: number, newRes: number): Float32Array {
  if (oldRes === newRes) return old.slice();
  const next = new Float32Array((newRes + 1) ** 2);
  const oldRow = oldRes + 1;
  for (let j = 0; j <= newRes; j++) {
    const fy = (j / newRes) * oldRes;
    const j0 = Math.floor(fy);
    const j1 = Math.min(oldRes, j0 + 1);
    const ty = fy - j0;
    for (let i = 0; i <= newRes; i++) {
      const fx = (i / newRes) * oldRes;
      const i0 = Math.floor(fx);
      const i1 = Math.min(oldRes, i0 + 1);
      const tx = fx - i0;
      const h00 = old[indexAt(i0, j0, oldRow)];
      const h10 = old[indexAt(i1, j0, oldRow)];
      const h01 = old[indexAt(i0, j1, oldRow)];
      const h11 = old[indexAt(i1, j1, oldRow)];
      const a = h00 + (h10 - h00) * tx;
      const b = h01 + (h11 - h01) * tx;
      next[indexAt(i, j, newRes + 1)] = a + (b - a) * ty;
    }
  }
  return next;
}

export function sampleHeightWorld(heights: Float32Array, resolution: number, x: number, z: number): number {
  const row = resolution + 1;
  const cell = WORLD_SIZE / resolution;
  const gx = clamp(x / cell + resolution / 2, 0, resolution);
  const gz = clamp(z / cell + resolution / 2, 0, resolution);
  const i0 = Math.floor(gx);
  const j0 = Math.floor(gz);
  const i1 = Math.min(resolution, i0 + 1);
  const j1 = Math.min(resolution, j0 + 1);
  const tx = gx - i0;
  const tz = gz - j0;
  const h00 = heights[indexAt(i0, j0, row)];
  const h10 = heights[indexAt(i1, j0, row)];
  const h01 = heights[indexAt(i0, j1, row)];
  const h11 = heights[indexAt(i1, j1, row)];
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

export function heightStats(heights: Float32Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (h < min) min = h;
    if (h > max) max = h;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (max - min < 0.001) {
    min -= 0.5;
    max += 0.5;
  }
  return { min, max };
}
