// 全局共享类型定义

export type AxisName = 'x' | 'y' | 'z';

/** 剖切平面状态(可序列化,用于视图方案) */
export interface PlaneState {
  /** 平面上一点 */
  point: [number, number, number];
  /** 单位法向量 */
  normal: [number, number, number];
  /** 是否启用剖切(关闭=不裁剪、不显示截面) */
  enabled: boolean;
  /** 是否单独隐藏该平面的截面与裁剪(隐藏剖切) */
  hidden: boolean;
  /** 截面填充颜色 */
  fillColor: string;
  /** 轮廓线颜色 */
  lineColor: string;
}

export type PlanesState = Record<AxisName, PlaneState>;

/** 切片序列参数(可序列化) */
export interface SliceParams {
  /** 序列方向(使用哪个剖切平面的法向) */
  axis: AxisName;
  /** 切片数量 */
  count: number;
  /** 起始位置(沿法向的有符号偏移,相对包围盒中心) */
  startOffset: number;
  /** 结束位置 */
  endOffset: number;
}

/** 一个闭合轮廓(2D 截面坐标,已带 3D 映射信息) */
export interface ContourData {
  /** 截面 2D 坐标点(由 manifold 输出的有序闭合环) */
  points2d: Array<[number, number]>;
  /** 对应 3D 点(世界坐标) */
  points3d: Array<[number, number, number]>;
  /** 有符号面积(正=外环 CCW,负=孔) */
  signedArea: number;
  /** 几何面积(绝对值) */
  area: number;
  /** 是否为孔 */
  isHole: boolean;
}

/** 一次截面计算结果 */
export interface SectionResult {
  id: number;
  plane: AxisName;
  /** 计算所用平面点与法向 */
  point: [number, number, number];
  normal: [number, number, number];
  /** 截面局部坐标基(e1、e2 为平面内正交单位向量) */
  basis: {
    center: [number, number, number];
    e1: [number, number, number];
    e2: [number, number, number];
  };
  contours: ContourData[];
  /** 填充三角索引(引用所有轮廓的合并点集,按轮廓顺序拼接) */
  fillIndices: Uint32Array;
  /** 填充顶点(3D,按轮廓顺序拼接) */
  fillVertices: Float32Array;
  /** 总面积(外轮廓减孔) */
  totalArea: number;
  /** 耗时 ms */
  elapsedMs: number;
}

/** 视图方案:完整可恢复的剖切状态 */
export interface ViewScheme {
  id: string;
  name: string;
  createdAt: number;
  planes: PlanesState;
  slice: SliceParams;
  angleLock: boolean;
  snapDegrees: number;
}

export interface ModelInfo {
  vertexCount: number;
  triangleCount: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    size: [number, number, number];
  };
  /** manifold 构造状态 */
  manifoldStatus: string;
}

/** worker 请求:模型导入(主线程解析后传入网格数据) */
export interface ImportMeshRequest {
  type: 'import-mesh';
  id: number;
  vertices: Float32Array;
  indices: Uint32Array;
  fileName: string;
}

/** worker 请求:截面计算 */
export interface SectionRequest {
  type: 'section';
  id: number;
  plane: AxisName;
  point: [number, number, number];
  normal: [number, number, number];
}

/** worker 请求:批量切片 */
export interface BatchRequest {
  type: 'batch';
  id: number;
  axis: AxisName;
  point: [number, number, number];
  normal: [number, number, number];
  /** 各切片沿法向的偏移 */
  offsets: number[];
}

export type WorkerRequest = ImportMeshRequest | SectionRequest | BatchRequest;

export interface ImportResponse {
  type: 'imported';
  id: number;
  ok: boolean;
  error?: string;
  vertices: Float32Array;
  indices: Uint32Array;
  info: ModelInfo;
}

export interface SectionResponse {
  type: 'section';
  id: number;
  ok: boolean;
  error?: string;
  result: SectionResult | null;
}

export interface BatchResponse {
  type: 'batch';
  id: number;
  ok: boolean;
  error?: string;
  results: SectionResult[];
  elapsedMs: number;
}

export type WorkerResponse = ImportResponse | SectionResponse | BatchResponse;

/** 测量记录 */
export interface Measurement {
  id: number;
  kind: 'distance' | 'area';
  plane: AxisName;
  /** 距离测量的两个 3D 点 */
  points?: [number, number, number][];
  distance?: number;
  area?: number;
  contourIndex?: number;
  label: string;
}
