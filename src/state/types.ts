export type Vec3 = [number, number, number];

export type IceKind = 'wall' | 'column' | 'brick';

export interface IceBlock {
  id: string;
  kind: IceKind;
  name: string;
  /** 中心点坐标(米) */
  position: Vec3;
  /** 宽 / 高 / 厚(米) */
  size: Vec3;
  /** 绕 Y 轴旋转(弧度) */
  rotationY: number;
  /** 浑浊度 0..1,影响衰减系数 */
  turbidity: number;
}

export interface Light {
  id: string;
  name: string;
  position: Vec3;
  /** 方位角(度),0 = +Z 方向,绕 Y 轴 */
  azimuth: number;
  /** 俯仰角(度),负值向下 */
  elevation: number;
  /** 色温 K */
  kelvin: number;
  /** 强度 */
  intensity: number;
  /** 光斑扩散 0..1 */
  spread: number;
  /** 边缘柔化档位 0..4 */
  softness: number;
  groupId: string | null;
}

export interface LightGroup {
  id: string;
  name: string;
}

export interface Doc {
  iceBlocks: IceBlock[];
  lights: Light[];
  groups: LightGroup[];
}

export interface Scheme {
  id: string;
  name: string;
  doc: Doc;
}

export type Selection =
  | { kind: 'ice'; id: string }
  | { kind: 'light'; id: string }
  | { kind: 'group'; id: string }
  | null;

export const ICE_KIND_LABEL: Record<IceKind, string> = {
  wall: '冰墙',
  column: '冰柱',
  brick: '冰砖',
};
