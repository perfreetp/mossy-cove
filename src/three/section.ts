import earcut from 'earcut';
import * as THREE from 'three';
import { ExtendedTriangle, MeshBVH } from 'three-mesh-bvh';
import type { AxisName } from '../types';
import { PLANE_FRAMES } from './joint';

export interface SectionLoop {
  /** 世界坐标闭合环(首点不重复) */
  points: THREE.Vector3[];
  /** 平面局部 2D 坐标,与 points 一一对应 */
  local2d: [number, number][];
  /** 2D 有符号面积,>0 为外环 */
  signedArea: number;
}

export interface SectionResult {
  axis: AxisName;
  loops: SectionLoop[];
  /** 覆盖全部构件截面的填充网格(带 BVH,可用于拾取) */
  capGeometry: THREE.BufferGeometry | null;
}

interface EdgeKey {
  a: number;
  b: number;
}

const KEY_EPS = 1e5; // 坐标量化精度(1e-5 m)

function quantize(v: THREE.Vector3): string {
  return `${Math.round(v.x * KEY_EPS)},${Math.round(v.y * KEY_EPS)},${Math.round(v.z * KEY_EPS)}`;
}

/**
 * 用 BVH shapecast 求单个网格与平面的交线段,再把线段缝合成闭合轮廓环。
 * 相比 Marching Cubes 类方案,这里直接切原始三角面,得到的是精确截面轮廓。
 */
export function computeSection(
  mesh: THREE.Mesh,
  plane: THREE.Plane,
  axis: AxisName,
): SectionLoop[] {
  const bvh: MeshBVH | undefined = mesh.geometry.boundsTree;
  if (!bvh) return [];

  mesh.updateWorldMatrix(true, false);
  const invMatrix = mesh.matrixWorld.clone().invert();
  const localPlane = plane.clone().applyMatrix4(invMatrix);

  const positions: THREE.Vector3[] = [];
  const vertexId = new Map<string, number>();
  const edges: EdgeKey[] = [];
  const edgeSet = new Set<string>();

  const intern = (p: THREE.Vector3): number => {
    const key = quantize(p);
    let id = vertexId.get(key);
    if (id === undefined) {
      id = positions.push(p.clone()) - 1;
      vertexId.set(key, id);
    }
    return id;
  };

  const addEdge = (p1: THREE.Vector3, p2: THREE.Vector3) => {
    const a = intern(p1);
    const b = intern(p2);
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ a, b });
  };

  const edgePoint = (va: THREE.Vector3, vb: THREE.Vector3, da: number, db: number) =>
    va.clone().addScaledVector(new THREE.Vector3().subVectors(vb, va), da / (da - db));

  const ON_EPS = 1e-7;

  /**
   * 按有符号距离把三角形顶点分为 负/零/正 三组,收集截面交线。
   * 注意:此回调必须始终返回 false —— three-mesh-bvh 的 shapecast 一旦收到
   * true 就会提前终止整棵树的遍历,导致只剩第一个命中三角形。
   */
  const intersects = (tri: ExtendedTriangle): boolean => {
    const verts = [tri.a, tri.b, tri.c];
    const dists = [
      localPlane.distanceToPoint(tri.a),
      localPlane.distanceToPoint(tri.b),
      localPlane.distanceToPoint(tri.c),
    ];
    const neg: number[] = [];
    const zero: number[] = [];
    const pos: number[] = [];
    for (let i = 0; i < 3; i++) {
      const d = dists[i];
      if (d < -ON_EPS) neg.push(i);
      else if (d > ON_EPS) pos.push(i);
      else zero.push(i);
    }

    // 三点同侧,不相交
    if (neg.length === 3 || pos.length === 3) return false;

    // 整面共面:输出三条边,缝合时重复边会被去重
    if (zero.length === 3) {
      addEdge(verts[0], verts[1]);
      addEdge(verts[1], verts[2]);
      addEdge(verts[2], verts[0]);
      return false;
    }

    // 一个顶点在面上:另外两点异侧时连一条交线
    if (zero.length === 1) {
      const z = zero[0];
      const others = [0, 1, 2].filter((i) => i !== z);
      if (neg.length === 1 && pos.length === 1) {
        addEdge(verts[z], edgePoint(verts[others[0]], verts[others[1]], dists[others[0]], dists[others[1]]));
      }
      return false;
    }

    // 两个顶点在面上:这两个顶点的连线就是交线
    if (zero.length === 2) {
      addEdge(verts[zero[0]], verts[zero[1]]);
      return false;
    }

    // 一般情况:一个顶点在一侧,另两个在另一侧 -> 两条跨面边各产生一个交点
    const lone = (neg.length === 1 ? neg : pos)[0];
    const cross: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      if (i === lone) continue;
      cross.push(edgePoint(verts[lone], verts[i], dists[lone], dists[i]));
    }
    addEdge(cross[0], cross[1]);
    return false;
  };

  bvh.shapecast({
    // 不能用 Plane.intersectsBox:它是保守测试,会在 BVH 层级上错误剪枝。
    // 用 AABB 沿法线的投影半径做精确判断,并加 1e-6 容差:
    // BVH 叶子可能是零厚度的面(如拉伸体的端面),浮点误差会把贴平面的盒子误剔除。
    // 注意临时向量必须在回调内创建——shapecast 遍历会重入,模块级共享变量会被覆盖。
    intersectsBounds: (box) => {
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      const r =
        0.5 *
          (Math.abs(size.x * localPlane.normal.x) +
            Math.abs(size.y * localPlane.normal.y) +
            Math.abs(size.z * localPlane.normal.z)) + 1e-6;
      return Math.abs(localPlane.distanceToPoint(center)) <= r;
    },
    intersectsTriangle: intersects,
  });

  // 交线变换回世界坐标
  for (const p of positions) p.applyMatrix4(mesh.matrixWorld);

  return stitchLoops(positions, edges, axis);
}

