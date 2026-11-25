import { TERRAIN_RULES } from '../core/config';
import { Heightfield } from '../core/terrain';

type RGB = [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 按高度 / 坡度取地表基色 */
function groundColor(h: number, slope: number): RGB {
  const r = TERRAIN_RULES;
  // 水体：深 -> 浅
  if (h < r.waterLevel) {
    const t = smoothstep(r.waterLevel - 0.22, r.waterLevel, h);
    return mix([24, 74, 104], [66, 158, 184], t);
  }
  // 湿沙 / 沙滩
  if (h < r.waterLevel + 0.028) {
    const t = (h - r.waterLevel) / 0.028;
    return mix([196, 178, 132], [216, 198, 148], t);
  }
  // 低地草地
  if (h < 0.42) {
    const t = (h - (r.waterLevel + 0.028)) / (0.42 - r.waterLevel - 0.028);
    return mix([126, 168, 92], [92, 148, 74], t);
  }
  // 森林绿
  if (h < 0.6) {
    const t = (h - 0.42) / 0.18;
    return mix([74, 132, 66], [52, 102, 54], t);
  }
  // 高山草甸 -> 裸岩
  let c = mix([74, 104, 64], [132, 124, 108], smoothstep(0.6, 0.74, h));
  // 坡度越大越偏岩石
  const rockBySlope = smoothstep(24, 40, slope);
  c = mix(c, [128, 120, 108], rockBySlope * 0.85);
  // 雪线
  const snow = smoothstep(0.86, 0.93, h) * (1 - smoothstep(34, 46, slope));
  c = mix(c, [236, 242, 245], snow);
  return c;
}

/**
 * 把高度场绘制成带山体阴影的地形位图。
 * 分辨率不需要等于世界尺寸，Pixi 会缩放到 WORLD.w × WORLD.h。
 */
export function paintTerrainCanvas(hf: Heightfield): HTMLCanvasElement {
  const PW = 980;
  const PH = Math.round((PW * hf.h) / hf.w);
  const canvas = document.createElement('canvas');
  canvas.width = PW;
  canvas.height = PH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const img = ctx.createImageData(PW, PH);
  const data = img.data;
  const e = 7;

  // 光源方向（左上）
  const lx = -0.52;
  const ly = -0.62;
  const lz = 0.78;
  const lLen = Math.hypot(lx, ly, lz);

  for (let py = 0; py < PH; py++) {
    const wy = ((py + 0.5) / PH) * hf.h;
    for (let px = 0; px < PW; px++) {
      const wx = ((px + 0.5) / PW) * hf.w;
      const h = hf.heightAt(wx, wy);
      const slope = hf.slopeAt(wx, wy);

      // 由高度梯度算法线，做山体阴影
      const dhdx =
        ((hf.heightAt(wx + e, wy) - hf.heightAt(wx - e, wy)) / (2 * e)) *
        TERRAIN_RULES.relief;
      const dhdy =
        ((hf.heightAt(wx, wy + e) - hf.heightAt(wx, wy - e)) / (2 * e)) *
        TERRAIN_RULES.relief;
      let nx = -dhdx;
      let ny = -dhdy;
      let nz = 1;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;
      const dot = (nx * lx + ny * ly + nz * lz) / lLen;
      const shade = 0.74 + 0.4 * Math.max(0, dot) - 0.1 * Math.max(0, -dot);

      let [r, g, b] = groundColor(h, slope);

      // 细微色彩噪声，避免大面积平涂
      const micro =
        ((((px * 73856093) ^ (py * 19349663) ^ hf.seed) >>> 0) % 1000) / 1000 -
        0.5;
      const n = micro * 9;

      if (h < TERRAIN_RULES.waterLevel) {
        // 水面轻微波光
        const wave = Math.sin(wx * 0.05 + wy * 0.031) * 4;
        r = r * shade + wave;
        g = g * shade + wave;
        b = b * (shade + 0.06) + wave;
      } else {
        r = r * shade + n;
        g = g * shade + n;
        b = b * shade + n;
      }

      const di = (py * PW + px) * 4;
      data[di] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[di + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[di + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      data[di + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
