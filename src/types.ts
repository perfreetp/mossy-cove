// 路网数据模型
export type XY = { x: number; y: number }

export type WidthLevel = 'primary' | 'secondary'

export type Material = 'asphalt' | 'concrete' | 'cobble' | 'gravel' | 'snow'

export interface Intersection {
  id: string
  x: number
  y: number
  /** 连接角度约束(度,0 = 朝东,逆时针)。null 表示无约束 */
  angleConstraint: number | null
  /** 约束容差(度),落入容差内不吸附 */
  angleTolerance: number
}

export interface Road {
  id: string
  widthLevel: WidthLevel
  material: Material
}

export interface Edge {
  id: string
  a: string
  b: string
  roadId: string
}

export interface NetworkData {
  version: 1
  intersections: Intersection[]
  roads: Road[]
  edges: Edge[]
}

export type Tool = 'select' | 'place' | 'connect' | 'split' | 'delete'

export interface MaterialDef {
  id: Material
  label: string
  color: [number, number, number]
  /** 0..1,路面纹理颗粒强度(片元噪声) */
  grain: number
}

export interface RoadNetState {
  intersections: Record<string, Intersection>
  roads: Record<string, Road>
  edges: Record<string, Edge>
}
