// 骨骼模板与场景状态的数据模型定义

export type Side = 'L' | 'R' | 'M'; // 左 / 右 / 中线

export type Vec3Tuple = [number, number, number];

/** 骨骼库分组（按身体部位） */
export type BoneGroupId =
  | 'skull'      // 头骨
  | 'spine'      // 脊柱
  | 'ribs'       // 胸廓
  | 'girdle'     // 肢带（肩/盆）
  | 'forelimb'   // 前肢
  | 'hindlimb'   // 后肢
  | 'other';     // 杂骨（腹肋等）

export type GeometryKind =
  | 'vertebra'    // 椎骨（椎体 + 神经棘 + 横突）
  | 'longbone'    // 长骨（骨干 + 两端髁）
  | 'skull'       // 头骨
  | 'mandible'    // 下颌
  | 'rib'         // 肋骨（弯曲细管）
  | 'plate'       // 板状骨（肩胛骨/骨盆）
  | 'digit'       // 指/趾骨（短小骨）
  | 'chevron'     // 人字形骨（V 形）
  | 'flat';       // 腹肋等扁平骨

/** 单轴关节活动范围（弧度），null 表示该轴锁定 */
export interface JointLimit {
  x: [number, number] | null;
  y: [number, number] | null;
  z: [number, number] | null;
}

/**
 * 关节插槽。每个插槽位于骨骼局部坐标系中。
 * 子骨骼通过 parentSlotId 挂到父骨骼的某个插槽节点上。
 */
export interface SlotDef {
  id: string;
  pos: Vec3Tuple;
  /** 允许接入的骨骼模板 baseId；空数组表示接受任意骨骼 */
  accepts: string[];
}

/** 骨骼库中的模板定义（中线模板；左右成对的只定义 L，R 运行时镜像生成） */
export interface BoneTemplate {
  baseId: string;
  name: string;
  group: BoneGroupId;
  kind: GeometryKind;
  /** L=左侧（自动生成镜像 R），M=中线不分左右，R 仅用于显式定义，一般不用 */
  side: Side;
  /** 几何尺寸参数（解释随 kind 不同而不同） */
  size: { length: number; width: number; depth: number };
  /** 几何相对根插槽的偏移（局部坐标） */
  geoOffset?: Vec3Tuple;
  /** 根插槽位置（默认原点）——几何与其余插槽都相对它 */
  rootPos?: Vec3Tuple;
  slots: SlotDef[];
  /** 关节活动范围（欧拉角 XYZ，弧度） */
  limits: JointLimit;
  /** 默认初始姿态（弧度），用于自动装配演示骨架 */
  defaultRotation?: Vec3Tuple;
}

/** 场景中已装配的一块骨骼实例 */
export interface BoneInstance {
  id: string;
  templateBaseId: string;
  side: Side;
  parentId: string | null;
  parentSlotId: string | null;
  /** 相对父插槽的局部平移（通常为 0，贴地时足部可能产生偏移） */
  localPos: Vec3Tuple;
  /** 局部欧拉旋转（XYZ 顺序，弧度） */
  rotation: Vec3Tuple;
}

export interface ProjectData {
  version: 1;
  bones: BoneInstance[];
  /** 整具骨架根节点的世界变换 */
  rootTransform: { pos: Vec3Tuple; rot: Vec3Tuple };
  settings: {
    groundSnap: boolean;
    clip: {
      enabled: boolean;
      pos: Vec3Tuple;
      normal: Vec3Tuple;
    };
  };
}

/** 镜像对信息：同 baseId 的 L/R 两个实例 id */
export interface MirrorPair {
  baseId: string;
  L: string | null;
  R: string | null;
}

/** 带解析结果的运行时模板（含镜像生成的 R 模板） */
export interface ResolvedTemplate extends BoneTemplate {
  /** 实际键，形如 "femur:L" / "skull:M" */
  key: string;
}
