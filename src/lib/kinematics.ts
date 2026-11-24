// 正向运动学：基于 BoneInstance[] 的层级矩阵计算、插槽查询、镜像与贴地数学
import * as THREE from 'three';
import type { BoneInstance, ProjectData, ResolvedTemplate, Side, Vec3Tuple } from '../types';
import { templateByKey } from './catalog';
import { mirrorEuler, mirrorPoint } from './math3d';

export interface ComputedBone {
  bone: BoneInstance;
  template: ResolvedTemplate;
  /** 相对父插槽节点的局部矩阵 */
  localMatrix: THREE.Matrix4;
  /** 世界矩阵（含骨架根变换） */
  worldMatrix: THREE.Matrix4;
  worldPos: THREE.Vector3;
  worldQuat: THREE.Quaternion;
  /** 各插槽的世界矩阵缓存 */
  slotWorld: Map<string, THREE.Matrix4>;
  children: string[];
}

export interface FKResult {
  map: Map<string, ComputedBone>;
  rootIds: string[];
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();

/** 计算全部骨骼的世界矩阵与插槽世界位置 */
export function computeFK(data: ProjectData): FKResult {
  const rootM = new THREE.Matrix4();
  _e.set(
    data.rootTransform.rot[0],
    data.rootTransform.rot[1],
    data.rootTransform.rot[2],
    'XYZ',
  );
  rootM.compose(_v.fromArray(data.rootTransform.pos), _q.setFromEuler(_e), _s);

  const byParent = new Map<string | null, BoneInstance[]>();
  for (const b of data.bones) {
    const arr = byParent.get(b.parentId) ?? [];
    arr.push(b);
    byParent.set(b.parentId, arr);
  }

  const map = new Map<string, ComputedBone>();
  const rootIds: string[] = [];

  const visit = (bone: BoneInstance) => {
    const template = templateByKey(`${bone.templateBaseId}:${bone.side}`);
    const local = new THREE.Matrix4();
    _e.set(bone.rotation[0], bone.rotation[1], bone.rotation[2], 'XYZ');
    local.compose(
      _v.fromArray(bone.localPos),
      _q.setFromEuler(_e),
      _s,
    );

    let world: THREE.Matrix4;
    if (bone.parentId) {
      const parent = map.get(bone.parentId);
      const slotM = parent?.slotWorld.get(bone.parentSlotId ?? '');
      if (!parent || !slotM) {
        // 父级缺失时退化为根级骨骼，避免数据损坏导致整体崩溃
        world = local.clone().premultiply(rootM);
      } else {
        world = local.clone().premultiply(slotM);
      }
    } else {
      world = local.clone().premultiply(rootM);
      rootIds.push(bone.id);
    }

    const slotWorld = new Map<string, THREE.Matrix4>();
    for (const slot of template.slots) {
      _m.makeTranslation(slot.pos[0], slot.pos[1], slot.pos[2]);
      slotWorld.set(slot.id, _m.clone().premultiply(world));
    }

    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    world.decompose(wp, wq, _v);

    const cb: ComputedBone = {
      bone,
      template,
      localMatrix: local,
      worldMatrix: world,
      worldPos: wp,
      worldQuat: wq,
      slotWorld,
      children: (byParent.get(bone.id) ?? []).map((c) => c.id),
    };
    map.set(bone.id, cb);

    for (const child of byParent.get(bone.id) ?? []) visit(child);
  };

  for (const b of byParent.get(null) ?? []) visit(b);
  return { map, rootIds };
}

export interface NearestSlot {
  parentId: string;
  slotId: string;
  worldPos: THREE.Vector3;
  distance: number;
}

/**
 * 在已装配骨架中查找距离 dropPoint 最近、且接受该模板的空闲插槽。
 * excludeBoneId 用于镜像/替换场景排除自身。
 */
export function findNearestSlot(
  fk: FKResult,
  template: ResolvedTemplate,
  dropPoint: THREE.Vector3,
  occupied: Set<string>,
  excludeBoneId?: string,
): NearestSlot | null {
  let best: NearestSlot | null = null;
  for (const cb of fk.map.values()) {
    if (cb.bone.id === excludeBoneId) continue;
    for (const slot of cb.template.slots) {
      const occKey = `${cb.bone.id}#${slot.id}`;
      if (occupied.has(occKey)) continue;
      if (slot.accepts.length > 0 && !slot.accepts.includes(template.baseId)) continue;
      const m = cb.slotWorld.get(slot.id)!;
      _v.setFromMatrixPosition(m);
      const d = _v.distanceTo(dropPoint);
      if (!best || d < best.distance) {
        best = {
          parentId: cb.bone.id,
          slotId: slot.id,
          worldPos: _v.clone(),
          distance: d,
        };
      }
    }
  }
  return best;
}

/** 收集已占用插槽键集合 */
export function collectOccupied(bones: BoneInstance[]): Set<string> {
  const set = new Set<string>();
  for (const b of bones) {
    if (b.parentId && b.parentSlotId) set.add(`${b.parentId}#${b.parentSlotId}`);
  }
  return set;
}

/** 某骨骼的全部后代 id（不含自身） */
export function descendantIds(bones: BoneInstance[], id: string): string[] {
  const childMap = new Map<string, string[]>();
  for (const b of bones) {
    if (b.parentId) {
      const arr = childMap.get(b.parentId) ?? [];
      arr.push(b.id);
      childMap.set(b.parentId, arr);
    }
  }
  const out: string[] = [];
  const stack = [...(childMap.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    stack.push(...(childMap.get(cur) ?? []));
  }
  return out;
}

/** 对侧 */
export function oppositeSide(side: Side): Side {
  if (side === 'L') return 'R';
  if (side === 'R') return 'L';
  return 'M';
}

/** 镜像插槽 id（L/R 后缀互换；无后缀保持不变） */
export function mirrorSlotId(slotId: string): string {
  if (slotId.endsWith('L')) return slotId.slice(0, -1) + 'R';
  if (slotId.endsWith('R')) return slotId.slice(0, -1) + 'L';
  return slotId;
}

/** 镜像后的局部姿态（位置 + 欧拉旋转） */
export function mirrorLocalTransform(b: BoneInstance): {
  localPos: Vec3Tuple;
  rotation: Vec3Tuple;
} {
  return {
    localPos: mirrorPoint(b.localPos),
    rotation: mirrorEuler(b.rotation),
  };
}

/**
 * 贴地：对每个锚点骨骼，依据其子树最低世界点与地形高度的差，
 * 沿世界 +Y 平移并换算回插槽局部坐标，写入 localPos。
 * lowestPoint 由场景层（带 BVH 的网格）提供。
 */
export function snapAnchorsToGround(
  data: ProjectData,
  anchorIds: string[],
  lowestPoint: (boneId: string) => { x: number; y: number; z: number } | null,
  groundY: (x: number, z: number) => number,
): ProjectData {
  const fk = computeFK(data);
  const next: ProjectData = JSON.parse(JSON.stringify(data));
  const index = new Map(next.bones.map((b, i) => [b.id, i]));

  for (const anchorId of anchorIds) {
    const cb = fk.map.get(anchorId);
    const low = lowestPoint(anchorId);
    if (!cb || !low) continue;
    const dy = groundY(low.x, low.z) - low.y;
    if (Math.abs(dy) < 1e-4) continue;
    // 世界位移 (0, dy, 0) 转换到锚点父插槽的局部旋转系
    const parent = cb.bone.parentId ? fk.map.get(cb.bone.parentId) : null;
    const slotM = parent?.slotWorld.get(cb.bone.parentSlotId ?? '');
    const localDelta = new THREE.Vector3(0, dy, 0);
    if (slotM) {
      const sq = new THREE.Quaternion();
      slotM.decompose(_v, sq, _s);
      localDelta.applyQuaternion(sq.invert());
    }
    const idx = index.get(anchorId)!;
    const lp = next.bones[idx].localPos;
    next.bones[idx].localPos = [
      lp[0] + localDelta.x,
      lp[1] + localDelta.y,
      lp[2] + localDelta.z,
    ];
  }
  return next;
}

/** 贴地锚点：跖骨与第一指骨（足/手的着地处） */
export const GROUND_ANCHOR_BASES = new Set(['metatarsal', 'manusDigit']);

export function findAnchorIds(bones: BoneInstance[]): string[] {
  return bones
    .filter((b) => GROUND_ANCHOR_BASES.has(b.templateBaseId))
    .map((b) => b.id);
}
