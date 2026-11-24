import * as THREE from 'three';
import type { IceBlock, Light } from '../state/types';

/** 场景房间尺寸:地面 y=0,四墙 x/z = ±ROOM,墙高 WALL_H */
export const ROOM = 14;
export const WALL_H = 6;

export interface SpotResult {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** 光斑半径(米) */
  radius: number;
  /** 衰减后的有效强度 */
  intensity: number;
  /** 光斑中心到冰体的距离(米) */
  distanceToIce: number;
  /** 透射总衰减系数 0..1 */
  attenuation: number;
  /** 光线穿过冰体的总厚度(米) */
  totalThickness: number;
}

export interface LightPathResult {
  lightId: string;
  kelvin: number;
  softness: number;
  /** 透射折线:灯 → 各入射/出射点 → 光斑 */
  points: THREE.Vector3[];
  dir: THREE.Vector3;
  spot: SpotResult | null;
}

/** 由方位角/俯仰角求光线方向单位向量 */
export function lightDirection(l: Pick<Light, 'azimuth' | 'elevation'>): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(l.azimuth);
  const el = THREE.MathUtils.degToRad(l.elevation);
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  ).normalize();
}

interface Interval {
  t0: number;
  t1: number;
  block: IceBlock;
}

/** 射线与单个冰体(绕 Y 旋转的长方体)求交,返回进入/离开参数 t */
function rayBlock(origin: THREE.Vector3, dir: THREE.Vector3, b: IceBlock): Interval | null {
  const cos = Math.cos(-b.rotationY);
  const sin = Math.sin(-b.rotationY);
  const px = origin.x - b.position[0];
  const pz = origin.z - b.position[2];
  // 变换到冰体局部坐标系
  const ox = px * cos - pz * sin;
  const oz = px * sin + pz * cos;
  const oy = origin.y - b.position[1];
  const dx = dir.x * cos - dir.z * sin;
  const dz = dir.x * sin + dir.z * cos;
  const dy = dir.y;
  const hx = b.size[0] / 2;
  const hy = b.size[1] / 2;
  const hz = b.size[2] / 2;

  let tmin = -Infinity;
  let tmax = Infinity;
  const axes: Array<[number, number, number]> = [
    [ox, dx, hx],
    [oy, dy, hy],
    [oz, dz, hz],
  ];
  for (const [o, d, h] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(o) > h) return null;
    } else {
      let t1 = (-h - o) / d;
      let t2 = (h - o) / d;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax <= 0) return null;
  return { t0: tmin, t1: tmax, block: b };
}

/** 射线与房间(地面 + 四墙)求交,返回最近命中 */
function rayRoom(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  tMin: number,
): { t: number; point: THREE.Vector3; normal: THREE.Vector3 } | null {
  let best: { t: number; normal: THREE.Vector3 } | null = null;
  const consider = (t: number, normal: THREE.Vector3) => {
    if (t <= tMin + 1e-4) return;
    if (best && t >= best.t) return;
    const p = origin.clone().addScaledVector(dir, t);
    if (p.x < -ROOM - 1e-3 || p.x > ROOM + 1e-3) return;
    if (p.z < -ROOM - 1e-3 || p.z > ROOM + 1e-3) return;
    if (p.y < -1e-3 || p.y > WALL_H + 1e-3) return;
    best = { t, normal };
  };
  // 地面 y = 0
  if (dir.y < -1e-9) consider(-origin.y / dir.y, new THREE.Vector3(0, 1, 0));
  // 四墙
  if (dir.x > 1e-9) consider((ROOM - origin.x) / dir.x, new THREE.Vector3(-1, 0, 0));
  if (dir.x < -1e-9) consider((-ROOM - origin.x) / dir.x, new THREE.Vector3(1, 0, 0));
  if (dir.z > 1e-9) consider((ROOM - origin.z) / dir.z, new THREE.Vector3(0, 0, -1));
  if (dir.z < -1e-9) consider((-ROOM - origin.z) / dir.z, new THREE.Vector3(0, 0, 1));
  if (!best) return null;
  const b = best as { t: number; normal: THREE.Vector3 };
  return { t: b.t, point: origin.clone().addScaledVector(dir, b.t), normal: b.normal };
}

