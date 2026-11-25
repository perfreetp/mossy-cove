import * as THREE from 'three';

/** 判定容差（模型空间距离量级，适配 Float32 精度） */
export const CLIP_EPS = 1e-4;

export interface ClipResult {
  geometry: THREE.BufferGeometry;
  /** 本次刀平面新切出的环上的顶点 id（用于标记 fresh loop） */
  cutVertexIds: number[];
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/**
 * 用无限平面刀对 indexed 三角网格做布尔裁剪。
 * 保留 plane 法向一侧（distanceToPoint >= -eps）的部分，被切到的三角形沿
 * 平面分裂，交点焊接并标记 aCap=1（供断面识别/补洞/微调使用）。
 *
 * 借助 three-mesh-bvh 的 shapecast 只对与平面 AABB 相交的子树做精确求交，
 * 几千～几万三角面下可在单帧内完成（拖动实时重算）。
 */
export function clipMeshByPlane(
  source: THREE.BufferGeometry,
  plane: THREE.Plane,
): ClipResult {
  if (!source.index) {
    throw new Error('clipMeshByPlane 要求 indexed geometry');
  }

  const srcIndex = source.index;
  const srcPos = source.getAttribute('position') as THREE.BufferAttribute;
  const srcCapAttr = source.getAttribute('aCap') as THREE.BufferAttribute | undefined;

  const triCount = srcIndex.count / 3;
  const candidate = new Uint8Array(triCount);
  // 源三角形是否属于断面 group（materialIndex=1），裁剪后保持断面身份
  const triIsCap = new Uint8Array(triCount);
  for (const g of source.groups) {
    if (g.materialIndex === 1) {
      for (let i = g.start; i < g.start + g.count; i += 3) triIsCap[i / 3] = 1;
    }
  }

  // ---- 1. BVH 粗筛：收集包围盒与平面相交的三角形 ---------------------------
  if (source.boundsTree) {
    source.boundsTree.shapecast({
      intersectsBounds: (box) => plane.intersectsBox(box),
      intersectsTriangle: (_t, triIndex) => {
        candidate[triIndex] = 1;
        return false;
      },
    });
  } else {
    // 无 BVH 时退化为全量精确检测
    for (let i = 0; i < triCount; i++) candidate[i] = 1;
  }

  // ---- 2. 输出缓冲 ----------------------------------------------------------
  const outPos: number[] = [];
  const outCap: number[] = [];
  const outIdx: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];

  const vertMap = new Map<number, number>(); // 源顶点 -> 输出顶点
  const intersectCache = new Map<string, number>(); // 源边 -> 交点输出顶点
  const cutVertexIds: number[] = [];

  const emitVertex = (srcId: number): number => {
    const hit = vertMap.get(srcId);
    if (hit !== undefined) return hit;
    const id = outPos.length / 3;
    const x = srcPos.getX(srcId);
    const y = srcPos.getY(srcId);
    const z = srcPos.getZ(srcId);
    outPos.push(x, y, z);
    // 恰好落在刀平面上的源顶点（如模型赤道点）同样标记为断面候选
    const onPlane = Math.abs(plane.normal.x * x + plane.normal.y * y + plane.normal.z * z + plane.constant) <= CLIP_EPS;
    const srcCap = srcCapAttr ? srcCapAttr.getX(srcId) : 0;
    outCap.push(onPlane ? 1 : srcCap);
    vertMap.set(srcId, id);
    return id;
  };

  const emitIntersection = (a: number, b: number, da: number, db: number): number => {
    const key = edgeKey(a, b);
    const hit = intersectCache.get(key);
    if (hit !== undefined) return hit;
    const t = da / (da - db); // da 与 db 异号
    // 退化情形：交点与端点重合（相切，da≈0 或 db≈0）。直接复用源顶点，
    // 不生成重复顶点——否则边界环上会出现度数 1 的悬点
    if (Math.abs(t) < CLIP_EPS) {
      const id = emitVertex(a);
      intersectCache.set(key, id);
      return id;
    }
    if (Math.abs(t - 1) < CLIP_EPS) {
      const id = emitVertex(b);
      intersectCache.set(key, id);
      return id;
    }
    const id = outPos.length / 3;
    outPos.push(
      THREE.MathUtils.lerp(srcPos.getX(a), srcPos.getX(b), t),
      THREE.MathUtils.lerp(srcPos.getY(a), srcPos.getY(b), t),
      THREE.MathUtils.lerp(srcPos.getZ(a), srcPos.getZ(b), t),
    );
    outCap.push(1); // 刀平面交点 => 断面候选顶点
    intersectCache.set(key, id);
    cutVertexIds.push(id);
    return id;
  };