/** 把无序交线段缝合成有序闭合环(支持 T 形交叉等非流形情况) */
function stitchLoops(positions: THREE.Vector3[], edges: EdgeKey[], axis: AxisName): SectionLoop[] {
  const adjacency = new Map<number, number[]>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const { a, b } of edges) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }

  const remaining = new Set(edges.map((e) => edgeKey(e.a, e.b)));
  const loops: SectionLoop[] = [];
  const frame = PLANE_FRAMES[axis];

  while (remaining.size > 0) {
    const firstKey = remaining.values().next().value!;
    remaining.delete(firstKey);
    const [fa, fb] = firstKey.split('|').map(Number);
    const start = fa;
    const ordered: number[] = [fa];
    let prev = fa;
    let current = fb;

    while (current !== start) {
      ordered.push(current);
      const neighbors = adjacency.get(current);
      if (!neighbors) break;
      let next = -1;
      for (const cand of neighbors) {
        if (cand === prev) continue;
        const key = edgeKey(current, cand);
        if (remaining.has(key)) {
          next = cand;
          remaining.delete(key);
          break;
        }
      }
      if (next === -1) break; // 开口线段(理论上实体截面不会出现)
      prev = current;
      current = next;
    }

    if (ordered.length < 3) continue;
    const points = ordered.map((id) => positions[id]);
    const local2d = points.map(
      (p) =>
        [p.dot(frame.uDir), p.dot(frame.vDir)] as [number, number],
    );
    const signedArea = polygonSignedArea(local2d);
    loops.push({ points, local2d, signedArea });
  }

  return loops;
}

