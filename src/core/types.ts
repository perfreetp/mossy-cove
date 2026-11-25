/** 植被层类型：树木 / 灌木 */
export type LayerKind = 'trees' | 'bushes';

/** 密度档位 */
export type DensityTier = 'sparse' | 'normal' | 'dense';

/** 顶部工具：平移 / 划定区域 / 擦除 */
export type ToolId = 'pan' | 'zone' | 'erase';

/** 散布参数 */
export interface ScatterParams {
  density: DensityTier;
  /** 最小间距（世界坐标 px） */
  minSpacing: number;
  /** 树木占两种植被的比例 0~1 */
  treeRatio: number;
}

/** 散布区域（矩形，地形局部坐标） */
export interface ScatterZone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一个植被实例（纯数据，可序列化） */
export interface VegetationInstance {
  id: number;
  layer: LayerKind;
  zoneId: string;
  x: number;
  y: number;
  /** 放置点的归一化高度 0~1 */
  h: number;
  /** 放置点坡度（度） */
  slope: number;
  /** 渲染尺寸（世界 px，整体高度） */
  size: number;
  rot: number;
  variant: number;
}

/** 擦除笔刷落点 */
export interface EraseDab {
  x: number;
  y: number;
  r: number;
}

/** 一次完整擦除笔画（用于重散布后仍保持擦除结果） */
export interface EraseStroke {
  id: string;
  dabs: EraseDab[];
}

export interface LayerState {
  visible: boolean;
  /** 随机种子；重新散布该层时更换 */
  seed: number;
}

/** 可序列化 / 可撤销的完整工程状态 */
export interface ProjectState {
  app: 'qingyu-veg-scatter';
  format: 1;
  terrainSeed: number;
  params: ScatterParams;
  /** 高度带下限（归一化高度） */
  bandLow: number;
  /** 高度带上限 */
  bandHigh: number;
  zones: ScatterZone[];
  layers: Record<LayerKind, LayerState>;
  strokes: EraseStroke[];
  instances: VegetationInstance[];
  nextInstanceId: number;
  nextZoneNumber: number;
}

export const LAYER_LABEL: Record<LayerKind, string> = {
  trees: '树木层',
  bushes: '灌木层',
};
