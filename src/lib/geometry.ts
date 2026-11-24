import { MATERIALS, NODE_RADIUS, ROAD_LIFT, ROAD_WIDTHS, SANDBOX_SIZE } from '../constants'
import { terrainHeight, terrainNormal } from './terrain'
import type { RoadNetState } from '../types'

export interface MeshData {
  positions: number[] // xyz,本地沙盘米坐标
  normals: number[]
  colors: number[] // rgb 0..1
  grain: number[] // 每顶点材质颗粒度 0..1
  indices: number[]
}

function newMesh(): MeshData {
  return { positions: [], normals: [], colors: [], grain: [], indices: [] }
}

function pushVert(mesh: MeshData, x: number, y: number, z: number, color: [number, number, number], grain: number) {
  const [nx, ny, nz] = terrainNormal(x, y)
  mesh.positions.push(x, y, z)
  mesh.normals.push(nx, ny, nz)
  mesh.colors.push(color[0], color[1], color[2])
  mesh.grain.push(grain)
}

/** 地形网格:规则三角网 + 按高度着色 */
export function buildTerrainMesh(segments = 110): MeshData {
  const mesh = newMesh()
  const s = SANDBOX_SIZE
  const step = s / segments

  const colorFor = (h: number, x: number, y: number): [number, number, number] => {
    const t = Math.max(0, Math.min(1, (h + 20) / 90))
    // 低:草甸绿;中:黄绿;高:岩灰;顶:雪
    const stops: Array<[number, [number, number, number]]> = [
      [0, [0.27, 0.42, 0.24]],
      [0.35, [0.36, 0.5, 0.28]],
      [0.62, [0.42, 0.4, 0.32]],
      [0.82, [0.46, 0.45, 0.44]],
      [1, [0.92, 0.93, 0.95]]
    ]
    let lo = stops[0]
    let hi = stops[stops.length - 1]
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        lo = stops[i]
        hi = stops[i + 1]
        break
      }
    }
    const k = (t - lo[0]) / Math.max(1e-6, hi[0] - lo[0])
    const base: [number, number, number] = [
      lo[1][0] + (hi[1][0] - lo[1][0]) * k,
      lo[1][1] + (hi[1][1] - lo[1][1]) * k,
      lo[1][2] + (hi[1][2] - lo[1][2]) * k
    ]
    // 细微确定性斑驳
    const v = Math.sin(x * 0.05) * Math.cos(y * 0.043) * 0.04 + Math.sin(x * 0.13 + y * 0.07) * 0.025
    return [base[0] + v, base[1] + v, base[2] + v]
  }

  for (let j = 0; j <= segments; j++) {
    for (let i = 0; i <= segments; i++) {
      const x = i * step
      const y = j * step
      const z = terrainHeight(x, y)
      pushVert(mesh, x, y, z, colorFor(z, x, y), 0.15)
    }
  }
  const row = segments + 1
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * row + i
      const b = a + 1
      const c = a + row
      const d = c + 1
      mesh.indices.push(a, c, b, b, c, d)
    }
  }
  return mesh
}

interface EdgeGeom {
  edgeId: string
  roadId: string
  ax: number
  ay: number
  bx: number
  by: number
  halfW: number
  color: [number, number, number]
  grain: number
}