function polygonSignedArea(poly: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** 多构件截面环合并后用 earcut 三角化,生成截面填充几何 */
export function buildCapGeometry(
  loops: SectionLoop[],
  axis: AxisName,
  offset: number,
): THREE.BufferGeometry | null {
  if (loops.length === 0) return null;

  const data: number[] = [];
  const holeIndices: number[] = [];

  // earcut 要求外环在前、孔环在后
  const ordered = [...loops].sort((a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea));
  for (const loop of ordered) {
    if (loop.signedArea < 0) holeIndices.push(data.length / 2);
    for (const [u, v] of loop.local2d) data.push(u, v);
  }

  const indices = earcut(data, holeIndices.length ? holeIndices : undefined, 2);
  if (indices.length === 0) return null;

  const frame = frameFromNormal(axis, offset);
  const vertices: number[] = [];
  const seen = new Map<string, number>();
  const remap: number[] = new Array(data.length / 2);

  for (let i = 0; i < data.length / 2; i++) {
    const u = data[i * 2];
    const v = data[i * 2 + 1];
    const key = `${Math.round(u * KEY_EPS)}|${Math.round(v * KEY_EPS)}`;
    let id = seen.get(key);
    if (id === undefined) {
      const p = frame.origin
        .clone()
        .addScaledVector(frame.uDir, u)
        .addScaledVector(frame.vDir, v);
      id = vertices.length / 3;
      vertices.push(p.x, p.y, p.z);
      seen.set(key, id);
    }
    remap[i] = id;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices.map((i) => remap[i]));
  geometry.computeVertexNormals();
  geometry.computeBoundsTree();
  return geometry;
}

function frameFromNormal(axis: AxisName, offset: number) {
  const frame = PLANE_FRAMES[axis];
  return {
    origin: frame.normal.clone().multiplyScalar(offset),
    uDir: frame.uDir,
    vDir: frame.vDir,
  };
}

/** 世界点 -> 剖切面局部 2D */
export function worldToLocal2D(point: THREE.Vector3, axis: AxisName): [number, number] {
  const frame = PLANE_FRAMES[axis];
  return [point.dot(frame.uDir), point.dot(frame.vDir)];
}

/** 局部 2D -> 世界点(需要平面偏移) */
export function local2DToWorld(u: number, v: number, axis: AxisName, offset: number): THREE.Vector3 {
  const frame = PLANE_FRAMES[axis];
  return frame.normal
    .clone()
    .multiplyScalar(offset)
    .addScaledVector(frame.uDir, u)
    .addScaledVector(frame.vDir, v);
}

export interface NearestOnContour {
  local: [number, number];
  world: THREE.Vector3;
  /** 到轮廓的世界距离(米) */
  distance: number;
}

/** 在所有轮廓环上找距给定点最近的位置(点到线段) */
export function nearestPointOnContour(
  loops: SectionLoop[],
  worldPoint: THREE.Vector3,
  axis: AxisName,
  offset: number,
): NearestOnContour | null {
  if (loops.length === 0) return null;
  const [pu, pv] = worldToLocal2D(worldPoint, axis);
  let best: { local: [number, number]; distance: number } | null = null;

  for (const loop of loops) {
    const poly = loop.local2d;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 1e-12 ? ((pu - ax) * dx + (pv - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cu = ax + t * dx;
      const cv = ay + t * dy;
      const d = Math.hypot(cu - pu, cv - pv);
      if (!best || d < best.distance) best = { local: [cu, cv], distance: d };
    }
  }

  if (!best) return null;
  return {
    local: best.local,
    world: local2DToWorld(best.local[0], best.local[1], axis, offset),
    distance: best.distance,
  };
}

/** 平面方程工具:给定轴与偏移生成 THREE.Plane(法线朝 +轴) */
export function makePlane(axis: AxisName, offset: number): THREE.Plane {
  const frame = PLANE_FRAMES[axis];
  const plane = new THREE.Plane();
  plane.setFromNormalAndCoplanarPoint(
    frame.normal,
    frame.normal.clone().multiplyScalar(offset),
  );
  return plane;
}
