import { onCleanup, onMount, createEffect, createSignal } from 'solid-js'
import 'maplibre-gl/dist/maplibre-gl.css'
import { store } from '../store/network'
import { SANDBOX_SIZE } from '../constants'
import { createSandboxLayer } from './SandboxLayer'
import type { SandboxLayerHandle } from './SandboxLayer'
import { createSandboxMap } from './camera'
import { invertMVP, pickTerrain, project3d } from '../lib/projection'
import { drawOverlay, hitHandle } from './overlay'
import { pointSegDistance, terrainHeight } from '../lib/terrain'
import type { Map as MLMap } from 'maplibre-gl'
import type { XY } from '../types'

interface DragState {
  nodeId: string
  moved: boolean
}
interface PanState {
  startX: number
  startY: number
  center: { lng: number; lat: number }
  mode: 'pan' | 'rotate'
  startBearing: number
  startPitch: number
}

export default function MapView() {
  let containerEl!: HTMLDivElement
  let overlayCanvas!: HTMLCanvasElement
  let map!: MLMap
  let layer!: SandboxLayerHandle
  const layerId = 'sandbox-3d'
  let drag: DragState | null = null
  let pan: PanState | null = null
  let downPos = { x: 0, y: 0, button: 0 }
  const [coordText, setCoordText] = createSignal('')
  const [layerReady, setLayerReady] = createSignal(false)
  let overlayHandles: ReturnType<typeof drawOverlay> = []
  let raf = 0
  let cursorLocal: XY | null = null

  const localPoint = (e: PointerEvent) => {
    const rect = map.getCanvas().getBoundingClientRect()
    return { px: e.clientX - rect.left, py: e.clientY - rect.top }
  }

  const pickLocal = (px: number, py: number): XY | null => {
    const inv = invertMVP(layer.getMVP())
    if (!inv) return null
    const hit = pickTerrain(inv, px, py, containerEl.clientWidth, containerEl.clientHeight)
    if (!hit) return null
    if (hit.x < -40 || hit.y < -40 || hit.x > SANDBOX_SIZE + 40 || hit.y > SANDBOX_SIZE + 40) return null
    return { x: hit.x, y: hit.y }
  }

  /** 屏幕坐标命中路口节点(按屏幕像素容差) */
  const pickNode = (px: number, py: number): string | null => {
    const s = store.get()
    let best: string | null = null
    let bestD = 15
    for (const n of Object.values(s.intersections)) {
      const sp = project3d(map, n.x, n.y, terrainHeight(n.x, n.y) + 4)
      const d = Math.hypot(sp.x - px, sp.y - py)
      if (d < bestD) {
        bestD = d
        best = n.id
      }
    }
    return best
  }

  const pickEdge = (p: XY): string | null => {
    const s = store.get()
    let best: string | null = null
    let bestD = 12
    for (const e of Object.values(s.edges)) {
      const a = s.intersections[e.a]
      const b = s.intersections[e.b]
      if (!a || !b) continue
      const d = pointSegDistance(p, a, b)
      if (d < bestD) {
        bestD = d
        best = e.id
      }
    }
    return best
  }

  onMount(() => {
    map = createSandboxMap(containerEl)
    ;(window as unknown as { __sandboxMap?: MLMap }).__sandboxMap = map
    layer = createSandboxLayer()
    map.on('load', () => {
      map.addLayer(layer.layer)
      setLayerReady(true)
      void import('../lib/geometry').then(({ buildTerrainMesh }) => {
        layer.updateMesh('terrain', buildTerrainMesh())
        map.triggerRepaint()
      })
    })

    // 路网变化 → 重建道路/节点网格(layerReady 保证图层就绪后必跑一次)
    createEffect(() => {
      const s = store.state[0]()
      const selNode = store.selectedNode[0]()
      const hoverNode = store.hoverNode[0]()
      const connFrom = store.connectFrom[0]()
      const selRoad = store.selectedRoad[0]()
      const hoverEdge = store.hoverEdge[0]()
      if (!layerReady()) return
      void import('../lib/geometry').then((geo) => {
        layer.updateMesh('curb', geo.buildCurbMesh(s))
        layer.updateMesh('road', geo.buildRoadMesh(s))
        let hlEdge: string | null = null
        if (selRoad) {
          hlEdge = Object.values(s.edges).find((e) => e.roadId === selRoad)?.id ?? null
        } else if (hoverEdge) {
          hlEdge = hoverEdge
        }
        layer.updateMesh('highlight', geo.buildEdgeHighlightMesh(s, hlEdge))
        layer.updateMesh('nodes', geo.buildNodeMesh(s, selNode, hoverNode, connFrom))
        // 自定义图层内容在 render 之外变更,必须主动请求重绘
        map.triggerRepaint()
      })
    })

    // 叠加层每帧跟随相机重绘
    const loop = () => {
      if (map && map.getLayer && map.getLayer(layerId)) {
        overlayHandles = drawOverlay(overlayCanvas, map, store.get(), {
          selectedNode: store.selectedNode[0](),
          tool: store.tool[0](),
          connectFrom: store.connectFrom[0](),
          cursorLocal,
          hoverNode: store.hoverNode[0]()
        })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const el = map.getCanvas()
    el.style.touchAction = 'none'

    el.addEventListener('contextmenu', (e) => e.preventDefault())

    el.addEventListener('pointerdown', (e) => {
      const { px, py } = localPoint(e)
      downPos = { x: px, y: py, button: e.button }
      el.setPointerCapture?.(e.pointerId)

      if (e.button === 2 || e.button === 1) {
        const c = map.getCenter()
        pan = {
          startX: px,
          startY: py,
          center: { lng: c.lng, lat: c.lat },
          mode: e.shiftKey ? 'rotate' : 'pan',
          startBearing: map.getBearing(),
          startPitch: map.getPitch()
        }
        return
      }

      const tool = store.tool[0]()
      if (tool === 'split') {
        const h = hitHandle(overlayHandles, px, py)
        if (h) {
          store.splitEdge(h.edgeId, { x: h.x, y: h.y })
          store.tool[1]('select')
          return
        }
      }

      const nodeId = pickNode(px, py)
      if (nodeId) {
        if (tool === 'delete') {
          store.deleteIntersection(nodeId)
          return
        }
        if (tool === 'connect') {
          const from = store.connectFrom[0]()
          if (!from) {
            store.connectFrom[1](nodeId)
          } else if (from === nodeId) {
            store.connectFrom[1](null)
          } else {
            store.connect(from, nodeId)
            store.connectFrom[1](null)
          }
          return
        }
        store.selectedNode[1](nodeId)
        store.selectedRoad[1](null)
        store.dragBegin()
        drag = { nodeId, moved: false }
        return
      }
    })

    el.addEventListener('pointermove', (e) => {
      const { px, py } = localPoint(e)
      const local = pickLocal(px, py)
      cursorLocal = local
      if (local) {
        setCoordText(
          `X ${local.x.toFixed(1)} m · Y ${local.y.toFixed(1)} m · 高程 ${terrainHeight(local.x, local.y).toFixed(1)} m`
        )
      }

      if (pan) {
        const dx = px - pan.startX
        const dy = py - pan.startY
        if (pan.mode === 'pan') {
          const before = map.project([pan.center.lng, pan.center.lat])
          const after = map.unproject([before.x - dx, before.y - dy])
          map.setCenter([after.lng, after.lat])
        } else {
          map.setBearing(pan.startBearing - dx * 0.4)
          map.setPitch(Math.max(0, Math.min(80, pan.startPitch - dy * 0.25)))
        }
        return
      }

      if (drag && local) {
        drag.moved = true
        el.style.cursor = 'grabbing'
        store.dragMove(drag.nodeId, local)
        map.triggerRepaint()
        return
      }

      const tool = store.tool[0]()
      const hovered = pickNode(px, py)
      store.hoverNode[1](hovered)
      if (!hovered && local) {
        const eid = pickEdge(local)
        store.hoverEdge[1](eid)
        el.style.cursor = eid && (tool === 'select' || tool === 'split') ? 'pointer' : tool === 'place' ? 'crosshair' : ''
      } else {
        store.hoverEdge[1](null)
        el.style.cursor = hovered ? (tool === 'delete' ? 'not-allowed' : 'grab') : tool === 'place' ? 'crosshair' : tool === 'split' ? 'cell' : ''
      }
    })

    const onUp = (e: PointerEvent) => {
      const { px, py } = localPoint(e)
      try {
        el.releasePointerCapture?.(e.pointerId)
      } catch {
        /* 指针已释放 */
      }

      if (pan) {
        pan = null
        return
      }
      if (drag) {
        store.dragEnd()
        drag = null
        el.style.cursor = ''
        return
      }
      if (e.button !== 0) return
      if (Math.hypot(px - downPos.x, py - downPos.y) > 6) return

      const tool = store.tool[0]()
      const local = pickLocal(px, py)
      const nodeId = pickNode(px, py)

      if (tool === 'place' && local && !nodeId) {
        store.addIntersection(local)
        return
      }
      if (tool === 'delete') {
        if (nodeId) return
        if (local) {
          const eid = pickEdge(local)
          if (eid) store.deleteEdge(eid)
        }
        return
      }
      if (tool === 'select' && !nodeId && local) {
        const eid = pickEdge(local)
        if (eid) store.selectRoadByEdge(eid)
        else {
          store.selectedNode[1](null)
          store.selectedRoad[1](null)
        }
      }
    }
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)

    el.addEventListener('dblclick', (e: MouseEvent) => {
      e.preventDefault()
      const { px, py } = localPoint(e as unknown as PointerEvent)
      map.easeTo({ zoom: map.getZoom() + 0.8, around: map.unproject([px, py]), duration: 250 })
    })

    onCleanup(() => {
      cancelAnimationFrame(raf)
      map.remove()
      delete (window as unknown as { __sandboxMap?: MLMap }).__sandboxMap
    })
  })

  // 工具切换时清理临时态
  createEffect(() => {
    const t = store.tool[0]()
    if (t !== 'connect') store.connectFrom[1](null)
  })

  return (
    <div class="map-view" ref={containerEl!}>
      <canvas class="overlay-canvas" ref={overlayCanvas!} />
      <div class="map-hud">
        <span class="hud-coord">{coordText()}</span>
        {store.snapHint[0]() && <span class="hud-snap">{store.snapHint[0]()}</span>}
        <span class="hud-tip">左键拖动路口 · 右键平移 · Shift+右键旋转俯仰 · 滚轮缩放 · 双击放大</span>
      </div>
    </div>
  )
}
