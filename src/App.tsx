import { onCleanup, onMount } from 'solid-js'
import MapView from './map/MapView'
import Toolbar from './components/Toolbar'
import IntersectionPanel from './components/IntersectionPanel'
import RoadPanel from './components/RoadPanel'
import NetworkGraph from './components/NetworkGraph'
import IoPanel from './components/IoPanel'
import { store } from './store/network'
import { onLocate } from './lib/bus'
import { flyToLocal } from './map/camera'
import { sampleNetwork } from './sample'
import { STORAGE_KEY } from './constants'
import type { NetworkData } from './types'

export default function App() {
  onMount(() => {
    // 首次启动:优先恢复本地保存,校验失败或无存档则载入示例路网
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const data = JSON.parse(saved) as NetworkData
        if (data.version === 1 && Array.isArray(data.intersections) && Array.isArray(data.edges) && Array.isArray(data.roads)) {
          store.importData(data)
        } else {
          store.importData(sampleNetwork())
        }
      } catch {
        store.importData(sampleNetwork())
      }
    } else {
      store.importData(sampleNetwork())
    }

    const off = onLocate(({ x, y }) => {
      // 视口定位:通过 map 实例单例(挂在 window 上由 MapView 注册)
      const map = (window as unknown as { __sandboxMap?: import('maplibre-gl').Map }).__sandboxMap
      if (map) flyToLocal(map, x, y)
    })

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        store.redo()
      } else if (!mod) {
        const map: Record<string, string> = { v: 'select', p: 'place', c: 'connect', s: 'split', d: 'delete' }
        const t = map[e.key.toLowerCase()]
        if (t) store.tool[1](t as never)
        if (e.key === 'Escape') {
          store.connectFrom[1](null)
          store.selectedNode[1](null)
          store.selectedRoad[1](null)
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const n = store.selectedNode[0]()
          if (n) store.deleteIntersection(n)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => {
      off()
      window.removeEventListener('keydown', onKey)
    })
  })

  return (
    <div class="app-shell">
      <header class="app-header">
        <div class="brand">
          <span class="brand-mark">⛰</span>
          <div>
            <h1>微缩交通沙盘 · 路网生成器</h1>
            <p>SolidJS × MapLibre GL JS · 地形贴合 / 角度约束 / 圆角转弯 / 全操作可撤销</p>
          </div>
        </div>
        <Toolbar />
      </header>
      <main class="app-main">
        <div class="region region-map">
          <div class="region-tag">地图视口</div>
          <MapView />
        </div>
        <aside class="region region-side">
          <div class="side-scroll">
            <IntersectionPanel />
            <RoadPanel />
            <NetworkGraph />
            <IoPanel />
          </div>
        </aside>
      </main>
    </div>
  )
}
