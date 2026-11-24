import { M_PER_DEG_LAT, ORIGIN_LAT, ORIGIN_LNG, SANDBOX_SIZE } from '../constants'
import { terrainHeight } from './terrain'
import type { Mat4 } from './mat4'
import { mat4Invert, transformVec4 } from './mat4'
import type { XY } from '../types'

const COS_LAT = Math.cos((ORIGIN_LAT * Math.PI) / 180)

/** 沙盘本地米坐标 → 经纬度 */
export function localToLngLat(x: number, y: number): { lng: number; lat: number } {
  return {
    lng: ORIGIN_LNG + x / (M_PER_DEG_LAT * COS_LAT),
    lat: ORIGIN_LAT + y / M_PER_DEG_LAT
  }
}

type Projector = (p: { lng: number; lat: number; z?: number }) => { x: number; y: number }

/** 本地坐标(含地形高程)→ 屏幕像素。运行时 project 支持高程,公开类型未声明 */
export function project3d(
  map: { project: unknown },
  x: number,
  y: number,
  z = 0
): { x: number; y: number } {
  const ll = localToLngLat(x, y)
  return (map.project as Projector)({ lng: ll.lng, lat: ll.lat, z })
}

/** 经纬度 → 沙盘本地米坐标 */
export function lngLatToLocal(lng: number, lat: number): XY {
  return {
    x: (lng - ORIGIN_LNG) * M_PER_DEG_LAT * COS_LAT,
    y: (lat - ORIGIN_LAT) * M_PER_DEG_LAT
  }
}

interface Tri {
  ax: number; ay: number; az: number
  bx: number; by: number; bz: number
  cx: number; cy: number; cz: number
}

/** 粗粒度拾取网格(独立于渲染网格,40x40 足够点击精度) */
function buildPickingGrid(segments = 40): Tri[] {
  const tris: Tri[] = []
  const step = SANDBOX_SIZE / segments
  const v = (i: number, j: number) => {
    const x = i * step
    const y = j * step
    return [x, y, terrainHeight(x, y)] as const
  }
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const p00 = v(i, j)
      const p10 = v(i + 1, j)
      const p01 = v(i, j + 1)
      const p11 = v(i + 1, j + 1)
      tris.push(
        { ax: p00[0], ay: p00[1], az: p00[2], bx: p01[0], by: p01[1], bz: p01[2], cx: p10[0], cy: p10[1], cz: p10[2] },
        { ax: p10[0], ay: p10[1], az: p10[2], bx: p01[0], by: p01[1], bz: p01[2], cx: p11[0], cy: p11[1], cz: p11[2] }
      )
    }
  }
  return tris
}

const PICK_TRIS = buildPickingGrid()

function rayTri(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  t: Tri
): number | null {
  const e1x = t.bx - t.ax, e1y = t.by - t.ay, e1z = t.bz - t.az
  const e2x = t.cx - t.ax, e2y = t.cy - t.ay, e2z = t.cz - t.az
  const hx = dy * e2z - dz * e2y
  const hy = dz * e2x - dx * e2z
  const hz = dx * e2y - dy * e2x
  const det = e1x * hx + e1y * hy + e1z * hz
  if (Math.abs(det) < 1e-9) return null
  const inv = 1 / det
  const sx = ox - t.ax, sy = oy - t.ay, sz = oz - t.az
  const u = (sx * hx + sy * hy + sz * hz) * inv
  if (u < 0 || u > 1) return null
  const qx = sy * e1z - sz * e1y
  const qy = sz * e1x - sx * e1z
  const qz = sx * e1y - sy * e1x
  const vv = (dx * qx + dy * qy + dz * qz) * inv
  if (vv < 0 || u + vv > 1) return null
  const hit = (e2x * qx + e2y * qy + e2z * qz) * inv
  return hit >= 0 ? hit : null
}

export interface PickResult {
  x: number
  y: number
  z: number
}

/**
 * 屏幕像素 → 沙盘本地地形交点。
 * invMVP 为 mapLibre 投影矩阵 × 本地模型矩阵 的逆。
 */
export function pickTerrain(
  invMVP: Mat4,
  px: number,
  py: number,
  width: number,
  height: number
): PickResult | null {
  const ndcX = (px / width) * 2 - 1
  const ndcY = 1 - (py / height) * 2

  const near = transformVec4(invMVP, ndcX, ndcY, -1, 1)
  const far = transformVec4(invMVP, ndcX, ndcY, 1, 1)
  if (Math.abs(near[3]) < 1e-9 || Math.abs(far[3]) < 1e-9) return null
  const ox = near[0] / near[3], oy = near[1] / near[3], oz = near[2] / near[3]
  const fx = far[0] / far[3], fy = far[1] / far[3], fz = far[2] / far[3]
  let dx = fx - ox, dy = fy - oy, dz = fz - oz
  const dl = Math.hypot(dx, dy, dz) || 1
  dx /= dl; dy /= dl; dz /= dl

  let best: number | null = null
  for (const tri of PICK_TRIS) {
    // 粗筛:射线起点到三角形 AABB 的快速距离判断
    const t = rayTri(ox, oy, oz, dx, dy, dz, tri)
    if (t !== null && (best === null || t < best)) best = t
  }
  if (best === null) return null
  return { x: ox + dx * best, y: oy + dy * best, z: oz + dz * best }
}

export function invertMVP(mvp: Mat4): Mat4 | null {
  return mat4Invert(mvp)
}
