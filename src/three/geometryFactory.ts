// 程序化骨骼几何：每个模板生成一份共享 BufferGeometry 并预建 BVH
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import type { BoneTemplate, GeometryKind } from '../types';

// three-mesh-bvh 注入
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface SharedGeometry {
  geometry: THREE.BufferGeometry;
  /** 几何在关节局部空间中的包围盒（用于贴地最低点查询与拖拽拾取） */
  bbox: THREE.Box3;
}

const geoCache = new Map<string, SharedGeometry>();

function makeGeo(kind: GeometryKind, t: BoneTemplate): THREE.BufferGeometry {
  const { length: L, width: W, depth: D } = t.size;
  const off = new THREE.Vector3(...(t.geoOffset ?? [0, 0, 0]));
  const parts: THREE.BufferGeometry[] = [];

  const put = (g: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
    g.translate(off.x + x, off.y + y, off.z + z);
    parts.push(g);
  };

  const seg = (radial: number) => Math.max(5, radial);

  switch (kind) {
    case 'vertebra': {
      // 椎体（粗短圆柱，轴向 z）
      const body = new THREE.CylinderGeometry(W * 0.42, W * 0.48, L, seg(10));
      body.rotateX(Math.PI / 2);
      put(body);
      // 神经弓 + 神经棘（向上的扁片）
      const spine = new THREE.BoxGeometry(W * 0.28, D * 0.95, L * 0.5);
      put(spine, 0, D * 0.55, 0);
      // 横突（左右）
      const proc = new THREE.BoxGeometry(W * 1.5, W * 0.18, L * 0.35);
      put(proc, 0, W * 0.28, 0);
      // 前后关节突小球
      const cap1 = new THREE.SphereGeometry(W * 0.3, 8, 6);
      put(cap1, 0, 0, L * 0.5);
      const cap2 = cap1.clone();
      put(cap2, 0, 0, -L * 0.5);
      break;
    }
    case 'longbone': {
      // 骨干
      const shaft = new THREE.CylinderGeometry(W * 0.32, W * 0.4, L, seg(10));
      put(shaft);
      // 两端髁
      const capGeo = new THREE.SphereGeometry(W * 0.55, 10, 8);
      put(capGeo, 0, L * 0.5, 0);
      const capGeo2 = new THREE.SphereGeometry(W * 0.6, 10, 8);
      put(capGeo2, 0, -L * 0.5, 0);
      break;
    }
    case 'digit': {
      const shaft = new THREE.CylinderGeometry(W * 0.4, W * 0.5, L, seg(8));
      put(shaft);
      const tip = new THREE.SphereGeometry(W * 0.45, 8, 6);
      put(tip, 0, -L * 0.5, D * 0.15);
      break;
    }
    case 'rib': {
      // 弯曲细管：沿四分之一椭圆弧
      const pts: THREE.Vector3[] = [];
      const steps = 9;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 0.55;
        pts.push(
          new THREE.Vector3(
            Math.sin(a) * L * 0.62,
            -Math.cos(a) * L * 0.95 + L * 0.95 - L * 0.4,
            (i / steps) * L * 0.12,
          ),
        );
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.TubeGeometry(curve, 12, W, seg(6), false);
      put(tube);
      const head = new THREE.SphereGeometry(W * 1.6, 8, 6);
      put(head, 0, L * 0.55, 0);
      break;
    }
    case 'skull': {
      // 颅箱
      const cranium = new THREE.BoxGeometry(W * 0.8, D * 0.85, L * 0.55);
      put(cranium, 0, D * 0.15, -L * 0.18);
      // 吻部（楔状）
      const snout = new THREE.CylinderGeometry(W * 0.28, W * 0.42, L * 0.6, seg(8));
      snout.rotateX(Math.PI / 2);
      put(snout, 0, 0, L * 0.28);
      // 眼眶
      const orbit = new THREE.TorusGeometry(W * 0.22, W * 0.05, 6, 12);
      orbit.rotateY(Math.PI / 2);
      put(orbit, W * 0.42, D * 0.18, L * 0.02);
      const orbit2 = orbit.clone();
      put(orbit2, -W * 0.42, D * 0.18, L * 0.02);
      // 下颌支铰链球
      const hinge = new THREE.SphereGeometry(W * 0.16, 8, 6);
      put(hinge, 0, -D * 0.28, -L * 0.42);
      break;
    }
    case 'mandible': {
      const bar = new THREE.BoxGeometry(W * 0.9, D * 0.5, L * 0.85);
      put(bar, 0, 0, L * 0.1);
      const chin = new THREE.CylinderGeometry(W * 0.2, W * 0.3, L * 0.35, seg(8));
      chin.rotateX(Math.PI / 2);
      put(chin, 0, 0, L * 0.5);
      break;
    }
    case 'plate': {
      // 板状骨：扁盒 + 近端球头
      const plate = new THREE.BoxGeometry(D, W, L * 0.9);
      put(plate);
      const head = new THREE.SphereGeometry(W * 0.5, 9, 7);
      put(head, 0, -L * 0.45, 0);
      break;
    }
    case 'chevron': {
      // V 形：两根斜管
      const c1 = new THREE.CylinderGeometry(W * 0.22, W * 0.22, L, seg(6));
      c1.rotateZ(0.4);
      put(c1, W * 0.25, -L * 0.4, 0);
      const c2 = new THREE.CylinderGeometry(W * 0.22, W * 0.22, L, seg(6));
      c2.rotateZ(-0.4);
      put(c2, -W * 0.25, -L * 0.4, 0);
      const head = new THREE.SphereGeometry(W * 0.3, 7, 5);
      put(head);
      break;
    }
    case 'flat':
    default: {
      const flat = new THREE.BoxGeometry(L, W, D);
      put(flat);
      const cap = new THREE.SphereGeometry(W * 0.8, 7, 5);
      put(cap, L * 0.5, 0, 0);
      break;
    }
  }

  // 合并分段
  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  return merged;
}

/** BufferGeometryUtils.mergeGeometries 的本地轻量实现（避免额外依赖） */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geos) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  let vOff = 0;
  let iOff = 0;
  let base = 0;
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    positions.set(p.array as Float32Array, vOff * 3);
    if (n) normals.set(n.array as Float32Array, vOff * 3);
    if (g.index) {
      const idx = g.index.array as ArrayLike<number>;
      for (let i = 0; i < idx.length; i++) indices[iOff++] = idx[i] + base;
    } else {
      for (let i = 0; i < p.count; i++) indices[iOff++] = base + i;
    }
    base += p.count;
    vOff += p.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  return out;
}

/** 取模板共享几何（含 BVH），按模板 key 缓存 */
export function getSharedGeometry(template: BoneTemplate): SharedGeometry {
  const key = `${template.baseId}:${template.side}`;
  const cached = geoCache.get(key);
  if (cached) return cached;

  const geometry = makeGeo(template.kind, template);
  geometry.computeBoundsTree?.();
  geometry.computeBoundingBox();
  const shared: SharedGeometry = {
    geometry,
    bbox: geometry.boundingBox!.clone(),
  };
  geoCache.set(key, shared);
  return shared;
}

/** 模板包围盒在某世界矩阵下的最低点（贴地用，8 角点精确包围盒） */
export function bboxLowestWorld(
  bbox: THREE.Box3,
  matrixWorld: THREE.Matrix4,
): THREE.Vector3 {
  const corners: THREE.Vector3[] = [];
  const { min, max } = bbox;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        corners.push(new THREE.Vector3(x, y, z).applyMatrix4(matrixWorld));
      }
    }
  }
  corners.sort((a, b) => a.y - b.y);
  return corners[0];
}
