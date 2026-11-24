// 镜像复制：把一棵骨骼子树反射到对侧，保持插槽父子层级
import type { BoneInstance, ProjectData, Side } from '../types';
import {
  computeFK,
  descendantIds,
  mirrorLocalTransform,
  mirrorSlotId,
  oppositeSide,
} from './kinematics';
import { makeBoneId } from './math3d';

/** 统计每个 baseId+side 已有的最大实例序号，用于生成不冲突的 id */
function nextCounters(bones: BoneInstance[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bones) {
    const n = parseInt(b.id.split('#')[1] ?? '0', 10);
    const key = `${b.templateBaseId}:${b.side}`;
    m.set(key, Math.max(m.get(key) ?? 0, n));
  }
  return m;
}

export interface MirrorResult {
  bones: BoneInstance[];
  /** 新生成的根骨骼 id（对侧副本的根） */
  newRootId: string | null;
  /** 目标插槽已被占用等原因导致只能挂到根层级 */
  fellBackToRoot: boolean;
}

/**
 * 镜像 sourceId 整棵子树。
 * 前置条件：sourceId 是 L/R 侧骨骼（M 侧骨骼无镜像意义）。
 */
export function mirrorSubtree(data: ProjectData, sourceId: string): MirrorResult {
  const fk = computeFK(data);
  const source = data.bones.find((b) => b.id === sourceId);
  if (!source || source.side === 'M') {
    return { bones: [], newRootId: null, fellBackToRoot: false };
  }

  const order = [sourceId, ...descendantIds(data.bones, sourceId)];
  const counters = nextCounters(data.bones);
  const occupied = new Set(
    data.bones
      .filter((b) => b.parentId && b.parentSlotId)
      .map((b) => `${b.parentId}#${b.parentSlotId}`),
  );

  const idMap = new Map<string, string>();
  const created: BoneInstance[] = [];
  let fellBack = false;

  for (const oldId of order) {
    const old = data.bones.find((b) => b.id === oldId)!;
    const newSide: Side = oppositeSide(old.side);
    const key = `${old.templateBaseId}:${newSide}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    const newId = makeBoneId(old.templateBaseId, newSide, n);
    idMap.set(oldId, newId);

    const mt = mirrorLocalTransform(old);
    let parentId: string | null = null;
    let parentSlotId: string | null = null;

    if (oldId === sourceId) {
      if (old.parentId && old.parentSlotId) {
        const targetSlot = mirrorSlotId(old.parentSlotId);
        const occKey = `${old.parentId}#${targetSlot}`;
        const parentCb = fk.map.get(old.parentId);
        const slotExists = parentCb?.template.slots.some((s) => s.id === targetSlot);
        if (slotExists && !occupied.has(occKey)) {
          parentId = old.parentId;
          parentSlotId = targetSlot;
          occupied.add(occKey);
        } else {
          fellBack = true;
        }
      }
    } else {
      // 子节点：父级一定在本次新建集合中
      parentId = idMap.get(old.parentId!)!;
      parentSlotId = mirrorSlotId(old.parentSlotId!);
    }

    created.push({
      id: newId,
      templateBaseId: old.templateBaseId,
      side: newSide,
      parentId,
      parentSlotId,
      localPos: mt.localPos,
      rotation: mt.rotation,
    });
  }

  return {
    bones: created,
    newRootId: idMap.get(sourceId) ?? null,
    fellBackToRoot: fellBack,
  };
}

/** 判断某骨骼是否已存在对侧副本（同 baseId、对侧、同层级插槽） */
export function findMirrorPartner(
  data: ProjectData,
  boneId: string,
): BoneInstance | null {
  const b = data.bones.find((x) => x.id === boneId);
  if (!b || b.side === 'M') return null;
  const wantSide = oppositeSide(b.side);
  // 优先：同父级 + 镜像插槽
  if (b.parentId && b.parentSlotId) {
    const wantSlot = mirrorSlotId(b.parentSlotId);
    const direct = data.bones.find(
      (x) =>
        x.templateBaseId === b.templateBaseId &&
        x.side === wantSide &&
        x.parentId === b.parentId &&
        x.parentSlotId === wantSlot,
    );
    if (direct) return direct;
  }
  // 退而求其次：任意同 baseId 对侧骨骼
  return (
    data.bones.find(
      (x) => x.templateBaseId === b.templateBaseId && x.side === wantSide,
    ) ?? null
  );
}
