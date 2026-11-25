import { SPACING } from './config';
import { EraseMask } from './erase-mask';
import { hashSeed, mulberry32, uid } from './rng';
import {
  scatterZoneLayer,
  SpatialHash,
} from './scatter';
import { Heightfield, suggestZones } from './terrain';
import type {
  EraseDab,
  LayerKind,
  ProjectState,
  ScatterZone,
  VegetationInstance,
} from './types';

/** 全量重新散布（参数变化 / 撤销重做后由状态驱动，或“全部重撒”） */
export function resampleAll(state: ProjectState, hf: Heightfield): void {
  const mask = EraseMask.fromStrokes(state.strokes);
  state.instances = [];
  state.nextInstanceId = 1;
  const allocId = () => state.nextInstanceId++;

  const hashCell = state.params.minSpacing;
  const treeHash = new SpatialHash<VegetationInstance>(hashCell);
  const bushHash = new SpatialHash<VegetationInstance>(hashCell * 0.7);

  state.zones.forEach((zone, zi) => {
    const treeRng = mulberry32(
      hashSeed(state.terrainSeed, state.layers.trees.seed, zi + 1, 0x7ee5),
    );
    const trees = scatterZoneLayer({
      zone,
      layer: 'trees',
      seedRng: treeRng,
      params: state.params,
      hf,
      mask,
      allocId,
      ownHash: treeHash,
    });
    state.instances.push(...trees);

    const bushRng = mulberry32(
      hashSeed(state.terrainSeed, state.layers.bushes.seed, zi + 1, 0xb057),
    );
    const bushes = scatterZoneLayer({
      zone,
      layer: 'bushes',
      seedRng: bushRng,
      params: state.params,
      hf,
      mask,
      allocId,
      ownHash: bushHash,
      crossHash: treeHash,
    });
    state.instances.push(...bushes);
  });
}

/** 只重新生成某一层（保留另一层作为异层间距约束） */
export function resampleLayer(
  state: ProjectState,
  hf: Heightfield,
  layer: LayerKind,
): void {
  const mask = EraseMask.fromStrokes(state.strokes);
  const other: LayerKind = layer === 'trees' ? 'bushes' : 'trees';

  // 保留另一层，删除本层
  const kept = state.instances.filter((i) => i.layer !== layer);
  state.instances = kept;

  const ownHash = new SpatialHash<VegetationInstance>(state.params.minSpacing);
  const crossHash = new SpatialHash<VegetationInstance>(state.params.minSpacing);
  for (const inst of kept) {
    if (inst.layer === layer) ownHash.insert(inst);
    else crossHash.insert(inst);
  }

  const fresh: VegetationInstance[] = [];
  state.zones.forEach((zone, zi) => {
    const rng = mulberry32(
      hashSeed(
        state.terrainSeed,
        state.layers[layer].seed,
        zi + 1,
        layer === 'trees' ? 0x7ee5 : 0xb057,
      ),
    );
    const part = scatterZoneLayer({
      zone,
      layer,
      seedRng: rng,
      params: state.params,
      hf,
      mask,
      allocId: () => state.nextInstanceId++,
      ownHash,
      crossHash,
    });
    fresh.push(...part);
  });

  state.instances = [...kept, ...fresh];
  void other;
}

/** 新画定区域后，只对该区域撒一次，已有实例原样保留并参与间距约束 */
export function scatterNewZone(
  state: ProjectState,
  hf: Heightfield,
  zone: ScatterZone,
  zoneIndex: number,
): void {
  const mask = EraseMask.fromStrokes(state.strokes);
  const treeHash = new SpatialHash<VegetationInstance>(state.params.minSpacing);
  const bushHash = new SpatialHash<VegetationInstance>(
    state.params.minSpacing * 0.7,
  );
  for (const inst of state.instances) {
    if (inst.layer === 'trees') treeHash.insert(inst);
    else bushHash.insert(inst);
  }

  const allocId = () => state.nextInstanceId++;
  const treeRng = mulberry32(
    hashSeed(state.terrainSeed, state.layers.trees.seed, zoneIndex + 1, 0x7ee5),
  );
  const trees = scatterZoneLayer({
    zone,
    layer: 'trees',
    seedRng: treeRng,
    params: state.params,
    hf,
    mask,
    allocId,
    ownHash: treeHash,
  });
  state.instances.push(...trees);

  const bushRng = mulberry32(
    hashSeed(state.terrainSeed, state.layers.bushes.seed, zoneIndex + 1, 0xb057),
  );
  const bushes = scatterZoneLayer({
    zone,
    layer: 'bushes',
    seedRng: bushRng,
    params: state.params,
    hf,
    mask,
    allocId,
    ownHash: bushHash,
    crossHash: treeHash,
  });
  state.instances.push(...bushes);
}

/** 用若干笔刷落点清除实例，返回被清除数量 */
export function eraseAtDabs(state: ProjectState, dabs: EraseDab[]): number {
  if (dabs.length === 0 || state.instances.length === 0) return 0;
  const dead = new Set<number>();
  for (const inst of state.instances) {
    for (const d of dabs) {
      const dx = inst.x - d.x;
      const dy = inst.y - d.y;
      const r = d.r;
      if (dx * dx + dy * dy <= r * r) {
        dead.add(inst.id);
        break;
      }
    }
  }
  if (dead.size > 0) {
    state.instances = state.instances.filter((i) => !dead.has(i.id));
  }
  return dead.size;
}

/** 线性同余推进随机种子 */
export function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

/** 构建首次打开时的示例工程：自动挑选两块宜居区域并完成散布 */
export function createInitialState(hf: Heightfield): ProjectState {
  const state: ProjectState = {
    app: 'qingyu-veg-scatter',
    format: 1,
    terrainSeed: 20240517,
    params: {
      density: 'normal',
      minSpacing: SPACING.default,
      treeRatio: 0.55,
    },
    bandLow: 0,
    bandHigh: 1,
    zones: [],
    layers: {
      trees: { visible: true, seed: 0x1357_9bdf },
      bushes: { visible: true, seed: 0x2468_ace0 },
    },
    strokes: [],
    instances: [],
    nextInstanceId: 1,
    nextZoneNumber: 1,
  };

  const rects = suggestZones(hf, 3);
  for (const r of rects) {
    state.zones.push({
      id: uid('zone'),
      name: `散布区域 ${state.nextZoneNumber++}`,
      ...r,
    });
  }
  resampleAll(state, hf);
  return state;
}

/** 统计各层数量与高度带内可见数量 */
export function countInstances(state: ProjectState): {
  trees: number;
  bushes: number;
  visible: number;
} {
  let trees = 0;
  let bushes = 0;
  let visible = 0;
  for (const i of state.instances) {
    if (i.layer === 'trees') trees++;
    else bushes++;
    if (i.h >= state.bandLow && i.h <= state.bandHigh) visible++;
  }
  return { trees, bushes, visible };
}
