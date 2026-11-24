import type { Building, Street, Vec2 } from '../types'

export const TAU = Math.PI * 2

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function snapToGrid(value: number, grid = 0.5): number {
  if (grid <= 0) return value
  return Math.round(value / grid) * grid
}

export function snapVec2ToGrid(p: Vec2, grid = 0.5): Vec2 {
  return { x: snapToGrid(p.x, grid), z: snapToGrid(p.z, grid) }
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

export function snapRotationToStep(rotation: number, stepDeg = 15): number {
  const step = degToRad(stepDeg)
  return Math.round(rotation / step) * step
}

export function normalizeAngle(angle: number): number {
  let a = angle % TAU
  if (a < -Math.PI) a += TAU
  if (a > Math.PI) a -= TAU
  return a
}

export function angleDistance(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b))
}

export interface AxisBasis {
  right: Vec2
  forward: Vec2
}

export function yawBasis(yaw: number): AxisBasis {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  // Matches Babylon RotationY: local +X -> (cos, -sin), local +Z -> (sin, cos)
  return {
    right: { x: c, z: -s },
    forward: { x: s, z: c }
  }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z }
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z }
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, z: a.z * s }
}

export function distance2D(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

export interface ObbBounds {
  halfX: number
  halfZ: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export function obbAABB(b: Pick<Building, 'x' | 'z' | 'width' | 'depth' | 'rotation'>): ObbBounds {
  const { right, forward } = yawBasis(b.rotation)
  const halfX = (Math.abs(right.x) * b.width) / 2 + (Math.abs(forward.x) * b.depth) / 2
  const halfZ = (Math.abs(right.z) * b.width) / 2 + (Math.abs(forward.z) * b.depth) / 2
  return {
    halfX,
    halfZ,
    minX: b.x - halfX,
    maxX: b.x + halfX,
    minZ: b.z - halfZ,
    maxZ: b.z + halfZ
  }
}

export function obbCorners(b: Building): Vec2[] {
  const { right, forward } = yawBasis(b.rotation)
  const rx = scale(right, b.width / 2)
  const fz = scale(forward, b.depth / 2)
  const c = { x: b.x, z: b.z }
  return [
    add(add(c, rx), fz),
    add(sub(c, rx), fz),
    sub(sub(c, rx), fz),
    sub(add(c, rx), fz)
  ]
}

export function projectExtentOnAxis(width: number, depth: number, rotation: number, axis: Vec2): number {
  const { right, forward } = yawBasis(rotation)
  return (width / 2) * Math.abs(dot(right, axis)) + (depth / 2) * Math.abs(dot(forward, axis))
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const lengthSq = dx * dx + dz * dz
  if (lengthSq < 1e-10) {
    return { point: { ...a }, t: 0, distance: distance2D(p, a) }
  }
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq
  t = clamp(t, 0, 1)
  const point = { x: a.x + dx * t, z: a.z + dz * t }
  return { point, t, distance: distance2D(p, point) }
}

export interface PolylineInfo {
  lengths: number[]
  total: number
}

export function polylineInfo(points: Vec2[]): PolylineInfo {
  const lengths: number[] = []
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const len = distance2D(points[i], points[i + 1])
    lengths.push(len)
    total += len
  }
  return { lengths, total }
}

export function pointAtDistance(points: Vec2[], distance: number): { point: Vec2; tangent: Vec2 } {
  if (points.length === 0) return { point: { x: 0, z: 0 }, tangent: { x: 1, z: 0 } }
  if (points.length === 1) return { point: { ...points[0] }, tangent: { x: 1, z: 0 } }

  const info = polylineInfo(points)
  const d = clamp(distance, 0, info.total)
  let accumulated = 0
  for (let i = 0; i < info.lengths.length; i++) {
    const len = info.lengths[i]
    if (d <= accumulated + len || i === info.lengths.length - 1) {
      const local = len < 1e-8 ? 0 : clamp((d - accumulated) / len, 0, 1)
      const a = points[i]
      const b = points[i + 1]
      const tangent = len < 1e-8 ? { x: 1, z: 0 } : { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
      return {
        point: { x: a.x + (b.x - a.x) * local, z: a.z + (b.z - a.z) * local },
        tangent
      }
    }
    accumulated += len
  }
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  const len = distance2D(prev, last) || 1
  return { point: { ...last }, tangent: { x: (last.x - prev.x) / len, z: (last.z - prev.z) / len } }
}

export function pointAtU(points: Vec2[], u: number): { point: Vec2; tangent: Vec2 } {
  const total = polylineInfo(points).total
  return pointAtDistance(points, clamp(u, 0, 1) * total)
}

export interface NearestPolylineResult {
  point: Vec2
  distance: number
  u: number
  segmentIndex: number
  tangent: Vec2
}

export function nearestOnPolyline(p: Vec2, points: Vec2[]): NearestPolylineResult | null {
  if (points.length === 0) return null
  if (points.length === 1) {
    return { point: { ...points[0] }, distance: distance2D(p, points[0]), u: 0, segmentIndex: 0, tangent: { x: 1, z: 0 } }
  }

  const info = polylineInfo(points)
  let best: NearestPolylineResult | null = null
  let accumulated = 0

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const hit = closestPointOnSegment(p, a, b)
    const len = info.lengths[i]
    const atDistance = accumulated + hit.t * len
    const u = info.total > 0 ? atDistance / info.total : 0
    const tangent = len < 1e-8 ? { x: 1, z: 0 } : { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
    if (!best || hit.distance < best.distance) {
      best = { point: hit.point, distance: hit.distance, u, segmentIndex: i, tangent }
    }
    accumulated += len
  }
  return best
}

export interface PoseSnapResult {
  x: number
  z: number
  rotation: number
  changed: boolean
  kind: 'grid' | 'wall' | 'street'
  streetId?: string | null
  streetSide?: 1 | -1 | null
  streetU?: number | null
}

function nearestParallelYaw(yaw: number, targetYaw: number): number {
  let best = targetYaw
  let bestDistance = Infinity
  for (let k = 0; k < 4; k++) {
    const candidate = targetYaw + (k * Math.PI) / 2
    const d = angleDistance(yaw, candidate)
    if (d < bestDistance) {
      bestDistance = d
      best = candidate
    }
  }
  return best
}

interface WallCandidate {
  x: number
  z: number
  rotation: number
  moveDistance: number
}

export function wallSnapCandidate(
  candidate: Pick<Building, 'x' | 'z' | 'width' | 'depth' | 'rotation'>,
  others: Building[],
  threshold: number
): WallCandidate | null {
  let best: WallCandidate | null = null

  for (const target of others) {
    const rotation = nearestParallelYaw(candidate.rotation, target.rotation)
    const targetBasis = yawBasis(target.rotation)
    const delta = sub({ x: candidate.x, z: candidate.z }, { x: target.x, z: target.z })
    const localX = dot(delta, targetBasis.right)
    const localZ = dot(delta, targetBasis.forward)

    const halfCX = projectExtentOnAxis(candidate.width, candidate.depth, rotation, targetBasis.right)
    const halfCZ = projectExtentOnAxis(candidate.width, candidate.depth, rotation, targetBasis.forward)
    const gapX = Math.abs(localX) - (target.width / 2 + halfCX)
    const gapZ = Math.abs(localZ) - (target.depth / 2 + halfCZ)

    const consider = (nextLocalX: number, nextLocalZ: number) => {
      const world = add(
        { x: target.x, z: target.z },
        add(scale(targetBasis.right, nextLocalX), scale(targetBasis.forward, nextLocalZ))
      )
      const moveDistance = distance2D(candidate, world)
      if (moveDistance <= threshold && (!best || moveDistance < best.moveDistance)) {
        best = { x: world.x, z: world.z, rotation, moveDistance }
      }
    }

    // Touch a face perpendicular to target right axis. Tangential overlap is required,
    // or the candidate may be only threshold beyond the wall end.
    if (gapX <= threshold && gapX >= -0.45 && gapZ <= threshold) {
      const signX = Math.abs(localX) < 1e-6 ? 1 : Math.sign(localX)
      consider(signX * (target.width / 2 + halfCX), localZ)
    }

    // Touch a face perpendicular to target forward axis.
    if (gapZ <= threshold && gapZ >= -0.45 && gapX <= threshold) {
      const signZ = Math.abs(localZ) < 1e-6 ? 1 : Math.sign(localZ)
      consider(localX, signZ * (target.depth / 2 + halfCZ))
    }
  }

  return best
}

export function streetSnapCandidate(
  candidate: Pick<Building, 'x' | 'z' | 'width' | 'depth' | 'rotation'>,
  street: Street,
  threshold: number
): (WallCandidate & { streetId: string; side: 1 | -1; u: number }) | null {
  const nearest = nearestOnPolyline(candidate, street.points)
  if (!nearest || street.points.length < 2) return null

  const offset = street.width / 2 + street.setback + candidate.depth / 2
  const deltaDistance = Math.abs(nearest.distance - offset)
  if (deltaDistance > threshold) return null

  let normal: Vec2
  let side: 1 | -1
  if (nearest.distance > 1e-5) {
    normal = scale(sub(candidate, nearest.point), 1 / nearest.distance)
    const n0 = { x: -nearest.tangent.z, z: nearest.tangent.x }
    side = dot(normal, n0) >= 0 ? 1 : -1
  } else {
    normal = { x: -nearest.tangent.z, z: nearest.tangent.x }
    side = 1
  }

  const p = add(nearest.point, scale(normal, offset))
  const rotation = Math.atan2(-normal.x, -normal.z)
  const moveDistance = distance2D(candidate, p)
  if (moveDistance > threshold * 1.8) return null
  return {
    x: p.x,
    z: p.z,
    rotation,
    moveDistance,
    streetId: street.id,
    side,
    u: nearest.u
  }
}

export function streetPlacementPose(street: Street, u: number, side: 1 | -1, depth: number): PoseSnapResult {
  const at = pointAtU(street.points, u)
  const n0 = { x: -at.tangent.z, z: at.tangent.x }
  const normal = scale(n0, side)
  const offset = street.width / 2 + street.setback + depth / 2
  const p = add(at.point, scale(normal, offset))
  return {
    x: p.x,
    z: p.z,
    rotation: Math.atan2(-normal.x, -normal.z),
    changed: true,
    kind: 'street',
    streetId: street.id,
    streetSide: side,
    streetU: u
  }
}

export function resolvePlacement(
  raw: Vec2,
  draft: Pick<Building, 'width' | 'depth' | 'rotation'>,
  others: Building[],
  streets: Street[],
  threshold: number,
  gridSize = 0.5
): PoseSnapResult {
  const gridPoint = snapVec2ToGrid(raw, gridSize)
  const candidate = { ...draft, ...gridPoint }

  let best: PoseSnapResult = {
    ...gridPoint,
    rotation: draft.rotation,
    changed: true,
    kind: 'grid',
    streetId: null,
    streetSide: null,
    streetU: null
  }
  let bestDistance = Infinity

  for (const street of streets) {
    const hit = streetSnapCandidate(candidate, street, threshold)
    if (hit && hit.moveDistance < bestDistance) {
      bestDistance = hit.moveDistance
      best = {
        x: hit.x,
        z: hit.z,
        rotation: hit.rotation,
        changed: true,
        kind: 'street',
        streetId: hit.streetId,
        streetSide: hit.side,
        streetU: hit.u
      }
    }
  }

  const wall = wallSnapCandidate(candidate, others, threshold)
  if (wall && wall.moveDistance < bestDistance * 0.9) {
    best = {
      x: wall.x,
      z: wall.z,
      rotation: wall.rotation,
      changed: true,
      kind: 'wall',
      streetId: null,
      streetSide: null,
      streetU: null
    }
  }

  return best
}

export function rectsOverlap(a: { x1: number; x2: number; y1: number; y2: number }, b: typeof a): boolean {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2)
}
