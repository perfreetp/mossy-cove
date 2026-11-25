import * as THREE from 'three';
import type { BoundaryLoop } from '../types';

/**
 * 从裁剪后的网格中提取断面边界环。
 *
 * 平面裁剪后，刀平面与网格的交线处的边只被一个（保留侧）三角形引用，
 * 形成拓扑边界边；被切开三角形在切面上的内部边虽然也只出现一次，但
 * 它们的端点不会连成闭合环。这里：
 *   1. 统计每条无向边出现次数，取仅出现一次的为边界边，建邻接表；
 *   2. 沿邻接表行走（每点度数 2，按"非前驱"规则接续）回到起点得闭合环；
 *   3. 用切割点（aCap=1）多数投票区分裁剪断面环与模型原始开口。
 */
export function extractBoundaryLoops(geometry: THREE.BufferGeometry): BoundaryLoop[] {
  const index = geometry.index;
  if (!index) return [];
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const capAttr = geometry.getAttribute('aCap') as THREE.BufferAttribute | undefined;
  const triCount = index.count / 3;

  const keyOf = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

  // 断面（补洞）三角形不参与边界统计：补洞后器官网格的开口仍被识别为
  // 同一条环，而不会因断面表面的存在产生重复环
  const capGroup = geometry.groups.find((g) => g.materialIndex === 1);
  const triIsCap = new Uint8Array(triCount);
  if (capGroup) {
    for (let i = capGroup.start; i < capGroup.start + capGroup.count; i += 3) {
      triIsCap[i / 3] = 1;
    }
  }

  // 无向边 -> 出现次数
  const edgeCount = new Map<string, number>();
  for (let t = 0; t < triCount; t++) {
    if (triIsCap[t]) continue;
    const a = index.getX(t * 3);
    const b = index.getX(t * 3 + 1);
    const c = index.getX(t * 3 + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const key = keyOf(u, v);
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }

  // 边界邻接表：仅出现一次、且两端都是切割顶点（位于刀平面上）的边。
  // 第二个条件至关重要——被切开三角形在切面上的内部边同样只出现一次，
  // 但它们不成环；刀平面经过源顶点时，CLIP_EPS 容差已保证这些赤道点
  // 也带 aCap=1 标记，不会被漏掉。
  const isCut = (id: number) => capAttr !== undefined && capAttr.getX(id) > 0.5;
  const adj = new Map<number, number[]>();
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue;
    const sep = key.indexOf('_');
    const a = Number(key.slice(0, sep));
    const b = Number(key.slice(sep + 1));
    if (!isCut(a) || !isCut(b)) continue;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  if (adj.size === 0) return [];

  const loops: BoundaryLoop[] = [];
  const consumed = new Set<number>();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const refPoint = new THREE.Vector3();

  for (const start of adj.keys()) {
    if (consumed.has(start)) continue;

    // 行走：每点取"不是前驱"的邻点接续，直到回到起点
    const ring: number[] = [];
    let prev = -1;
    let cur = start;
    let closed = false;
    let safety = adj.size + 2;
    while (safety-- > 0) {
      ring.push(cur);
      consumed.add(cur);
      const neighbors = adj.get(cur)!;
      const next = neighbors.find((n) => n !== prev);
      if (next === undefined) break; // 度数 1 的悬点，弃用此链
      if (next === start) {
        closed = true;
        break;
      }
      prev = cur;
      cur = next;
    }
    if (!closed || ring.length < 3) continue;

    // ---- 环几何量：有向面积 / 周长 / 最佳拟合平面 --------------------------
    const center = new THREE.Vector3();
    for (const id of ring) {
      center.add(tmpA.fromBufferAttribute(pos, id));
    }
    center.multiplyScalar(1 / ring.length);

    // Newell 法向
    normal.set(0, 0, 0);
    for (let i = 0; i < ring.length; i++) {
      tmpA.fromBufferAttribute(pos, ring[i]);
      tmpB.fromBufferAttribute(pos, ring[(i + 1) % ring.length]);
      normal.x += (tmpA.y - tmpB.y) * (tmpA.z + tmpB.z);
      normal.y += (tmpA.z - tmpB.z) * (tmpA.x + tmpB.x);
      normal.z += (tmpA.x - tmpB.x) * (tmpA.y + tmpB.y);
    }
    const signedArea2 = normal.length();
    if (signedArea2 < 1e-12) continue;
    normal.multiplyScalar(1 / signedArea2);

    let perimeter = 0;
    for (let i = 0; i < ring.length; i++) {
      tmpA.fromBufferAttribute(pos, ring[i]);
      tmpB.fromBufferAttribute(pos, ring[(i + 1) % ring.length]);
      perimeter += tmpA.distanceTo(tmpB);
    }

    refPoint.copy(center);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, refPoint);

    // 切割点多数投票：裁剪断面环上绝大多数顶点 aCap=1；
    // 模型原始开口环得票为 0，被排除
    let capVotes = 0;
    if (capAttr) {
      for (const id of ring) if (capAttr.getX(id) > 0.5) capVotes++;
    }
    if (capAttr === undefined || capVotes * 2 < ring.length) continue;

    // 统一环方向：使有向面积法向与平面法向同向
    tmpC.set(0, 0, 0);
    for (let i = 0; i < ring.length; i++) {
      tmpA.fromBufferAttribute(pos, ring[i]).sub(center);
      tmpB.fromBufferAttribute(pos, ring[(i + 1) % ring.length]).sub(center);
      tmpC.x += tmpA.y * tmpB.z - tmpA.z * tmpB.y;
      tmpC.y += tmpA.z * tmpB.x - tmpA.x * tmpB.z;
      tmpC.z += tmpA.x * tmpB.y - tmpA.y * tmpB.x;
    }
    if (tmpC.dot(normal) < 0) ring.reverse();

    loops.push({
      indices: ring,
      plane,
      signedArea: signedArea2 / 2,
      area: signedArea2 / 2,
      perimeter,
    });
  }

  return loops;
}
