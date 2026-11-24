/** 领域模型类型定义（长度单位：mm） */

export type NodeKind = 'cup' | 'sprue-base' | 'junction' | 'ingate' | 'free';

export type ChannelType = 'downsprue' | 'runner' | 'ingate' | 'connector';

export type ModuleId = 'draw' | 'node' | 'riser' | 'export';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 浇道网络节点 */
export interface GatingNode {
  id: string;
  kind: NodeKind;
  position: Vec3;
}

/** 浇道管体（有向：from -> to 表示金属液流动方向） */
export interface Channel {
  id: string;
  from: string;
  to: string;
  type: ChannelType;
  /** 主次级：1=直浇道(主) 2=横浇道(次) 3=内浇口(末) */
  level: 1 | 2 | 3;
  /** 管径 mm */
  diameter: number;
}

/** 热节 */
export interface HotSpot {
  id: string;
  position: Vec3;
  /** 热节半径 mm */
  radius: number;
  label: string;
}

/** 冒口 */
export interface Riser {
  id: string;
  /** 冒口颈在铸件顶面的位置 */
  position: Vec3;
  diameter: number;
  height: number;
  /** 自动测量出的最近热节 */
  linkedHotSpotId: string | null;
  /** 与最近热节的连接距离 mm */
  distance: number | null;
}

export type CastingShape = 'box' | 'stepped' | 'cylinder';

export interface CastingConfig {
  shape: CastingShape;
  length: number;
  width: number;
  height: number;
  wallThickness: number;
}

export interface NodeFlowResult {
  nodeId: string;
  /** 流入量占浇口杯总入流的比例 0..1 */
  inflow: number;
  /** 每条下游通道的分出量占总入流比例 */
  outflowByChannel: Record<string, number>;
  /** 下游通道之间的相对分配比例（和为 1） */
  splitRatios: Record<string, number>;
  /** 偏离均衡的程度 0..1 */
  imbalance: number;
  /** 是否在均衡阈值内 */
  balanced: boolean;
  /** 下游总截面积 mm² */
  downstreamArea: number;
}

export interface ChannelFlowResult {
  channelId: string;
  /** 占总入流比例 */
  share: number;
  area: number;
  /** 相对流速（份额/截面积） */
  velocity: number;
}

export interface FlowResult {
  nodes: Record<string, NodeFlowResult>;
  channels: Record<string, ChannelFlowResult>;
  rootIds: string[];
  /** 未接入网络（流入为 0）的节点 */
  detachedNodeIds: string[];
}

/** 可撤销/重做的设计状态 */
export interface DesignState {
  nodes: GatingNode[];
  channels: Channel[];
  risers: Riser[];
}

export const RISER_LIMIT = 8;
