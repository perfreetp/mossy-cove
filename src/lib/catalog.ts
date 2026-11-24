// 骨骼模板库：一套两足兽脚类恐龙（霸王龙式）骨架
// 中线模板用 M；左右成对的只定义 L，R 由 mirrorTemplate() 生成。
import type { BoneTemplate, JointLimit, ResolvedTemplate, Side, Vec3Tuple } from '../types';
import { DEG, mirrorPoint } from './math3d';

const free: JointLimit = {
  x: [-Math.PI, Math.PI],
  y: [-Math.PI, Math.PI],
  z: [-Math.PI, Math.PI],
};

const neckLimit: JointLimit = {
  x: [DEG(-60), DEG(60)],
  y: [DEG(-90), DEG(90)],
  z: [DEG(-45), DEG(45)],
};

const limbLimit: JointLimit = {
  x: [DEG(-130), DEG(45)],   // 屈伸
  y: [DEG(-30), DEG(30)],    // 内外收展
  z: [DEG(-25), DEG(25)],    // 轴向扭转
};

const digitLimit: JointLimit = {
  x: [DEG(-90), DEG(10)],
  y: null,
  z: null,
};

// ---------- 模板定义 ----------

export const TEMPLATES: BoneTemplate[] = [
  // ===== 头骨 =====
  {
    baseId: 'skull',
    name: '头骨',
    group: 'skull',
    kind: 'skull',
    side: 'M',
    size: { length: 1.35, width: 0.55, depth: 0.5 },
    geoOffset: [0, 0.18, 0.45],
    rootPos: [0, 0, 0],
    slots: [
      { id: 'jaw', pos: [0, -0.12, -0.15], accepts: ['mandible'] },
      { id: 'neck', pos: [0, 0, -0.5], accepts: ['cervical'] },
    ],
    limits: free,
  },
  {
    baseId: 'mandible',
    name: '下颌骨',
    group: 'skull',
    kind: 'mandible',
    side: 'M',
    size: { length: 1.15, width: 0.4, depth: 0.16 },
    geoOffset: [0, -0.08, 0.4],
    slots: [],
    limits: { x: [DEG(-55), DEG(5)], y: null, z: null },
  },

  // ===== 脊柱 =====
  {
    baseId: 'cervical',
    name: '颈椎',
    group: 'spine',
    kind: 'vertebra',
    side: 'M',
    size: { length: 0.22, width: 0.26, depth: 0.3 },
    geoOffset: [0, 0.12, 0.12],
    slots: [
      { id: 'next', pos: [0, 0.18, 0.3], accepts: ['cervical', 'dorsal', 'skull'] },
      { id: 'ribL', pos: [0.16, 0.05, 0], accepts: ['cervicalRib'] },
      { id: 'ribR', pos: [-0.16, 0.05, 0], accepts: ['cervicalRib'] },
    ],
    limits: neckLimit,
  },
  {
    baseId: 'dorsal',
    name: '背椎',
    group: 'spine',
    kind: 'vertebra',
    side: 'M',
    size: { length: 0.3, width: 0.34, depth: 0.42 },
    geoOffset: [0, 0.18, 0.13],
    slots: [
      { id: 'next', pos: [0, 0.26, 0.32], accepts: ['dorsal', 'sacral'] },
      { id: 'ribL', pos: [0.24, 0.05, 0], accepts: ['rib'] },
      { id: 'ribR', pos: [-0.24, 0.05, 0], accepts: ['rib'] },
      { id: 'scapulaL', pos: [0.34, 0.1, -0.05], accepts: ['scapula'] },
      { id: 'scapulaR', pos: [-0.34, 0.1, -0.05], accepts: ['scapula'] },
    ],
    limits: {
      x: [DEG(-20), DEG(25)],
      y: [DEG(-25), DEG(25)],
      z: [DEG(-20), DEG(20)],
    },
  },
  {
    baseId: 'sacral',
    name: '荐椎',
    group: 'spine',
    kind: 'vertebra',
    side: 'M',
    size: { length: 0.34, width: 0.4, depth: 0.4 },
    geoOffset: [0, 0.16, 0.12],
    slots: [
      { id: 'next', pos: [0, 0.22, 0.3], accepts: ['caudal'] },
      { id: 'iliumL', pos: [0.3, 0.05, 0], accepts: ['ilium'] },
      { id: 'iliumR', pos: [-0.3, 0.05, 0], accepts: ['ilium'] },
    ],
    limits: { x: [DEG(-8), DEG(8)], y: [DEG(-8), DEG(8)], z: [DEG(-6), DEG(6)] },
  },
  {
    baseId: 'caudal',
    name: '尾椎',
    group: 'spine',
    kind: 'vertebra',
    side: 'M',
    size: { length: 0.24, width: 0.22, depth: 0.34 },
    geoOffset: [0, 0.14, 0.16],
    slots: [
      { id: 'next', pos: [0, 0.2, 0.36], accepts: ['caudal'] },
      { id: 'chev', pos: [0, -0.14, 0.1], accepts: ['chevron'] },
    ],
    limits: {
      x: [DEG(-35), DEG(30)],
      y: [DEG(-40), DEG(40)],
      z: [DEG(-35), DEG(35)],
    },
  },

  // ===== 胸廓 =====
  {
    baseId: 'rib',
    name: '肋骨',
    group: 'ribs',
    kind: 'rib',
    side: 'L',
    size: { length: 1.15, width: 0.06, depth: 0.06 },
    geoOffset: [0.35, -0.4, 0],
    slots: [{ id: 'tip', pos: [0.7, -0.85, 0], accepts: ['gastralium'] }],
    limits: { x: [DEG(-20), DEG(20)], y: [DEG(-35), DEG(15)], z: [DEG(-25), DEG(25)] },
  },
  {
    baseId: 'cervicalRib',
    name: '颈肋',
    group: 'ribs',
    kind: 'rib',
    side: 'L',
    size: { length: 0.45, width: 0.04, depth: 0.04 },
    geoOffset: [0.2, -0.12, 0.05],
    slots: [],
    limits: { x: [DEG(-25), DEG(25)], y: [DEG(-30), DEG(30)], z: [DEG(-25), DEG(25)] },
  },
  {
    baseId: 'gastralium',
    name: '腹肋',
    group: 'other',
    kind: 'flat',
    side: 'L',
    size: { length: 0.5, width: 0.05, depth: 0.04 },
    geoOffset: [0.25, 0, 0],
    slots: [],
    limits: free,
  },
  {
    baseId: 'chevron',
    name: '人字形骨',
    group: 'ribs',
    kind: 'chevron',
    side: 'M',
    size: { length: 0.28, width: 0.12, depth: 0.12 },
    geoOffset: [0, -0.2, 0],
    slots: [],
    limits: { x: [DEG(-20), DEG(20)], y: null, z: [DEG(-15), DEG(15)] },
  },

  // ===== 肢带 =====
  {
    baseId: 'scapula',
    name: '肩胛骨',
    group: 'girdle',
    kind: 'plate',
    side: 'L',
    size: { length: 0.85, width: 0.22, depth: 0.1 },
    geoOffset: [0.1, 0.35, 0],
    slots: [{ id: 'shoulder', pos: [0, -0.15, 0], accepts: ['humerus'] }],
    limits: { x: [DEG(-25), DEG(25)], y: [DEG(-30), DEG(30)], z: [DEG(-35), DEG(35)] },
  },
  {
    baseId: 'ilium',
    name: '髂骨',
    group: 'girdle',
    kind: 'plate',
    side: 'L',
    size: { length: 0.95, width: 0.3, depth: 0.14 },
    geoOffset: [0.2, 0.1, 0],
    slots: [
      { id: 'hip', pos: [0.05, -0.18, 0], accepts: ['femur'] },
      { id: 'pubis', pos: [0, -0.2, 0.25], accepts: ['pubis'] },
    ],
    limits: { x: [DEG(-10), DEG(10)], y: null, z: [DEG(-10), DEG(10)] },
  },
  {
    baseId: 'pubis',
    name: '耻骨',
    group: 'girdle',
    kind: 'longbone',
    side: 'L',
    size: { length: 0.8, width: 0.12, depth: 0.12 },
    geoOffset: [0, -0.4, 0.15],
    slots: [],
    limits: { x: [DEG(-15), DEG(15)], y: null, z: [DEG(-15), DEG(15)] },
  },

  // ===== 前肢（短小） =====
  {
    baseId: 'humerus',
    name: '肱骨',
    group: 'forelimb',
    kind: 'longbone',
    side: 'L',
    size: { length: 0.55, width: 0.13, depth: 0.13 },
    geoOffset: [0, -0.28, 0],
    slots: [{ id: 'elbow', pos: [0, -0.55, 0], accepts: ['radius'] }],
    limits: limbLimit,
  },
  {
    baseId: 'radius',
    name: '桡骨',
    group: 'forelimb',
    kind: 'longbone',
    side: 'L',
    size: { length: 0.45, width: 0.09, depth: 0.09 },
    geoOffset: [0, -0.23, 0],
    slots: [{ id: 'wrist', pos: [0, -0.45, 0], accepts: ['manusDigit'] }],
    limits: limbLimit,
  },
  {
    baseId: 'manusDigit',
    name: '指骨',
    group: 'forelimb',
    kind: 'digit',
    side: 'L',
    size: { length: 0.16, width: 0.07, depth: 0.07 },
    geoOffset: [0, -0.08, 0.02],
    slots: [{ id: 'next', pos: [0, -0.16, 0.03], accepts: ['manusDigit'] }],
    limits: digitLimit,
  },

  // ===== 后肢（粗壮） =====
  {
    baseId: 'femur',
    name: '股骨',
    group: 'hindlimb',
    kind: 'longbone',
    side: 'L',
    size: { length: 1.15, width: 0.22, depth: 0.22 },
    geoOffset: [0, -0.58, 0],
    slots: [{ id: 'knee', pos: [0, -1.15, 0], accepts: ['tibia'] }],
    limits: limbLimit,
  },
  {
    baseId: 'tibia',
    name: '胫骨',
    group: 'hindlimb',
    kind: 'longbone',
    side: 'L',
    size: { length: 1.05, width: 0.17, depth: 0.17 },
    geoOffset: [0, -0.53, 0],
    slots: [{ id: 'ankle', pos: [0, -1.05, 0], accepts: ['metatarsal'] }],
    limits: limbLimit,
  },
  {
    baseId: 'metatarsal',
    name: '跖骨',
    group: 'hindlimb',
    kind: 'longbone',
    side: 'L',
    size: { length: 0.6, width: 0.1, depth: 0.1 },
    geoOffset: [0, -0.3, 0.05],
    slots: [{ id: 'toe', pos: [0, -0.6, 0.08], accepts: ['pedalDigit'] }],
    limits: { x: [DEG(-100), DEG(30)], y: [DEG(-20), DEG(20)], z: [DEG(-15), DEG(15)] },
  },
  {
    baseId: 'pedalDigit',
    name: '趾骨',
    group: 'hindlimb',
    kind: 'digit',
    side: 'L',
    size: { length: 0.22, width: 0.1, depth: 0.1 },
    geoOffset: [0, -0.11, 0.06],
    slots: [{ id: 'next', pos: [0, -0.22, 0.1], accepts: ['pedalDigit'] }],
    limits: digitLimit,
  },
];

