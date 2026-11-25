import { DENSITY_CONFIG } from './config';
import { habitability, Heightfield } from './terrain';
import type { EraseMask } from './erase-mask';
import type {
  LayerKind,
  ScatterParams,
  ScatterZone,
  VegetationInstance,
} from './types';

export const TREE_VARIANTS = 5;
export const BUSH_VARIANTS = 4;

/** 简单空间哈希，用于最小间距判定 */
export class SpatialHash<T extends { x: number; y: number }> {
  private cell: number;
  private buckets = new Map<number, T[]>();

  constructor(cellSize: number) {
    this.cell = Math.max(4, cellSize);
  }

  private key(cx: number, cy: number): number {
    return (cx + 8192) * 16384 + (cy + 8192);
  }

  insert(p: T): void {
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    const k = this.key(cx, cy);
    let arr = this.buckets.get(k);
    if (!arr) {
      arr = [];
      this.buckets.set(k, arr);
    }
    arr.push(p);
  }

  /** 半径 r 内是否存在点（可通过 exclude 排除自身） */
  hasWithin(x: number, y: number, r: number, exclude?: T): boolean {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c);
    const y1 = Math.floor((y + r) / c);
    const r2 = r * r;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.buckets.get(this.key(cx, cy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i];
          if (p === exclude) continue;
          const dx = p.x - x;
          const dy = p.y - y;
          if (dx * dx + dy * dy < r2) return true;
        }
      }
    }
    return false;
  }
}

export interface ScatterLayerOptions {
  zone: ScatterZone;
  layer: LayerKind;
  seedRng: () => number;
  params: ScatterParams;
  hf: Heightfield;
  mask: EraseMask;
  allocId: () => number;
  ownHash: SpatialHash<VegetationInstance>;
  crossHash?: SpatialHash<VegetationInstance>;
}

/**
 * 在单个区域内生成一个植被层的实例。
 * 采样：抖动网格 + 空间哈希最小间距；
 * 准入：地形高度 / 坡度适宜度概率 + 擦除掩码。
 */
export function scatterZoneLayer(opts: ScatterLayerOptions): VegetationInstance[] {
  const { zone, layer, seedRng: rng, params, hf, mask, allocId, ownHash, crossHash } = opts;
  const isTree = layer === 'trees';
  const spacing = params.minSpacing;

  // 树木间距大，灌木更紧凑；乔灌之间保留适度间隔
  const ownDistance = isTree ? spacing : spacing * 0.5;
  const crossDistance = spacing * 0.72;

  const tier = DENSITY_CONFIG[params.density];
  const area = zone.w * zone.h;
  const baseCount = area / (spacing * spacing);
  const share = isTree ? params.treeRatio : 1 - params.treeRatio;
  // 灌木天然更簇生，给一个数量加成
  const clusterMul = isTree ? 1 : 1.7;
  const target = baseCount * tier.targetFactor * share * clusterMul;
  if (target < 0.5) return [];

  const sampleCell = Math.max(5, ownDistance * tier.cellFactor);
  const cols = Math.max(1, Math.ceil(zone.w / sampleCell));
  const rows = Math.max(1, Math.ceil(zone.h / sampleCell));
  const cellW = zone.w / cols;
  const cellH = zone.h / rows;
  const cellCount = cols * rows;

  // 每个格子的尝试概率，使期望数量贴近 target；略过采样补偿准入损耗
  const acceptProb = Math.min(1, (target * 1.28) / cellCount);

  const out: VegetationInstance[] = [];

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (rng() > acceptProb) continue;

      // 高密度且概率打满时，每格尝试两个候选，由间距哈希做最终裁决
      const attempts = acceptProb >= 0.985 ? 2 : 1;
      for (let a = 0; a < attempts; a++) {
        const px = zone.x + gx * cellW + rng() * cellW;
        const py = zone.y + gy * cellH + rng() * cellH;
        if (px < zone.x + 2 || px > zone.x + zone.w - 2) continue;
        if (py < zone.y + 2 || py > zone.y + zone.h - 2) continue;

        // 已擦除区域
        if (mask.test(px, py)) continue;

        const h = hf.heightAt(px, py);
        const slope = hf.slopeAt(px, py);
        const habit = habitability(h, slope);
        if (habit <= 0) continue;
        // 陡坡 / 高海拔自动稀疏
        if (rng() > habit) continue;

        // 最小间距（同层 + 异层）
        if (ownHash.hasWithin(px, py, ownDistance)) continue;
        if (crossHash && crossHash.hasWithin(px, py, crossDistance)) continue;

        const sizeBase = isTree ? 42 : 25;
        const sizeVar = isTree ? 28 : 20;
        const size = (sizeBase + rng() * sizeVar) * (0.85 + 0.25 * habit);

        // 变体权重：树木以三种绿色为主，少量金叶 / 红叶点缀
        const vr = rng();
        let variant: number;
        if (isTree) {
          variant =
            vr < 0.84
              ? Math.min(2, Math.floor((vr / 0.84) * 3))
              : vr < 0.93
                ? 3
                : 4;
        } else {
          // 灌木：两种基础绿最常见，花 / 浆果变体少量点缀
          variant = vr < 0.38 ? 0 : vr < 0.74 ? 1 : vr < 0.9 ? 2 : 3;
        }

        const inst: VegetationInstance = {
          id: allocId(),
          layer,
          zoneId: zone.id,
          x: px,
          y: py,
          h,
          slope,
          size,
          rot: (rng() - 0.5) * 0.5,
          variant,
        };
        ownHash.insert(inst);
        out.push(inst);
      }
    }
  }
  return out;
}
