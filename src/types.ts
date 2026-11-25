import type { Vector3 } from 'three';

export type AxisName = 'x' | 'y' | 'z';

export interface PlaneState {
  /** 平面沿自身法线方向的偏移(世界坐标) */
  offset: number;
  /** 是否参与剖切(实体裁剪 + 截面计算) */
  enabled: boolean;
  /** 平面手柄/截面是否可见 */
  visible: boolean;
}

export interface PartState {
  id: string;
  name: string;
  visible: boolean;
  color: number;
}

/** 标注记录:锚点存剖切面局部 2D 坐标,剖切面移动后重新求交吸附 */
export interface AnnotationRecord {
  id: string;
  plane: AxisName;
  /** 局部坐标 [u, v] */
  p1: [number, number];
  p2: [number, number];
  createdAt: number;
}

export interface MeasureRecord {
  id: string;
  kind: 'tenon-width' | 'mortise-depth';
  /** 绑定的剖切面,截面移动后据此重算 */
  plane: AxisName;
  /** 截面上的局部 2D 锚点 */
  anchor: [number, number];
  /** 射线方向轴 */
  axis: AxisName;
  value: number;
  detail: string;
  createdAt: number;
}

export interface SavedDoc {
  version: 1;
  savedAt: string;
  planes: Record<AxisName, PlaneState>;
  parts: Record<string, { visible: boolean }>;
  annotations: AnnotationRecord[];
}

export interface SnappedPoint {
  point: Vector3;
  distance: number;
}

export type ToolMode = 'navigate' | 'annotate' | 'measure';
