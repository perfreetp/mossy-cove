import { onCleanup, onMount, createMemo } from 'solid-js'
import { store } from '../store/network'
import { SANDBOX_SIZE } from '../constants'
import { emitLocate } from '../lib/bus'

const W = 250
const H = 250
const PAD = 14

export default function NetworkGraph() {
  let canvas!: HTMLCanvasElement

  const stats = createMemo(() => {
    const s = store.get()
    return { nodes: Object.keys(s.intersections).length, edges: Object.keys(s.edges).length }
  })

  const toPx = (x: number, y: number): [number, number] => [
    PAD + (x / SANDBOX_SIZE) * (W - PAD * 2),
    H - PAD - (y / SANDBOX_SIZE) * (H - PAD * 2)
  ]

  const draw = () => {
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr
      canvas.height = H * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    // 底框(沙盘范围)
    ctx.fillStyle = 'rgba(16, 24, 39, 0.9)'
    ctx.strokeStyle = 'rgba(120, 150, 190, 0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.rect(PAD, PAD, W - PAD * 2, H - PAD * 2)
    ctx.fill()
    ctx.stroke()

    const s = store.get()
    const selNode = store.selectedNode[0]()
    const selRoad = store.selectedRoad[0]()
    const hoverNode = store.hoverNode[0]()

    // 边
    for (const e of Object.values(s.edges)) {
      const a = s.intersections[e.a]
      const b = s.intersections[e.b]
      const road = s.roads[e.roadId]
      if (!a || !b || !road) continue
      const [x1, y1] = toPx(a.x, a.y)
      const [x2, y2] = toPx(b.x, b.y)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.lineWidth = road.widthLevel === 'primary' ? 3.2 : 1.8
      ctx.strokeStyle =
        selRoad === road.id ? 'rgba(255, 200, 70, 0.95)' : road.widthLevel === 'primary' ? 'rgba(200, 214, 235, 0.8)' : 'rgba(130, 150, 178, 0.75)'
      ctx.stroke()
    }

    // 节点
    for (const n of Object.values(s.intersections)) {
      const [x, y] = toPx(n.x, n.y)
      ctx.beginPath()
      ctx.arc(x, y, n.id === selNode ? 6 : n.id === hoverNode ? 5.5 : 4, 0, Math.PI * 2)
      if (n.id === selNode) ctx.fillStyle = '#ffd64a'
      else if (n.angleConstraint !== null) ctx.fillStyle = '#46dc82'
      else ctx.fillStyle = '#e8eef8'
      ctx.fill()
      ctx.lineWidth = 1.2
      ctx.strokeStyle = 'rgba(10, 14, 22, 0.9)'
      ctx.stroke()
    }

    // 空态提示
    if (stats().nodes === 0) {
      ctx.fillStyle = 'rgba(170, 190, 220, 0.7)'
      ctx.font = '12px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('暂无路网,先在视口中放置路口', W / 2, H / 2)
      ctx.textAlign = 'start'
    }
  }

  const onClick = (ev: MouseEvent) => {
    const rect = canvas.getBoundingClientRect()
    const px = ((ev.clientX - rect.left) / rect.width) * W
    const py = ((ev.clientY - rect.top) / rect.height) * H
    const s = store.get()
    let best: string | null = null
    let bd = 14
    for (const n of Object.values(s.intersections)) {
      const [x, y] = toPx(n.x, n.y)
      const d = Math.hypot(x - px, y - py)
      if (d < bd) {
        bd = d
        best = n.id
      }
    }
    if (best) {
      const n = s.intersections[best]
      store.selectedNode[1](best)
      store.selectedRoad[1](null)
      emitLocate({ x: n.x, y: n.y, nodeId: best })
    }
  }

  onMount(() => {
    // 任意状态变化都重绘(数据量小,rAF 全量重绘成本可忽略)
    let raf = 0
    const tick = () => {
      draw()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    onCleanup(() => cancelAnimationFrame(raf))
  })

  return (
    <section class="panel graph-panel">
      <header class="panel-head">
        <h2>路网图</h2>
        <span class="graph-stats">
          {stats().nodes} 节点 · {stats().edges} 连接
        </span>
      </header>
      <div class="graph-wrap">
        <canvas ref={canvas!} class="graph-canvas" style={{ width: '100%', 'aspect-ratio': '1' }} onClick={onClick} />
      </div>
      <div class="graph-legend">
        <span><i class="dot yellow" /> 选中</span>
        <span><i class="dot green" /> 角度约束</span>
        <span><i class="dot white" /> 普通路口</span>
      </div>
      <p class="hint">点击缩略图节点,视口将定位到对应路口。</p>
    </section>
  )
}
