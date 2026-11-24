/** 三维向量的可序列化形式 */
export interface Vec3JSON {
  x: number;
  y: number;
  z: number;
}

/** 轴对齐包围盒（世界坐标） */
export interface Box3JSON {
  min: Vec3JSON;
  max: Vec3JSON;
}

/** 证据标记类型 */
export type EvidenceType = 'blood' | 'weapon' | 'fingerprint' | 'trace' | 'body' | 'other';

export interface EvidenceMarker {
  id: string;
  /** 类型编号，从 1 开始、按类型独立编号 */
  seq: number;
  type: EvidenceType;
  /** 世界坐标 */
  position: Vec3JSON;
  note: string;
  /** 创建时间戳（毫秒） */
  createdAt: number;
}

/** 漫游路径关键点 */
export interface PathKeyPoint {
  id: string;
  position: Vec3JSON;
  /** 可选的固定朝向；为空时自动朝向路径前方 */
  lookAt?: Vec3JSON | null;
}

export interface TourPath {
  id: string;
  name: string;
  points: PathKeyPoint[];
  /** 每两点之间的巡航速度（单位/秒），用于计算时长 */
  speed: number;
}

/** 完整工程，导出/导入文件的根结构 */
export interface SceneProject {
  format: 'crime-scene-pcv';
  version: 1;
  exportedAt: number;
  /** 点云在本地数据仓中的键（导入时按此键恢复），可能为空（纯工程无点云） */
  cloudKey?: string | null;
  cloudName?: string;
  /** 裁剪包围盒；为空表示未裁剪 */
  clipBox: Box3JSON | null;
  markers: EvidenceMarker[];
  paths: TourPath[];
}

/** 平面图视口状态 */
export interface MapViewState {
  /** 世界坐标 -> 画布的缩放（像素/世界单位）与平移 */
  scale: number;
  offsetX: number;
  offsetY: number;
}