  const pushTri = (a: number, b: number, c: number, isCap: boolean) => {
    const start = outIdx.length;
    outIdx.push(a, b, c);
    const last = groups[groups.length - 1];
    const mat = isCap ? 1 : 0;
    if (last && last.materialIndex === mat && last.start + last.count === start) {
      last.count += 3;
    } else {
      groups.push({ start, count: 3, materialIndex: mat });
    }
  };

  const distances = [0, 0, 0];
  const v = new THREE.Vector3();

  for (let ti = 0; ti < triCount; ti++) {
    const i0 = srcIndex.getX(ti * 3);
    const i1 = srcIndex.getX(ti * 3 + 1);
    const i2 = srcIndex.getX(ti * 3 + 2);
    const ids = [i0, i1, i2];

    let d0 = plane.distanceToPoint(v.set(srcPos.getX(i0), srcPos.getY(i0), srcPos.getZ(i0)));
    let d1 = plane.distanceToPoint(v.set(srcPos.getX(i1), srcPos.getY(i1), srcPos.getZ(i1)));
    let d2 = plane.distanceToPoint(v.set(srcPos.getX(i2), srcPos.getY(i2), srcPos.getZ(i2)));
    // 近零距离钳制为 0：同一源顶点在所有相邻三角形中分类保持一致，
    // 避免相切处一个三角形判 inside、另一个产生交点，从而产生悬边
    if (Math.abs(d0) < CLIP_EPS) d0 = 0;
    if (Math.abs(d1) < CLIP_EPS) d1 = 0;
    if (Math.abs(d2) < CLIP_EPS) d2 = 0;

    if (!candidate[ti]) {
      // 包围盒不与平面相交 => 整三角形在同侧
      if (d0 >= -CLIP_EPS) {
        pushTri(emitVertex(i0), emitVertex(i1), emitVertex(i2), triIsCap[ti] === 1);
      }
      continue;
    }

    distances[0] = d0;
    distances[1] = d1;
    distances[2] = d2;
    const inside = distances.map((d) => d >= -CLIP_EPS);
    const nInside = inside.filter(Boolean).length;

    if (nInside === 3) {
      pushTri(emitVertex(i0), emitVertex(i1), emitVertex(i2), triIsCap[ti] === 1);
      continue;
    }
    if (nInside === 0) continue;

    // 规整：让 inside 顶点排在前面
    const order = [0, 1, 2].sort((a, b) => Number(inside[b]) - Number(inside[a]));
    const s0 = ids[order[0]];
    const s1 = ids[order[1]];
    const s2 = ids[order[2]];
    d0 = distances[order[0]];
    d1 = distances[order[1]];
    d2 = distances[order[2]];

    if (nInside === 1) {
      // A 在内，B、C 在外：三角形 A-R(AB)-Q(AC)
      const A = emitVertex(s0);
      const R = emitIntersection(s0, s1, d0, d1);
      const Q = emitIntersection(s0, s2, d0, d2);
      pushTri(A, R, Q, triIsCap[ti] === 1);
    } else {
      // A、B 在内，C 在外：四边形 A-B-Q(BC)-R(CA) => (A,B,Q) + (A,Q,R)
      const A = emitVertex(s0);
      const B = emitVertex(s1);
      const Q = emitIntersection(s1, s2, d1, d2);
      const R = emitIntersection(s2, s0, d2, d0);
      pushTri(A, B, Q, triIsCap[ti] === 1);
      pushTri(A, Q, R, triIsCap[ti] === 1);
    }
  }

  if (outIdx.length === 0) {
    // 全部被裁掉：返回空几何，由上层阻止该操作
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('aCap', new THREE.Float32BufferAttribute([], 1));
    empty.setIndex([]);
    return { geometry: empty, cutVertexIds: [] };
  }

