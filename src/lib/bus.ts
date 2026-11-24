// 跨组件事件总线:路网图点击 → 地图视口定位等
type Handler = (payload: { x: number; y: number; nodeId: string }) => void

const handlers = new Set<Handler>()

export function onLocate(h: Handler): () => void {
  handlers.add(h)
  return () => handlers.delete(h)
}

export function emitLocate(payload: { x: number; y: number; nodeId: string }) {
  for (const h of handlers) h(payload)
}