// ---------- 模板解析（含镜像） ----------

const MIRROR_GROUPS = new Set(['ribs', 'girdle', 'forelimb', 'hindlimb', 'other']);

/** 生成单侧模板的镜像（x 取反；欧拉映射在实例姿态层面处理） */
function mirrorTemplate(t: BoneTemplate): BoneTemplate {
  return {
    ...t,
    side: 'R',
    rootPos: t.rootPos ? mirrorPoint(t.rootPos) : t.rootPos,
    geoOffset: t.geoOffset ? mirrorPoint(t.geoOffset) : t.geoOffset,
    slots: t.slots.map((s) => ({ ...s, pos: mirrorPoint(s.pos) as Vec3Tuple })),
  };
}

let resolvedCache: ResolvedTemplate[] | null = null;

/** 全部可用模板（含自动镜像的 R 侧），键为 `${baseId}:${side}` */
export function getResolvedTemplates(): ResolvedTemplate[] {
  if (resolvedCache) return resolvedCache;
  const out: ResolvedTemplate[] = [];
  for (const t of TEMPLATES) {
    if (t.side === 'M') {
      out.push({ ...t, key: `${t.baseId}:M` });
    } else {
      out.push({ ...t, key: `${t.baseId}:L` });
      out.push({ ...mirrorTemplate(t), key: `${t.baseId}:R` });
    }
  }
  resolvedCache = out;
  return out;
}

export function templateByKey(key: string): ResolvedTemplate {
  const t = getResolvedTemplates().find((x) => x.key === key);
  if (!t) throw new Error(`未知骨骼模板: ${key}`);
  return t;
}

export function templateByBase(baseId: string, side: Side): ResolvedTemplate {
  return templateByKey(`${baseId}:${side}`);
}

/** 该模板是否属于左右成对类型 */
export function isPaired(baseId: string): boolean {
  const t = TEMPLATES.find((x) => x.baseId === baseId);
  return !!t && MIRROR_GROUPS.has(t.group) && t.side !== 'M';
}

export const GROUP_LABELS: Record<string, string> = {
  skull: '头骨',
  spine: '脊柱',
  ribs: '胸廓',
  girdle: '肢带',
  forelimb: '前肢',
  hindlimb: '后肢',
  other: '杂骨',
};

export const GROUP_ORDER: BoneTemplate['group'][] = [
  'skull', 'spine', 'ribs', 'girdle', 'forelimb', 'hindlimb', 'other',
];
