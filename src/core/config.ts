import type { DensityTier } from './types';

/** 地形世界尺寸与高度网格 */
export const WORLD = {
  w: 2600,
  h: 1700,
  cell: 10,
  cols: 260,
  rows: 170,
  /** 沙盘木框宽度（视口坐标中地形相对原点的偏移） */
  frame: 52,
} as const;

export const VIEW_W = WORLD.w + WORLD.frame * 2;
export const VIEW_H = WORLD.h + WORLD.frame * 2;

/** 归一化高度对应的海拔米数（仅用于面板读数） */
export const ELEVATION_MAX_M = 142;

/** 地形种植规则：水下不种；高海拔 / 陡坡自动稀疏直至完全不放置 */
export const TERRAIN_RULES = {
  waterLevel: 0.27,
  /** 高于该高度开始按概率稀疏 */
  softHeight: 0.62,
  /** 高于该高度完全不放 */
  maxHeight: 0.84,
  /** 坡度超过该角度开始稀疏 */
  softSlope: 20,
  /** 坡度超过该角度完全不放 */
  maxSlope: 43,
  /** 归一化高度到“实际高差”的放大，用于坡度估算 */
  relief: 300,
} as const;

export interface DensityConfig {
  label: string;
  /** 采样格尺寸相对最小间距的倍数（越小越密） */
  cellFactor: number;
  /** 目标数量系数 */
  targetFactor: number;
  hint: string;
}

export const DENSITY_CONFIG: Record<DensityTier, DensityConfig> = {
  sparse: { label: '稀疏', cellFactor: 1.55, targetFactor: 0.5, hint: '疏林草地' },
  normal: { label: '标准', cellFactor: 1.08, targetFactor: 1.15, hint: '自然混生' },
  dense: { label: '密集', cellFactor: 0.78, targetFactor: 1.65, hint: '茂密灌丛' },
};

export const DENSITY_ORDER: DensityTier[] = ['sparse', 'normal', 'dense'];

export const SPACING = {
  min: 10,
  max: 48,
  step: 1,
  default: 18,
} as const;

/** 擦除笔刷三档半径（世界 px） */
export const BRUSH_RADII = [34, 72, 122] as const;
export const BRUSH_LABELS = ['小', '中', '大'] as const;

export const HISTORY_LIMIT = 80;

/** 工具的中文提示 */
export const TOOL_HINTS: Record<string, string> = {
  pan: '拖拽平移 · 滚轮缩放 · 右键也可平移',
  zone: '在地形上按住拖拽，框选新的散布区域',
  erase: '按住并拖动，擦除笔刷范围内的植被 · [ / ] 切换笔刷档位',
};
