import * as THREE from 'three';
import type { Mesh } from 'three';
import type { AxisName, MeasureRecord } from '../types';
import { PLANE_FRAMES } from './joint';
import { local2DToWorld, makePlane, worldToLocal2D, type SectionLoop } from './section';
import './bvh';

export interface MeasureHit {
  record: MeasureRecord;
  /** 射线命中点(世界坐标),用于绘制临时测量线 */
  points: THREE.Vector3[];
}

let measureSeq = 0;

/**
 * 在指定截面上,从锚点沿截面内基向量方向发射射线,对当前可见构件做 BVH 求交。
 * 榫头宽度:取所有命中区间的最大跨度(最外侧两个交点)。
 * 榫眼深度:取实体之间最大空腔(进入-穿出的偶数区间)。
 */
export function measureOnSection(
  meshes: Mesh[],
  sectionAxis: AxisName,
  offset: number,
  anchor: [number, number],
  kind: 'tenon-width' | 'mortise-depth',
  bounds: THREE.Box3,
): MeasureHit | null {
  const built = buildRay(sectionAxis, offset, anchor, bounds);
  if (!built) return null;

  // Raycaster.raycast 已在 bvh.ts 中替换为 three-mesh-bvh 加速版本
  const raycaster = new THREE.Raycaster(built.origin, built.dir, 0, 100);
  const intersections = raycaster.intersectObjects(meshes, false);
  if (intersections.length < 2) return null;

  const hits = intersections.map((h) => ({ t: h.distance, point: h.point.clone() }));
  const value =
    kind === 'tenon-width'
      ? hits[hits.length - 1].t - hits[0].t
      : computeCavityDepth(hits);

  const record: MeasureRecord = {
    id: `m-${Date.now()}-${measureSeq++}`,
    kind,
    plane: sectionAxis,
    anchor: [...anchor] as [number, number],
    axis: built.axisName,
    value,
    detail: `${hits.length} 个交点`,
    createdAt: Date.now(),
  };
  return { record, points: hits.map((h) => h.point) };
}

/** 相邻交点交替 实体/空气,空腔 = 偶数段(第 2 段起)的长度,取最大值 */
function computeCavityDepth(hits: { t: number; point: THREE.Vector3 }[]): number {
  let maxGap = 0;
  for (let i = 1; i < hits.length - 1; i += 2) {
    const gap = hits[i + 1].t - hits[i].t;
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

interface BuiltRay {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  axisName: AxisName;
}

/** 测量射线:优先沿锚点距截面中心更远的那根基向量,从包围盒外射入 */
function buildRay(
  sectionAxis: AxisName,
  offset: number,
  anchor: [number, number],
  bounds: THREE.Box3,
): BuiltRay | null {
  const frame = PLANE_FRAMES[sectionAxis];
  const plane = makePlane(sectionAxis, offset);
  const center = bounds.getCenter(new THREE.Vector3()).projectOnPlane(frame.normal);
  const projected = local2DToWorld(anchor[0], anchor[1], sectionAxis, offset);
  const toward = projected.clone().sub(center);
  if (toward.lengthSq() < 1e-10) toward.copy(frame.uDir);

  let best = frame.uDir;
  let bestDot = -Infinity;
  for (const c of [frame.uDir, frame.vDir]) {
    const d = Math.abs(toward.dot(c));
    if (d > bestDot) {
      bestDot = d;
      best = c;
    }
  }

  // 射线从包围盒外射入,保证从空气进入实体,奇偶区间语义成立
  const reach = bounds.getSize(new THREE.Vector3()).length();
  const farPoint = projected.clone().addScaledVector(best, reach);
  const origin = projected.clone().addScaledVector(best, -reach);
  const planePoint = new THREE.Vector3();
  if (!plane.intersectLine(new THREE.Line3(origin, farPoint), planePoint)) return null;

  return { origin, dir: best.clone(), axisName: axisFromDir(best) };
}

function axisFromDir(v: THREE.Vector3): AxisName {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return 'x';
  if (ay >= ax && ay >= az) return 'y';
  return 'z';
}

/** 判断点贴近哪个活动截面(测量点击时用来选平面) */
export function nearestSectionAxis(
  point: THREE.Vector3,
  sections: { axis: AxisName; offset: number; loops: SectionLoop[] }[],
): { axis: AxisName; offset: number } | null {
  let best: { axis: AxisName; offset: number; d: number } | null = null;
  for (const s of sections) {
    if (s.loops.length === 0) continue;
    const frame = PLANE_FRAMES[s.axis];
    const d = Math.abs(point.dot(frame.normal) - s.offset);
    if (!best || d < best.d) best = { axis: s.axis, offset: s.offset, d };
  }
  return best && best.d < 0.15 ? { axis: best.axis, offset: best.offset } : null;
}

export { worldToLocal2D };
