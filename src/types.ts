import * as THREE from 'three';

/**
 * 共享类型定义
 */

/** 一条闭合边界环（顶点索引有序、首尾闭合） */
export interface BoundaryLoop {
  /** 环上顶点索引（在当前 geometry 中），按顺序排列，不重复首尾 */
  indices: number[];
  /** 环所在平面（世界/模型局部一致坐标） */
  plane: THREE.Plane;
  /** 有向面积（平面法向方向，带符号，按面积公式计算） */
  signedArea: number;
  /** 周长 */
  perimeter: number;
  /** 平面面积（绝对值） */
  area: number;
}

/** 一次补洞生成的断面信息 */
export interface CapRecord {
  /** 组成该断面的外环与内环（洞）的顶点环 */
  loops: BoundaryLoop[];
  /** 断面平面 */
  plane: THREE.Plane;
  /** 该断面三角形在 geometry.index 中的索引区间（连续写入，便于整体编辑） */
  triangleStart: number;
  triangleCount: number;
  /** 断面表面（含孔洞）净面积 */
  area: number;
  /** 外边界周长 */
  perimeter: number;
}

/** 操作栈中的一次完整快照（裁剪/补洞/微调均生成快照） */
export interface Snapshot {
  label: string;
  geometry: THREE.BufferGeometry;
  loops: BoundaryLoop[];
  caps: CapRecord[];
  triangleCount: number;
  vertexCount: number;
}

/** 平面裁剪的输出（尚未入栈的中间结果） */
export interface ClipOutput {
  geometry: THREE.BufferGeometry;
  loops: BoundaryLoop[];
  /** 本次裁剪新产生的开口环（loops 是全量，freshLoopIds 标记新增的） */
  freshLoopKeys: Set<string>;
  caps: CapRecord[];
}

export type InteractionMode =
  | 'orbit' // 仅相机观察
  | 'knife-translate' // 拖动平面刀平移
  | 'knife-rotate' // 自由旋转平面刀
  | 'manual-fill' // 沿边界环手动点选补洞（吸附）
  | 'cap-vertex'; // 顶点级微调（仅断面内部顶点）

export type AxisPreset = 'X' | 'Y' | 'Z' | 'FREE';