/** 道路网格:每条边一条贴合地形的带状网格 + 路口圆盘盖 + 转弯圆角扇形 */
export function buildRoadMesh(state: RoadNetState): MeshData {
  const mesh = newMesh()
  const s = SANDBOX_SIZE
  const geoms: EdgeGeom[] = []

  for (const e of Object.values(state.edges)) {
    const a = state.intersections[e.a]
    const b = state.intersections[e.b]
    const road = state.roads[e.roadId]
    if (!a || !b || !road) continue
    const mat = MATERIALS[road.material]
    geoms.push({
      edgeId: e.id,
      roadId: road.id,
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      halfW: ROAD_WIDTHS[road.widthLevel] / 2,
      color: mat.color,
      grain: mat.grain
    })
  }

  // ---- 边带状网格 ----
  for (const g of geoms) {
    const len = Math.hypot(g.bx - g.ax, g.by - g.ay)
    const samples = Math.max(2, Math.ceil(len / 8))
    const base = mesh.positions.length / 3
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const cx = g.ax + (g.bx - g.ax) * t
      const cy = g.ay + (g.by - g.ay) * t
      const dx = (g.bx - g.ax) / len
      const dy = (g.by - g.ay) / len
      // 水平横向(路面沿地形起伏,横向保持水平投影)
      const sx = -dy
      const sy = dx
      const lx = cx + sx * g.halfW
      const ly = cy + sy * g.halfW
      const rx = cx - sx * g.halfW
      const ry = cy - sy * g.halfW
      pushVert(mesh, lx, ly, terrainHeight(lx, ly) + ROAD_LIFT, g.color, g.grain)
      pushVert(mesh, rx, ry, terrainHeight(rx, ry) + ROAD_LIFT, g.color, g.grain)
    }
    for (let i = 0; i < samples; i++) {
      const a0 = base + i * 2
      const a1 = a0 + 1
      const b0 = a0 + 2
      const b1 = a0 + 3
      mesh.indices.push(a0, b0, a1, a1, b0, b1)
    }
  }

  // ---- 路口圆盘盖 + 圆角扇形 ----
  const byNode = new Map<string, EdgeGeom[]>()
  for (const g of geoms) {
    const a = state.intersections[state.edges[g.edgeId].a]
    const b = state.intersections[state.edges[g.edgeId].b]
    if (!byNode.has(a.id)) byNode.set(a.id, [])
    if (!byNode.has(b.id)) byNode.set(b.id, [])
    byNode.get(a.id)!.push(g)
    byNode.get(b.id)!.push(g)
  }

  for (const [nodeId, inc] of byNode) {
    const node = state.intersections[nodeId]
    if (!node) continue
    // 取最宽道路作为路口铺面材质
    const widest = inc.reduce((m, g) => (g.halfW > m.halfW ? g : m), inc[0])
    const R = widest.halfW + 1.2
    addDisc(mesh, node.x, node.y, R, widest.color, widest.grain, ROAD_LIFT)

    // 各邻边方向(从节点指向邻居)
    const rays = inc.map((g) => {
      const nxA = state.intersections[state.edges[g.edgeId].a]
      const nxB = state.intersections[state.edges[g.edgeId].b]
      const neighbor = nxA.id === nodeId ? nxB : nxA
      return { g, ang: Math.atan2(neighbor.y - node.y, neighbor.x - node.x), w: g.halfW }
    })
    rays.sort((p, q) => p.ang - q.ang)

    // 相邻方向之间的外凸圆角
    for (let i = 0; i < rays.length; i++) {
      const r1 = rays[i]
      const r2 = rays[(i + 1) % rays.length]
      let delta = r2.ang - r1.ang
      if (i === rays.length - 1) delta += Math.PI * 2
      if (delta < 0.35 || delta > Math.PI - 0.2) continue // 近乎直行或内侧楔角跳过
      const fr = 0.8 * Math.min(r1.w, r2.w)
      addAnnularSector(mesh, node.x, node.y, R, R + fr, r1.ang, r2.ang, i === rays.length - 1, r1.g.color, r1.g.grain)
    }
  }

  return mesh
}

/** 圆盘(扇形),贴合地形 */
function addDisc(mesh: MeshData, cx: number, cy: number, radius: number, color: [number, number, number], grain: number, lift: number) {
  const seg = 22
  const base = mesh.positions.length / 3
  pushVert(mesh, cx, cy, terrainHeight(cx, cy) + lift, color, grain)
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    const x = cx + Math.cos(a) * radius
    const y = cy + Math.sin(a) * radius
    pushVert(mesh, x, y, terrainHeight(x, y) + lift, color, grain)
  }
  for (let i = 0; i < seg; i++) mesh.indices.push(base, base + 1 + i, base + 2 + i)
}

/** 环形扇形(转弯圆角铺面) */
function addAnnularSector(
  mesh: MeshData,
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  a1: number,
  a2: number,
  wrap: boolean,
  color: [number, number, number],
  grain: number
) {
  const end = wrap ? a2 + Math.PI * 2 : a2
  const seg = Math.max(4, Math.ceil(((end - a1) / (Math.PI * 2)) * 24))
  const base = mesh.positions.length / 3
  for (let i = 0; i <= seg; i++) {
    const a = a1 + ((end - a1) * i) / seg
    for (const r of [rIn, rOut]) {
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r
      pushVert(mesh, x, y, terrainHeight(x, y) + ROAD_LIFT, color, grain)
    }
  }
  for (let i = 0; i < seg; i++) {
    const p = base + i * 2
    mesh.indices.push(p, p + 2, p + 1, p + 1, p + 2, p + 3)
  }
}

