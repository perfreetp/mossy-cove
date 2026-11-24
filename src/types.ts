// 弹道重建工具核心数据类型定义

export type Vec3 = [number, number, number];

export type PointType = 'entry' | 'exit' | 'constraint';

/** 标注点：射入点 / 射出点 / 中间约束点，均带方向（四元数） */
export interface BallisticPoint {
  id: string;
  type: PointType;
  label: string;
  position: Vec3;
  /** 单位方向向量（弹道在该点的行进方向） */
  direction: Vec3;
}

export type ObstacleKind = 'box' | 'model';

/** 场景障碍物：长方体或导入的空间模型（模型按其世界包围盒参与遮挡检测） */
export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  name: string;
  position: Vec3;
  /** 欧拉角（弧度，XYZ 顺序） */
  rotation: Vec3;
  /** 包围盒半尺寸（半长宽高）；box 即长方体尺寸，model 为加载后实测包围盒 */
  halfExtents: Vec3;
  color: string;
  /** 导入模型的资产 id（对应 project.assets 中的条目），box 为空 */
  assetId?: string;
  visible: boolean;
}

/** 一段连续遮挡区间（沿曲线参数 t ∈ [0,1]） */
export interface OcclusionSegment {
  obstacleId: string;
  obstacleName: string;
  tStart: number;
  tEnd: number;
  /** 入射位置（世界坐标） */
  enterPosition: Vec3;
  /** 穿出位置（世界坐标） */
  exitPosition: Vec3;
}

export interface Trajectory {
  id: string;
  name: string;
  /** 有序点 id 列表，首为射入点、末为射出点，中间为约束点 */
  pointIds: string[];
  /** 弯曲强度档位 1..5 */
  bendLevel: number;
  /** 是否吸附（硬通过）约束点；false 时约束点为软约束 */
  snap: boolean;
  /** 曲线采样点（世界坐标），拟合后生成 */
  samples: Vec3[];
  /** 遮挡判定结果 */
  occlusions: OcclusionSegment[];
  visible: boolean;
  color: string;
}

export interface ModelAsset {
  id: string;
  name: string;
  /** 原始文件名 */
  fileName: string;
  /** data: URL（glb/gltf 内嵌），为空表示资产待补 */
  dataUrl: string;
  /** 实测包围盒半尺寸，导入时计算 */
  halfExtents: Vec3;
}

export interface ProjectData {
  version: number;
  name: string;
  points: BallisticPoint[];
  obstacles: Obstacle[];
  trajectories: Trajectory[];
  activeTrajectoryId: string | null;
  assets: ModelAsset[];
  updatedAt: number;
}

/** 交互工具模式 */
export type ToolMode =
  | 'select'
  | 'add-entry'
  | 'add-exit'
  | 'add-constraint'
  | 'add-box';

export type GizmoMode = 'position' | 'rotation' | 'none';

export interface EngineStatus {
  fps: number;
  obstacleCount: number;
  pointCount: number;
  lastOcclusionMs: number;
  saved: boolean;
}
