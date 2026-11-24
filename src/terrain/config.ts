export const WORLD_SIZE = 24;
export const DEFAULT_RESOLUTION = 256;
export const RESOLUTIONS = [64, 128, 256, 384, 512] as const;
export const BASE_Y = -5.2;
export const MIN_HEIGHT = -4.8;
export const MAX_HEIGHT = 9;
export const MAX_BUILDINGS = 5000;
export const STORAGE_KEY = 'micro-sandbox-terrain-v1';

export const STRATA_COLORS = ['#44342f', '#714936', '#a86f43', '#d29d5d', '#e7d19a'];
export const STRATA_NAMES = ['基底岩层', '深褐岩层', '含铁砂岩', '浅色沉积岩', '顶部风化层'];
export const DEFAULT_STRATA_BOUNDARIES = [-4.05, -2.9, -1.75, -0.65];

export const BUILDING_COLORS = [
  '#d9e2ec', '#bcccdc', '#f0b429', '#d64545', '#2f9e8f',
  '#4c78a8', '#e07a5f', '#f2cc8f', '#81b29a', '#e9c46a'
];

export const DEFAULT_SECTIONS = {
  xEnabled: true,
  yEnabled: false,
  zEnabled: true,
  x: 2.2,
  y: -2.25,
  z: 2.2
};

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function uid(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