export interface NodeStyle {
  default: [number, number, number]
  hover: [number, number, number]
  selected: [number, number, number]
  connect: [number, number, number]
}

/** 路口节点网格:圆盘 + 深色描边环,高度抬升到路面之上 */
export function buildNodeMesh(
  state: RoadNetState,
  selectedId: string | null,
  hoverId: string | null,
  connectFromId: string | null
): MeshData {
  const mesh = newMesh()
  const cDefault: [number, number, number] = [0.97, 0.98, 0.99]
  const cHover: [number, number, number] = [0.58, 0.77, 0.99]
  const cSel: [number, number, number] = [1, 0.84, 0.29]
  const cConn: [number, number, number] = [0.29, 0.87, 0.5]
  const cRing: [number, number, number] = [0.1, 0.12, 0.16]

  for (const node of Object.values(state.intersections)) {
    const color =
      node.id === selectedId ? cSel : node.id === connectFromId ? cConn : node.id === hoverId ? cHover : cDefault
    // 描边环
    addAnnularSector(mesh, node.x, node.y, NODE_RADIUS, NODE_RADIUS + 2.2, 0, Math.PI * 2, false, cRing, 0)
    addDisc(mesh, node.x, node.y, NODE_RADIUS, color, 0, ROAD_LIFT + 0.9)
  }
  return mesh
}

/** 中线标记网格(用于悬停/选中道路高亮),细带状虚线感由 shader 以外的方式省略,这里给亮色窄带 */
export function buildEdgeHighlightMesh(state: RoadNetState, edgeId: string | null): MeshData {
  const mesh = newMesh()
  if (!edgeId) return mesh
  const e = state.edges[edgeId]
  if (!e) return mesh
  const a = state.intersections[e.a]
  const b = state.intersections[e.b]
  if (!a || !b) return mesh
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const samples = Math.max(2, Math.ceil(len / 8))
  const w = 1.1
  const color: [number, number, number] = [1, 0.95, 0.4]
  const base = mesh.positions.length / 3
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const cx = a.x + (b.x - a.x) * t
    const cy = a.y + (b.y - a.y) * t
    const dx = (b.x - a.x) / len
    const dy = (b.y - a.y) / len
    const sx = -dy
    const sy = dx
    for (const sign of [1, -1]) {
      const x = cx + sx * w * sign
      const y = cy + sy * w * sign
      pushVert(mesh, x, y, terrainHeight(x, y) + ROAD_LIFT + 0.5, color, 0)
    }
  }
  for (let i = 0; i < samples; i++) {
    const a0 = base + i * 2
    mesh.indices.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3)
  }
  return mesh
}

/** 道路边缘暗色压边(路缘),略宽且略低 */
export function buildCurbMesh(state: RoadNetState): MeshData {
  const mesh = newMesh()
  const curb: [number, number, number] = [0.08, 0.09, 0.11]
  for (const e of Object.values(state.edges)) {
    const a = state.intersections[e.a]
    const b = state.intersections[e.b]
    const road = state.roads[e.roadId]
    if (!a || !b || !road) continue
    const halfW = ROAD_WIDTHS[road.widthLevel] / 2 + 0.9
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const samples = Math.max(2, Math.ceil(len / 8))
    const base = mesh.positions.length / 3
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const cx = a.x + (b.x - a.x) * t
      const cy = a.y + (b.y - a.y) * t
      const dx = (b.x - a.x) / len
      const dy = (b.y - a.y) / len
      const sx = -dy
      const sy = dx
      for (const sign of [1, -1]) {
        const x = cx + sx * halfW * sign
        const y = cy + sy * halfW * sign
        pushVert(mesh, x, y, terrainHeight(x, y) + ROAD_LIFT - 0.35, curb, 0)
      }
    }
    for (let i = 0; i < samples; i++) {
      const a0 = base + i * 2
      mesh.indices.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3)
    }
  }
  return mesh
}
