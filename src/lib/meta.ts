import type { ChannelType, NodeKind } from './types';

export interface NodeMeta {
  label: string;
  hint: string;
  color: number;
  defaultDiameterLevel: 1 | 2 | 3;
}

export const NODE_META: Record<NodeKind, NodeMeta> = {
  cup: { label: '浇口杯', hint: '浇注系统入口，网络根节点', color: 0xff8f00, defaultDiameterLevel: 1 },
  'sprue-base': { label: '直浇道底窝', hint: '直浇道末端、横浇道起点', color: 0xffb300, defaultDiameterLevel: 2 },
  junction: { label: '横浇道节点', hint: '横浇道分叉/转接处', color: 0xffd54f, defaultDiameterLevel: 2 },
  ingate: { label: '内浇口', hint: '金属液进入铸件的末端', color: 0x4dd0e1, defaultDiameterLevel: 3 },
  free: { label: '自由节点', hint: '未指定角色的辅助节点', color: 0xb0bec5, defaultDiameterLevel: 2 }
};

export const CHANNEL_META: Record<ChannelType, { label: string; color: number }> = {
  downsprue: { label: '直浇道', color: 0xff8f00 },
  runner: { label: '横浇道', color: 0xffc107 },
  ingate: { label: '内浇口', color: 0x26c6da },
  connector: { label: '连接管', color: 0x90a4ae }
};

export const LEVEL_META: Record<1 | 2 | 3, { label: string; defaultDiameter: number; color: number }> = {
  1: { label: '一级 · 直浇道（主）', defaultDiameter: 28, color: 0xff8f00 },
  2: { label: '二级 · 横浇道（次）', defaultDiameter: 20, color: 0xffc107 },
  3: { label: '三级 · 内浇口（末）', defaultDiameter: 12, color: 0x26c6da }
};

export const DIAMETER_MIN = 4;
export const DIAMETER_MAX = 80;

/** 根据起止节点推断通道类型与层级 */
export function inferChannel(
  fromKind: NodeKind,
  toKind: NodeKind
): { type: ChannelType; level: 1 | 2 | 3 } {
  if (fromKind === 'cup') {
    return { type: 'downsprue', level: 1 };
  }
  if (toKind === 'ingate' || fromKind === 'ingate') {
    return { type: 'ingate', level: 3 };
  }
  if (fromKind === 'sprue-base' || fromKind === 'junction' || toKind === 'junction') {
    return { type: 'runner', level: 2 };
  }
  return { type: 'connector', level: 2 };
}
