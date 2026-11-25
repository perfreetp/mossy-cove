import { RNG, TAU, clamp, dist2 } from './mathUtils';
import { TerrainModel, WORLD_SIZE } from './noise';

/**
 * 云团数据模型与沿山脊的自动环绕分布。
 * 三档参数：密度 density / 厚度 thickness / 高度 height，每档取值 1..3。
 */

export type CloudTier = 1 | 2 | 3;

export interface CloudBlob {
  id: string;
  /** 世界坐标 XZ；y 由贴合算法计算后回填（displayY） */
  x: number;
  z: number;
  /** 用户垂直偏移（档位高度的附加调整空间，保持简单：固定档位） */
  density: CloudTier;
  thickness: CloudTier;
  height: CloudTier;
  /** 云团半径（米），由密度/厚度档位推导并带随机变化 */
  radius: number;
  visible: boolean;
  locked: boolean;
  /** 自动分布时的山脊朝向（用于初始排列与投影朝向） */
  orientation: number;
  /** 贴合高度：相对地表的悬浮距离，由 height 档位决定 */
  clearance: number;
}

export interface CloudSceneState {
  blobs: CloudBlob[];
  /** 全局贴合程度 0..1：0 = 贴地飞行，1 = 高位悬浮 */
  cling: number;
}

export const DEFAULT_CLING = 0.35;
/** 云团之间的最小中心间距系数（乘以两云半径均值） */
export const MIN_GAP_FACTOR = 0.55;

let idCounter = 0;
export function nextCloudId(): string {
  idCounter += 1;
  return `cloud-${Date.now().toString(36)}-${idCounter}`;
}

export function radiusFromTiers(density: CloudTier, thickness: CloudTier, jitter: number): number {
  // 世界尺寸 220m，云团半径控制在 7~13m，避免单云糊满视野
  const base = 5.5 + density * 1.8 + thickness * 1.1; // 8.4..13
  return base * (1 + jitter * 0.3);
}

export function clearanceFromHeight(height: CloudTier, cling: number): number {
  // cling 越大整体悬浮越高；档位高度再叠加差异
  const tierBase = height * 5; // 5 / 10 / 15
  const globalLift = cling * 22;
  return tierBase + globalLift + 4;
}

/**
 * 沿山脊自动环绕分布：
 * 1. 在规则候选网格上用 ridgeScore 采样；
 * 2. 加权随机（分数越高越可能入选）挑选峰值点；
 * 3. 对已选点强制最小间距，形成环绕山脊的链状分布；
 * 4. 用角度排序让云团大致沿山脊走向环绕。
 */
export function distributeCloudsAlongRidges(
  terrain: TerrainModel,
  count: number,
  seed: number,
  existing: CloudBlob[] = []
): CloudBlob[] {
  const rng = new RNG(seed);
  const half = WORLD_SIZE / 2 * 0.86;
  const gridN = 26;
  interface Candidate {
    x: number;
    z: number;
    score: number;
  }
  const candidates: Candidate[] = [];
  for (let i = 0; i < gridN; i++) {
    for (let j = 0; j < gridN; j++) {
      const x = -half + (2 * half * i) / (gridN - 1) + rng.range(-3, 3);
      const z = -half + (2 * half * j) / (gridN - 1) + rng.range(-3, 3);
      candidates.push({ x, z, score: terrain.ridgeScore(x, z) });
    }
  }
  // 分数归一化后做幂次加权，优先高峰但保留随机性
  const maxScore = Math.max(...candidates.map((c) => c.score), 1e-6);
  const weighted = candidates.map((c) => ({
    c,
    w: Math.pow(c.score / maxScore, 2.2) * (0.25 + rng.next() * 0.75)
  }));
  weighted.sort((a, b) => b.w - a.w);

  const placed: CloudBlob[] = [];
  const minSeparation = 13;
  for (const item of weighted) {
    if (placed.length >= count) break;
    const { x, z } = item.c;
    const tooClose = placed.some((p) => dist2(p.x, p.z, x, z) < minSeparation * minSeparation);
    if (tooClose) continue;
    const density = (1 + rng.int(0, 3)) as CloudTier;
    const thickness = (1 + rng.int(0, 3)) as CloudTier;
    const height = (1 + rng.int(0, 3)) as CloudTier;
    placed.push({
      id: nextCloudId(),
      x,
      z,
      density,
      thickness,
      height,
      radius: radiusFromTiers(density, thickness, rng.next() * 2 - 1),
      visible: true,
      locked: false,
      orientation: rng.range(0, TAU),
      clearance: 0
    });
  }

  // 环绕排序：相对场景中心的极角排序，形成视觉上的环绕链
  placed.sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
  // 保留已有云团的显隐/锁定设置（按顺序匹配）
  existing.forEach((old, i) => {
    if (placed[i]) {
      placed[i].visible = old.visible;
      placed[i].locked = old.locked;
      placed[i].id = old.id;
    }
  });
  return placed;
}

