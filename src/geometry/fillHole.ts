import * as THREE from 'three';
import earcut from 'earcut';
import type { CapRecord } from '../types';

/**
 * 断面补洞。
 *
 * 设计要点：
 * - 补洞生成的断面是独立表面，环上顶点按"吸附位置"复制一份（坐标与边界环
 *   顶点完全一致，即吸附约束），不与器官网格共享顶点，因此整面可独立平移。
 * - aCap 属性：1 = 断面环/切割点，2 = 断面内部可调顶点（顶点级微调句柄）。
 * - 三角形写入 materialIndex=1 的 group，与器官网格（0）分材质显示。
 * - earcut 在断面平面的二维基上做三角化，支持凹多边形；再插入质心调整点，
 *   将包含它的三角形一分为三，保证断面至少有一个可拖动的内部顶点。
 */

export interface FillResult {
  geometry: THREE.BufferGeometry;
  cap: CapRecord;
  /** 本次新建的全部顶点 id（含吸附环点与内部点） */
  newVertexIds: number[];
  /** 内部可调顶点 id */
  handleIds: number[];
}

function makePlaneBasis(normal: THREE.Vector3) {
  const u = new THREE.Vector3();
  if (Math.abs(normal.y) < 0.9) u.set(0, 1, 0);
  else u.set(1, 0, 0);
  u.cross(normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  return { u, v };
}

/**
 * @param snappedPositions 已按顺序吸附到边界环上的点（首尾不重复）
 * @param plane 断面平面
 */
export function fillHole(
  source: THREE.BufferGeometry,
  snappedPositions: THREE.Vector3[],
  plane: THREE.Plane,
): FillResult {
  if (snappedPositions.length < 3) {
    throw new Error('补洞至少需要 3 个吸附点');
  }

  const geometry = source.clone();
  if (!geometry.index) throw new Error('fillHole 要求 indexed geometry');
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const capAttr = geometry.getAttribute('aCap') as THREE.BufferAttribute | undefined;

  const n = snappedPositions.length;
  const normal = plane.normal.clone().normalize();
  const { u, v } = makePlaneBasis(normal);
  const origin = snappedPositions[0].clone().projectOnPlane(normal).addScaledVector(normal, -plane.constant);

  // ---- 1. 投影到平面二维基，earcut 三角化 -----------------------------------
  const coords: number[] = [];
  const data2d: number[] = [];
  for (const p of snappedPositions) {
    const rel = p.clone().sub(origin);
    const x = rel.dot(u);
    const y = rel.dot(v);
    data2d.push(x, y);
    coords.push(x, y);
  }
  const tris = earcut(data2d);
  if (tris.length === 0) throw new Error('多边形三角化失败（点可能自交）');

  // ---- 2. 写入吸附环顶点（复制体，aCap=1） ---------------------------------
  const newVertexIds: number[] = [];
  const posArr = Array.from(posAttr.array as Float32Array);
  const capArr = capAttr ? Array.from(capAttr.array as Float32Array) : new Array(posAttr.count).fill(0);

  for (const p of snappedPositions) {
    posArr.push(p.x, p.y, p.z);
    capArr.push(1);
    newVertexIds.push(posArr.length / 3 - 1);
  }

  // ---- 3. 质心内部调整点（aCap=2），拆分包含它的三角形 ----------------------
  const centroid = new THREE.Vector3();
  for (const p of snappedPositions) centroid.add(p);
  centroid.multiplyScalar(1 / n);
  // 微贴平面
  centroid.addScaledVector(normal, -plane.distanceToPoint(centroid));

  posArr.push(centroid.x, centroid.y, centroid.z);
  capArr.push(2);
  const centerId = posArr.length / 3 - 1;
  newVertexIds.push(centerId);
  const handleIds = [centerId];

  const cRel = centroid.clone().sub(origin);
  const cx = cRel.dot(u);
  const cy = cRel.dot(v);

  const indexArr = Array.from(geometry.index.array as Uint32Array | Uint16Array);
  const triangleStart = indexArr.length;

  const pointInTri = (ax: number, ay: number, bx: number, by: number, dx: number, dy: number) => {
    const d1 = (cx - bx) * (ay - by) - (ax - bx) * (cy - by);
    const d2 = (cx - dx) * (by - dy) - (bx - dx) * (cy - dy);
    const d3 = (cx - ax) * (dy - ay) - (dx - ax) * (cy - ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  let inserted = false;
  for (let k = 0; k < tris.length; k += 3) {
    const a = newVertexIds[tris[k]];
    const b = newVertexIds[tris[k + 1]];
    const d = newVertexIds[tris[k + 2]];
    if (!inserted) {
      const i0 = tris[k];
      const i1 = tris[k + 1];
      const i2 = tris[k + 2];
      if (
        pointInTri(
          coords[i0 * 2], coords[i0 * 2 + 1],
          coords[i1 * 2], coords[i1 * 2 + 1],
          coords[i2 * 2], coords[i2 * 2 + 1],
        )
      ) {
        // 拆为三个三角形，保持绕序
        indexArr.push(a, b, centerId, b, d, centerId, d, a, centerId);
        inserted = true;
        continue;
      }
    }
    indexArr.push(a, b, d);
  }
  if (!inserted) {
    // 数值退化时退化为扇形（仍保证合法覆盖）
    for (let k = 0; k < tris.length; k += 3) {
      indexArr.push(newVertexIds[tris[k]], newVertexIds[tris[k + 1]], newVertexIds[tris[k + 2]]);
    }
  }
  const triangleCount = indexArr.length - triangleStart;

  // ---- 4. 重建属性 / group / BVH --------------------------------------------
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  geometry.setAttribute('aCap', new THREE.Float32BufferAttribute(capArr, 1));
  const indexType = posArr.length / 3 > 65535 ? Uint32Array : Uint16Array;
  geometry.setIndex(Array.from(new indexType(indexArr)));

  // 断面 group：与既有 group 合并/追加
  const groups = geometry.groups.filter((g) => g.materialIndex === 0);
  const bodyCount = groups.reduce((s, g) => s + g.count, 0);
  geometry.clearGroups();
  if (bodyCount > 0) geometry.addGroup(0, bodyCount, 0);
  geometry.addGroup(bodyCount, triangleCount, 1);

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeBoundsTree();

  const cap: CapRecord = {
    loops: [],
    plane: plane.clone(),
    triangleStart,
    triangleCount,
    area: polygonArea3D(snappedPositions),
    perimeter: polygonPerimeter3D(snappedPositions),
  };

  return { geometry, cap, newVertexIds, handleIds };
}

/** 在已有断面上追加一个内部调整点：拆分包含拾取点的断面三角形为三 */
export function insertCapHandle(
  source: THREE.BufferGeometry,
  point: THREE.Vector3,
): { geometry: THREE.BufferGeometry; handleId: number } | null {
  const geometry = source.clone();
  const index = geometry.index!;
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const capAttr = geometry.getAttribute('aCap') as THREE.BufferAttribute;

  // 找包含 point 的断面三角形（aCap 顶点组成、materialIndex=1 group）
  const capGroup = geometry.groups.find((g) => g.materialIndex === 1);
  if (!capGroup) return null;

  const p = point;
  let found = -1;
  for (let i = capGroup.start; i < capGroup.start + capGroup.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    if (pointInTriangle3D(p, a, b, c, posAttr)) {
      found = i;
      break;
    }
  }
  if (found < 0) return null;

  const posArr = Array.from(posAttr.array as Float32Array);
  const capArr = Array.from(capAttr.array as Float32Array);
  posArr.push(p.x, p.y, p.z);
  capArr.push(2);
  const handleId = posArr.length / 3 - 1;

  const indexArr = Array.from(index.array as Uint32Array | Uint16Array);
  const a = indexArr[found];
  const b = indexArr[found + 1];
  const c = indexArr[found + 2];
  indexArr.splice(found, 3, a, b, handleId, b, c, handleId, c, a, handleId);

  const indexType2 = posArr.length / 3 > 65535 ? Uint32Array : Uint16Array;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  geometry.setAttribute('aCap', new THREE.Float32BufferAttribute(capArr, 1));
  geometry.setIndex(Array.from(new indexType2(indexArr)));
  geometry.computeVertexNormals();
  geometry.computeBoundsTree();
  return { geometry, handleId };
}

function pointInTriangle3D(
  p: THREE.Vector3,
  a: number,
  b: number,
  c: number,
  pos: THREE.BufferAttribute,
): boolean {
  const va = new THREE.Vector3().fromBufferAttribute(pos, a);
  const vb = new THREE.Vector3().fromBufferAttribute(pos, b);
  const vc = new THREE.Vector3().fromBufferAttribute(pos, c);
  const n = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va));
  if (n.lengthSq() < 1e-14) return false;
  n.normalize();
  if (Math.abs(new THREE.Vector3().subVectors(p, va).dot(n)) > 1e-4) return false;
  const tri = new THREE.Triangle(va, vb, vc);
  tri.a = va;
  // 重心坐标判定
  const v0 = new THREE.Vector3().subVectors(vc, va);
  const v1 = new THREE.Vector3().subVectors(vb, va);
  const v2 = new THREE.Vector3().subVectors(p, va);
  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d11 = v1.dot(v1);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-14) return false;
  const alpha = (d11 * d20 - d01 * d21) / denom;
  const beta = (d00 * d21 - d01 * d20) / denom;
  return alpha >= -1e-5 && beta >= -1e-5 && alpha + beta <= 1 + 1e-5;
}

export function polygonArea3D(points: THREE.Vector3[]): number {
  const normal = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    tmpA.copy(points[i]);
    tmpB.copy(points[(i + 1) % points.length]);
    normal.x += (tmpA.y - tmpB.y) * (tmpA.z + tmpB.z);
    normal.y += (tmpA.z - tmpB.z) * (tmpA.x + tmpB.x);
    normal.z += (tmpA.x - tmpB.x) * (tmpA.y + tmpB.y);
  }
  return normal.length() / 2;
}

export function polygonPerimeter3D(points: THREE.Vector3[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i].distanceTo(points[(i + 1) % points.length]);
  }
  return sum;
}
