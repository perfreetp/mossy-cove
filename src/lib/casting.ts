import * as THREE from 'three';
import type { CastingConfig, HotSpot, Vec3 } from './types';
import { clamp, distance, uid } from './geometry';

export interface CastingGeometry {
  group: THREE.Group;
  /** 可被射线拾取的铸件表面（用于放置冒口/内浇口） */
  pickMeshes: THREE.Mesh[];
  hotspots: HotSpot[];
  /** 给定 x,z 处铸件顶面高度， footprint 外返回 null */
  topHeightAt: (x: number, z: number) => number | null;
  /** 把位置约束到铸件顶面， footprint 外返回 null */
  clampToTop: (p: Vec3) => Vec3 | null;
}

const HALF = (n: number) => n / 2;

/** 生成铸件三维模型（底部位于 y=0，x/z 居中）与热节 */
export function createCasting(config: CastingConfig): CastingGeometry {
  const group = new THREE.Group();
  group.name = 'casting';
  const pickMeshes: THREE.Mesh[] = [];

  const material = new THREE.MeshStandardMaterial({
    color: 0x607d8b,
    transparent: true,
    opacity: 0.55,
    roughness: 0.85,
    metalness: 0.15,
    depthWrite: false
  });

  const addBox = (w: number, h: number, d: number, cx: number, cy: number, cz: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(cx, cy, cz);
    group.add(mesh);
    pickMeshes.push(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x263238 })
    );
    edges.position.copy(mesh.position);
    group.add(edges);
    return mesh;
  };

  let topHeightAt: (x: number, z: number) => number | null;
  let clampToTop: (p: Vec3) => Vec3 | null;

  if (config.shape === 'box') {
    addBox(config.length, config.height, config.width, 0, config.height / 2, 0);
    topHeightAt = (x, z) =>
      Math.abs(x) <= HALF(config.length) && Math.abs(z) <= HALF(config.width)
        ? config.height
        : null;
    clampToTop = (p) => {
      const y = topHeightAt(p.x, p.z);
      return y === null ? null : { ...p, y };
    };
  } else if (config.shape === 'stepped') {
    const lowerH = config.height * 0.6;
    const upperH = config.height - lowerH;
    const upperL = config.length * 0.6;
    const upperW = config.width * 0.6;
    addBox(config.length, lowerH, config.width, 0, lowerH / 2, 0);
    addBox(upperL, upperH, upperW, 0, lowerH + upperH / 2, 0);
    topHeightAt = (x, z) => {
      if (Math.abs(x) <= HALF(upperL) && Math.abs(z) <= HALF(upperW)) return config.height;
      if (Math.abs(x) <= HALF(config.length) && Math.abs(z) <= HALF(config.width)) return lowerH;
      return null;
    };
    clampToTop = (p) => {
      const y = topHeightAt(p.x, p.z);
      return y === null ? null : { ...p, y };
    };
  } else {
    const radius = Math.min(config.length, config.width) / 2;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, config.height, 48),
      material
    );
    mesh.position.set(0, config.height / 2, 0);
    group.add(mesh);
    pickMeshes.push(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 20),
      new THREE.LineBasicMaterial({ color: 0x263238 })
    );
    edges.position.copy(mesh.position);
    group.add(edges);
    topHeightAt = (x, z) => (x * x + z * z <= radius * radius ? config.height : null);
    clampToTop = (p) => {
      const y = topHeightAt(p.x, p.z);
      return y === null ? null : { ...p, y };
    };
  }

  return { group, pickMeshes, hotspots: buildHotspots(config), topHeightAt, clampToTop };
}

/** 按铸件形状生成典型热节（厚大截面），导出供状态仓库在无渲染层时使用 */
export function buildHotspots(config: CastingConfig): HotSpot[] {
  const spots: HotSpot[] = [];
  const r = Math.min(config.length, config.width, config.height) * 0.14;

  if (config.shape === 'cylinder') {
    const radius = Math.min(config.length, config.width) / 2;
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      spots.push({
        id: uid('hs'),
        label: `热节 ${i + 1}`,
        radius: r,
        position: {
          x: Math.cos(angle) * radius * 0.55,
          y: config.height * 0.5,
          z: Math.sin(angle) * radius * 0.55
        }
      });
    }
    return spots;
  }

  const xs = config.shape === 'stepped' ? [-0.36, 0.36] : [-0.32, 0.32];
  const zs = [-0.3, 0.3];
  let n = 0;
  for (const fx of xs) {
    for (const fz of zs) {
      n += 1;
      spots.push({
        id: uid('hs'),
        label: `热节 ${n}`,
        radius: r,
        position: {
          x: fx * config.length,
          y: config.height * 0.55,
          z: fz * config.width
        }
      });
    }
  }
  return spots;
}

/** 重新计算冒口与最近热节的连接距离 */
export function linkRiserToHotspot(
  riserPos: Vec3,
  hotspots: HotSpot[]
): { linkedHotSpotId: string | null; distance: number | null } {
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const hs of hotspots) {
    const d = distance(riserPos, hs.position) - hs.radius;
    if (d < bestDist) {
      bestDist = d;
      bestId = hs.id;
    }
  }
  if (bestId === null) return { linkedHotSpotId: null, distance: null };
  return { linkedHotSpotId: bestId, distance: Math.max(0, bestDist) };
}

/** 限制拖动位置在合理空间内 */
export function clampWorkspace(p: Vec3, config: CastingConfig): Vec3 {
  const span = Math.max(config.length, config.width) * 1.6;
  return {
    x: clamp(p.x, -span, span),
    y: clamp(p.y, 0, config.height + 320),
    z: clamp(p.z, -span, span)
  };
}