/**
 * 拖拽时维持最小间距：把新位置相对所有邻居推出到允许半径之外。
 * 多轮松弛处理多云团挤压，最后对最近的冲突云团做一次硬投影，
 * 保证被拖拽云团不会停在任何相邻云团内部。
 *
 * 边界处理：分离迭代期间不做钳制——邻居可能紧贴边界，
 * 钳制会吃掉修正量；仅在最终已无冲突时才把位置收回边界内。
 */
export function resolveCloudSeparation(
  blobs: CloudBlob[],
  movingId: string,
  nx: number,
  nz: number
): { x: number; z: number } {
  const half = WORLD_SIZE / 2 - 4;
  let x = clamp(nx, -half, half);
  let z = clamp(nz, -half, half);
  const moving = blobs.find((b) => b.id === movingId);
  if (!moving) return { x, z };

  // 多轮位置松弛（其余云团固定且彼此不重叠，通常 2-3 轮即收敛）
  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    for (const other of blobs) {
      if (other.id === movingId || !other.visible) continue;
      const minDist = (moving.radius + other.radius) * MIN_GAP_FACTOR;
      const dx = x - other.x;
      const dz = z - other.z;
      const d = Math.hypot(dx, dz);
      if (d < minDist) {
        if (d < 1e-4) {
          const ang = iter * 1.7 + 0.5;
          x = other.x + Math.cos(ang) * minDist;
          z = other.z + Math.sin(ang) * minDist;
        } else {
          const push = minDist - d;
          x += (dx / d) * push;
          z += (dz / d) * push;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }

  // 最终硬投影：若仍与某云团重叠，沿最近冲突者的方向推到恰好 minDist
  let worst: { other: CloudBlob; d: number } | null = null;
  for (const other of blobs) {
    if (other.id === movingId || !other.visible) continue;
    const d = Math.hypot(x - other.x, z - other.z);
    if (d < (moving.radius + other.radius) * MIN_GAP_FACTOR && (!worst || d < worst.d)) {
      worst = { other, d };
    }
  }
  if (worst) {
    const minDist = (moving.radius + worst.other.radius) * MIN_GAP_FACTOR;
    const dx = x - worst.other.x;
    const dz = z - worst.other.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) {
      x = worst.other.x + minDist;
      z = worst.other.z;
    } else {
      x = worst.other.x + (dx / d) * minDist;
      z = worst.other.z + (dz / d) * minDist;
    }
  } else {
    // 无冲突时安全收回边界
    x = clamp(x, -half, half);
    z = clamp(z, -half, half);
  }

  return { x, z };
}

/** 计算云团显示高度：地表高度 + 悬浮距离，cling 控制贴合程度。 */
export function cloudDisplayY(blob: CloudBlob, terrain: TerrainModel, cling: number): number {
  const ground = terrain.heightAt(blob.x, blob.z);
  const clearance = clearanceFromHeight(blob.height, cling);
  return ground + clearance;
}

/** 重新计算全部云团的悬浮高度（参数变化后调用）。 */
export function refreshCloudDerived(blobs: CloudBlob[], cling: number): void {
  for (const b of blobs) {
    b.clearance = clearanceFromHeight(b.height, cling);
  }
}