  // ---- 3. 切割点精确焊接 ---------------------------------------------------
  // 相切情形下，同一几何点可能同时以"赤道源顶点"和"退化交点"两个副本存在
  // （坐标差 ~1e-16）。只在刀平面切割点之间、用远小于边长的容差合并，
  // 既消除边界环上的度数 1 悬点，又绝不会误焊相邻但不同的交点。
  const WELD_TOL2 = 1e-7 * 1e-7;
  const remap = new Array(outPos.length / 3).fill(-1);
  const cutIdList: number[] = [];
  for (let i = 0; i < outCap.length; i++) {
    if (outCap[i] > 0.5) {
      remap[i] = i;
      cutIdList.push(i);
    }
  }
  // 刀平面二维基，把三维近重合判定降为平面网格哈希
  const weldU = new THREE.Vector3();
  if (Math.abs(plane.normal.y) < 0.9) weldU.set(0, 1, 0);
  else weldU.set(1, 0, 0);
  weldU.cross(plane.normal).normalize();
  const weldV = new THREE.Vector3().crossVectors(plane.normal, weldU).normalize();
  const cell = 1e-7;
  const buckets = new Map<string, number[]>();
  const cellKey = (id: number) => {
    const x = outPos[id * 3] * weldU.x + outPos[id * 3 + 1] * weldU.y + outPos[id * 3 + 2] * weldU.z;
    const y = outPos[id * 3] * weldV.x + outPos[id * 3 + 1] * weldV.y + outPos[id * 3 + 2] * weldV.z;
    return `${Math.floor(x / cell)}_${Math.floor(y / cell)}`;
  };
  for (const id of cutIdList) {
    const key = cellKey(id);
    const [cxStr, cyStr] = key.split('_');
    const cx = Number(cxStr);
    const cy = Number(cyStr);
    // 搜索当前桶及相邻 8 个桶，覆盖取整边界两侧的近重合点
    let found = -1;
    for (let ox = -1; ox <= 1 && found < 0; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = buckets.get(`${cx + ox}_${cy + oy}`);
        if (!bucket) continue;
        for (const cand of bucket) {
          const dx = outPos[id * 3] - outPos[cand * 3];
          const dy = outPos[id * 3 + 1] - outPos[cand * 3 + 1];
          const dz = outPos[id * 3 + 2] - outPos[cand * 3 + 2];
          if (dx * dx + dy * dy + dz * dz < WELD_TOL2) {
            found = cand;
            break;
          }
        }
        if (found >= 0) break;
      }
    }
    if (found >= 0) {
      remap[id] = remap[found];
    } else {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(id);
      else buckets.set(key, [id]);
    }
  }
  const finalIdx = outIdx.map((vx) => (remap[vx] >= 0 ? remap[vx] : vx));

  // 焊接可能让个别三角形的两个顶点重合（退化三角形），剔除它们，
  // 否则这些零面积三角形会污染边界边计数。同步记录保留三角形的材质归属。
  const matOfTri = new Uint8Array(outIdx.length / 3);
  for (const g of groups) {
    for (let i = g.start; i < g.start + g.count; i += 3) {
      matOfTri[i / 3] = g.materialIndex;
    }
  }
  const cleanedIdx: number[] = [];
  const cleanedMat: number[] = [];
  for (let i = 0; i < finalIdx.length; i += 3) {
    const a = finalIdx[i];
    const b = finalIdx[i + 1];
    const c = finalIdx[i + 2];
    if (a !== b && b !== c && c !== a) {
      cleanedIdx.push(a, b, c);
      cleanedMat.push(matOfTri[i / 3]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  geometry.setAttribute('aCap', new THREE.Float32BufferAttribute(outCap, 1));
  geometry.setIndex(cleanedIdx);
  // 按剔除后的连续索引重建材质 group
  let runStart = 0;
  for (let i = 1; i <= cleanedMat.length; i++) {
    if (i === cleanedMat.length || cleanedMat[i] !== cleanedMat[runStart]) {
      geometry.addGroup(runStart * 3, (i - runStart) * 3, cleanedMat[runStart]);
      runStart = i;
    }
  }
  geometry.computeVertexNormals();
  geometry.computeBoundsTree();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return { geometry, cutVertexIds };
}
