import { SANDBOX_SIZE } from '../constants'
import type { XY } from '../types'

/**
 * 程序化沙盘地形高度(米)。
 * 由低频正弦起伏 + 两座高斯山丘 + 一处低洼盆地组成,确定性、无外部 DEM 依赖。
 */
export function terrainHeight(x: number, y: number): number {
  const s = SANDBOX_SIZE
  const nx = x / s
  const ny = y / s

  const waves =
    14 * Math.sin(nx * Math.PI * 2.2 + 0.7) * Math.cos(ny * Math.PI * 1.7 - 0.4) +
    8 * Math.sin((nx + ny) * Math.PI * 3.1 + 1.3)

  const hill1 = 42 * Math.exp(-(((nx - 0.72) ** 2) / 0.025 + ((ny - 0.28) ** 2) / 0.04))
  const hill2 = 26 * Math.exp(-(((nx - 0.24) ** 2) / 0.05 + ((ny - 0.74) ** 2) / 0.03))
  const basin = -16 * Math.exp(-(((nx - 0.52) ** 2) / 0.06 + ((ny - 0.5) ** 2) / 0.08))

  return waves + hill1 + hill2 + basin
}

/** 中心差分近似地形法线 */
export function terrainNormal(x: number, y: number): [number, number, number] {
  const e = 2
  const hx = (terrainHeight(x + e, y) - terrainHeight(x - e, y)) / (2 * e)
  const hy = (terrainHeight(x, y + e) - terrainHeight(x, y - e)) / (2 * e)
  // 高度图 z = h(x,y),法线 = normalize(-dh/dx, -dh/dy, 1)
  const len = Math.hypot(hx, hy, 1)
  return [-hx / len, -hy / len, 1 / len]
}

export function dist(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 角度归一化到 [0,360) */
export function normAngle(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * 将角度约束到最近的合法方向。
 * 约束轴为 constraint 度,合法方向为该轴及其反向(±180°),
 * 间距 180°;若当前偏差已在容差内则保持原角度。
 */
export function snapAngle(rawDeg: number, constraint: number, tolerance: number): number {
  const raw = normAngle(rawDeg)
  const c = normAngle(constraint)
  // 候选:约束轴、约束轴+180
  const candidates = [c, normAngle(c + 180)]
  let best = raw
  let bestDelta = Infinity
  for (const cand of candidates) {
    let d = Math.abs(raw - cand)
    if (d > 180) d = 360 - d
    if (d < bestDelta) {
      bestDelta = d
      best = cand
    }
  }
  return bestDelta <= tolerance ? raw : best
}

/**
 * 拖动节点时做角度吸附:从锚点 anchor 出发,把目标点 p 投影到
 * 最近的合法射线上(保持原距离)。
 */
export function snapPointToConstraint(
  anchor: XY,
  p: XY,
  constraint: number,
  tolerance: number
): XY {
  const dx = p.x - anchor.x
  const dy = p.y - anchor.y
  const r = Math.hypot(dx, dy)
  if (r < 1e-6) return p
  const raw = (Math.atan2(dy, dx) * 180) / Math.PI
  const snapped = snapAngle(raw, constraint, tolerance)
  const rad = (snapped * Math.PI) / 180
  return { x: anchor.x + Math.cos(rad) * r, y: anchor.y + Math.sin(rad) * r }
}

export function pointSegDistance(p: XY, a: XY, b: XY): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  if (l2 < 1e-9) return dist(p, a)
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2
  t = clamp(t, 0, 1)
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}
