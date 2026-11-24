import { project3d } from '../lib/projection'
import { SANDBOX_SIZE } from '../constants'
import type { Map as MLMap } from 'maplibre-gl'
import type { RoadNetState, XY } from '../types'

export interface OverlayHandle {
  kind: 'midpoint'
  edgeId: string
  x: number
  y: number
  sx: number
  sy: number
}

function project(map: MLMap, x: number, y: number, z: number) {
  return project3d(map, x, y, z)
}

/** 每帧重绘 2D 叠加层:约束轴、边中点手柄、连接橡皮筋线 */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  map: MLMap,
  state: RoadNetState,
  opts: {
    selectedNode: string | null
    tool: string
    connectFrom: string | null
    cursorLocal: XY | null
    hoverNode: string | null
  }
): OverlayHandle[] {
  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const handles: OverlayHandle[] = []
  const { selectedNode, tool, connectFrom, cursorLocal, hoverNode } = opts

  // 约束轴(选中节点或悬停节点带约束时)
  const axisTarget = selectedNode ?? hoverNode
  if (axisTarget) {
    const n = state.intersections[axisTarget]
    if (n && n.angleConstraint !== null) {
      const rad = (n.angleConstraint * Math.PI) / 180
      const half = SANDBOX_SIZE * 0.75
      const p1 = { x: n.x + Math.cos(rad) * half, y: n.y + Math.sin(rad) * half }
      const p2 = { x: n.x - Math.cos(rad) * half, y: n.y - Math.sin(rad) * half }
      // 约束在该节点上的实际邻边方向也画短刻度
      const s1 = project(map, p1.x, p1.y, 0)
      const s2 = project(map, p2.x, p2.y, 0)
      ctx.save()
      ctx.setLineDash([9, 7])
      ctx.strokeStyle = 'rgba(255, 170, 40, 0.85)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(s2.x, s2.y)
      ctx.lineTo(s1.x, s1.y)
      ctx.stroke()
      ctx.setLineDash([])
      // 端点箭头小标签
      ctx.fillStyle = 'rgba(255, 170, 40, 0.95)'
      ctx.font = '12px system-ui, sans-serif'
      ctx.fillText(`${Math.round(n.angleConstraint)}° 约束轴`, s1.x + 6, s1.y - 6)
      ctx.restore()
    }
  }

  // 连接工具橡皮筋
  if (tool === 'connect' && connectFrom) {
    const n = state.intersections[connectFrom]
    if (n && cursorLocal) {
      const s1 = project(map, n.x, n.y, 3)
      const s2 = project(map, cursorLocal.x, cursorLocal.y, 3)
      ctx.save()
      ctx.setLineDash([6, 5])
      ctx.strokeStyle = 'rgba(70, 220, 130, 0.95)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(s1.x, s1.y)
      ctx.lineTo(s2.x, s2.y)
      ctx.stroke()
      ctx.restore()
    }
  }

  // 拆分工具:每条边中点手柄
  if (tool === 'split') {
    for (const e of Object.values(state.edges)) {
      const a = state.intersections[e.a]
      const b = state.intersections[e.b]
      if (!a || !b) continue
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const s = project(map, mx, my, 3)
      handles.push({ kind: 'midpoint', edgeId: e.id, x: mx, y: my, sx: s.x, sy: s.y })
      ctx.save()
      ctx.beginPath()
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#e8862a'
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(s.x - 3.5, s.y)
      ctx.lineTo(s.x + 3.5, s.y)
      ctx.moveTo(s.x, s.y - 3.5)
      ctx.lineTo(s.x, s.y + 3.5)
      ctx.strokeStyle = '#e8862a'
      ctx.lineWidth = 1.4
      ctx.stroke()
      ctx.restore()
    }
  }

  return handles
}

export function hitHandle(handles: OverlayHandle[], px: number, py: number): OverlayHandle | null {
  for (const h of handles) {
    if (Math.hypot(h.sx - px, h.sy - py) <= 11) return h
  }
  return null
}