/** 点到冰体表面的最近距离 */
function pointToBlockDistance(p: THREE.Vector3, b: IceBlock): number {
  const cos = Math.cos(-b.rotationY);
  const sin = Math.sin(-b.rotationY);
  const px = p.x - b.position[0];
  const pz = p.z - b.position[2];
  const lx = px * cos - pz * sin;
  const lz = px * sin + pz * cos;
  const ly = p.y - b.position[1];
  const dx = Math.max(Math.abs(lx) - b.size[0] / 2, 0);
  const dy = Math.max(Math.abs(ly) - b.size[1] / 2, 0);
  const dz = Math.max(Math.abs(lz) - b.size[2] / 2, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 灯到首个冰体表面的命中(用于"离冰面距离"调节) */
export function firstIceHit(
  light: Pick<Light, 'position' | 'azimuth' | 'elevation'>,
  blocks: IceBlock[],
): { t: number; point: THREE.Vector3 } | null {
  const origin = new THREE.Vector3(...light.position);
  const dir = lightDirection(light);
  let bestT = Infinity;
  for (const b of blocks) {
    const iv = rayBlock(origin, dir, b);
    if (!iv) continue;
    const t = iv.t0 > 1e-4 ? iv.t0 : iv.t1 > 1e-4 ? 0 : Infinity;
    if (t < bestT) bestT = t;
  }
  if (!isFinite(bestT)) return null;
  return { t: bestT, point: origin.addScaledVector(dir, bestT) };
}

/** 计算单盏灯的透射路径与光斑 */
export function computeLightPath(light: Light, blocks: IceBlock[]): LightPathResult {
  const origin = new THREE.Vector3(...light.position);
  const dir = lightDirection(light);
  const intervals = blocks
    .map((b) => rayBlock(origin, dir, b))
    .filter((i): i is Interval => i !== null && i.t1 > 1e-4)
    .sort((a, b) => a.t0 - b.t0);

  const points: THREE.Vector3[] = [origin.clone()];
  let attenuation = 1;
  let totalThickness = 0;
  let cursor = 0;
  let lastExitT = 0;
  let lastTurbidity = 0;

  for (const iv of intervals) {
    const exit = iv.t1;
    if (exit <= cursor) continue;
    const enter = Math.max(iv.t0, cursor, 0);
    const len = exit - enter;
    if (len > 0) {
      // 衰减系数:基础 0.15,浑浊度最高贡献 2.5 /米
      const sigma = 0.15 + iv.block.turbidity * 2.5;
      attenuation *= Math.exp(-sigma * len);
      totalThickness += len;
      lastTurbidity = iv.block.turbidity;
    }
    if (enter > 1e-4) points.push(origin.clone().addScaledVector(dir, enter));
    points.push(origin.clone().addScaledVector(dir, exit));
    cursor = exit;
    lastExitT = exit;
  }

  const hit = rayRoom(origin, dir, Math.max(cursor, 1e-4));
  let spot: SpotResult | null = null;
  if (hit) {
    points.push(hit.point.clone());
    const travelAfterIce = Math.max(hit.t - lastExitT, 0);
    // 扩散角:灯具扩散 + 冰体散射(厚度与浑浊度)
    const spreadAngle =
      0.05 + light.spread * 0.45 + lastTurbidity * 0.12 + totalThickness * 0.04;
    const incidence = Math.max(0.35, Math.abs(dir.dot(hit.normal)));
    const radius = Math.max(0.12, (0.15 + travelAfterIce * spreadAngle) / incidence);
    const distanceFalloff = 1 / (1 + 0.04 * hit.t * hit.t);
    const intensity = light.intensity * attenuation * distanceFalloff;
    const distanceToIce =
      lastExitT > 0
        ? hit.t - lastExitT
        : blocks.length
          ? Math.min(...blocks.map((b) => pointToBlockDistance(hit.point, b)))
          : 0;
    spot = {
      point: hit.point,
      normal: hit.normal,
      radius,
      intensity,
      distanceToIce,
      attenuation,
      totalThickness,
    };
  }

  return {
    lightId: light.id,
    kelvin: light.kelvin,
    softness: light.softness,
    points,
    dir,
    spot,
  };
}

export function computeAllPaths(doc: { lights: Light[]; iceBlocks: IceBlock[] }): LightPathResult[] {
  return doc.lights.map((l) => computeLightPath(l, doc.iceBlocks));
}
