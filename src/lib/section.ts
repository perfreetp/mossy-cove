import * as THREE from 'three'
import type { MeshGeometryData, Vec3Tuple } from './types'

export interface SectionOutline {
  linePositions: Float32Array
  areaMm2: number
  loopCount: number
}

interface Segment {
  a: string
  b: string
  pa: THREE.Vector3
  pb: THREE.Vector3
}

const EPS = 1e-7

export function computeSectionOutline(
  data: MeshGeometryData,
  normalTuple: Vec3Tuple,
  position: number,
): SectionOutline {
  const normal = new THREE.Vector3(...normalTuple).normalize()
  const p = data.positions
  const idx = data.indices
  const planePoint = normal.clone().multiplyScalar(position)
  const baseD = -normal.dot(planePoint)

  const distances = new Float32Array(p.length / 3)
  for (let i = 0; i < distances.length; i++) {
    distances[i] = normal.x * p[i * 3] + normal.y * p[i * 3 + 1] + normal.z * p[i * 3 + 2] + baseD + 1e-6
  }

  const pointCache = new Map<string, THREE.Vector3>()
  const segments: Segment[] = []
  const adjacency = new Map<string, string[]>()
  const segmentPositions: number[] = []

  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)

  function intersectionOnEdge(a: number, b: number): { key: string; point: THREE.Vector3 } | null {
    const da = distances[a]
    const db = distances[b]
    if (da * db >= 0) return null
    const key = edgeKey(a, b)
    let point = pointCache.get(key)
    if (!point) {
      const t = da / (da - db)
      point = new THREE.Vector3(
        p[a * 3] + (p[b * 3] - p[a * 3]) * t,
        p[a * 3 + 1] + (p[b * 3 + 1] - p[a * 3 + 1]) * t,
        p[a * 3 + 2] + (p[b * 3 + 2] - p[a * 3 + 2]) * t,
      )
      pointCache.set(key, point)
    }
    return { key, point }
  }

  function addSegment(ka: string, kb: string, pa: THREE.Vector3, pb: THREE.Vector3) {
    if (pa.distanceToSquared(pb) < EPS * EPS) return
    segments.push({ a: ka, b: kb, pa, pb })
    segmentPositions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z)
    if (!adjacency.has(ka)) adjacency.set(ka, [])
    if (!adjacency.has(kb)) adjacency.set(kb, [])
    adjacency.get(ka)!.push(kb)
    adjacency.get(kb)!.push(ka)
  }

  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i], ib = idx[i + 1], ic = idx[i + 2]
    const eab = intersectionOnEdge(ia, ib)
    const ebc = intersectionOnEdge(ib, ic)
    const eca = intersectionOnEdge(ic, ia)
    const hits = [eab, ebc, eca].filter(Boolean) as NonNullable<ReturnType<typeof intersectionOnEdge>>[]
    if (hits.length >= 2) {
      addSegment(hits[0].key, hits[1].key, hits[0].point, hits[1].point)
    }
  }

  const area = calculateLoopArea(pointCache, adjacency, normal, planePoint)
  return {
    linePositions: new Float32Array(segmentPositions),
    areaMm2: area,
    loopCount: segments.length > 0 ? countLoops(adjacency) : 0,
  }
}

function countLoops(adjacency: Map<string, string[]>): number {
  const visited = new Set<string>()
  let loops = 0
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue
    loops++
    let previous: string | null = null
    let current: string | null = start
    while (current && !visited.has(current)) {
      visited.add(current)
      const neighbors: string[] = adjacency.get(current) ?? []
      const next: string | null = neighbors.find((n: string) => n !== previous && !visited.has(n)) ?? null
      previous = current
      current = next
    }
  }
  return loops
}

function calculateLoopArea(
  points: Map<string, THREE.Vector3>,
  adjacency: Map<string, string[]>,
  normal: THREE.Vector3,
  origin: THREE.Vector3,
): number {
  const helper = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const u = new THREE.Vector3().crossVectors(helper, normal).normalize()
  const v = new THREE.Vector3().crossVectors(normal, u).normalize()

  const visited = new Set<string>()
  let total = 0

  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue
    const loop: THREE.Vector3[] = []
    let previous: string | null = null
    let current: string | null = start

    while (current) {
      if (visited.has(current)) break
      visited.add(current)
      const point = points.get(current)
      if (point) loop.push(point)
      const neighbors: string[] = adjacency.get(current) ?? []
      const next: string | undefined = neighbors.find((n: string) => n !== previous && !visited.has(n))
      if (!next) break
      previous = current
      current = next
    }

    if (loop.length >= 3) {
      let signed = 0
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i].clone().sub(origin)
        const b = loop[(i + 1) % loop.length].clone().sub(origin)
        const ax = a.dot(u), ay = a.dot(v)
        const bx = b.dot(u), by = b.dot(v)
        signed += ax * by - ay * bx
      }
      total += Math.abs(signed) / 2
    }
  }

  return total
}

export function planeConstant(normal: Vec3Tuple, position: number, flip: boolean): THREE.Plane {
  const n = new THREE.Vector3(...normal).normalize()
  if (flip) n.negate()
  return new THREE.Plane(n, -n.x * normal[0] * position - n.y * normal[1] * position - n.z * normal[2] * position)
}
