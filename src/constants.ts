import type { MaterialDef, Material, WidthLevel } from './types'

/** 沙盘平面尺寸(米),世界坐标 x,y ∈ [0, SIZE] */
export const SANDBOX_SIZE = 1000

/** 沙盘中心对应的经纬度(北京附近),MapLibre 世界坐标以此为锚 */
export const ORIGIN_LNG = 116.391
export const ORIGIN_LAT = 39.907

/** 1 米对应的经纬度近似换算(沙盘仅 1km,误差可忽略) */
export const M_PER_DEG_LAT = 111320

/** 主次干道宽度(米) */
export const ROAD_WIDTHS: Record<WidthLevel, number> = {
  primary: 14,
  secondary: 7
}

export const WIDTH_LABELS: Record<WidthLevel, string> = {
  primary: '主干道(宽)',
  secondary: '次干道(窄)'
}

export const MATERIALS: Record<Material, MaterialDef> = {
  asphalt: { id: 'asphalt', label: '沥青', color: [0.16, 0.16, 0.18], grain: 0.12 },
  concrete: { id: 'concrete', label: '水泥混凝土', color: [0.62, 0.6, 0.55], grain: 0.06 },
  cobble: { id: 'cobble', label: '块石铺砌', color: [0.48, 0.44, 0.38], grain: 0.35 },
  gravel: { id: 'gravel', label: '碎石', color: [0.55, 0.5, 0.42], grain: 0.5 },
  snow: { id: 'snow', label: '积雪路面', color: [0.88, 0.9, 0.93], grain: 0.08 }
}

export const MATERIAL_LIST = Object.values(MATERIALS)

/** 节点圆盘半径(米) */
export const NODE_RADIUS = 9

/** 道路抬离地面的垂直偏移(米),避免与地形 Z-fighting */
export const ROAD_LIFT = 1.6

export const STORAGE_KEY = 'traffic-sandbox-network-v1'

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}
