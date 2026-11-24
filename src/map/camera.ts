import maplibregl from 'maplibre-gl'
import { localToLngLat } from '../lib/projection'
import { SANDBOX_SIZE } from '../constants'
import type { Map as MLMap } from 'maplibre-gl'

/** 视口定位到沙盘本地坐标,保持当前俯仰/缩放 */
export function flyToLocal(map: MLMap, x: number, y: number) {
  const ll = localToLngLat(
    Math.max(0, Math.min(SANDBOX_SIZE, x)),
    Math.max(0, Math.min(SANDBOX_SIZE, y))
  )
  map.easeTo({ center: [ll.lng, ll.lat], duration: 650, essential: true })
}

export function createSandboxMap(container: HTMLElement): MLMap {
  const center = localToLngLat(SANDBOX_SIZE / 2, SANDBOX_SIZE / 2)
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      name: 'blank',
      sources: {},
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#0e1726' }
        }
      ],
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
    },
    center: [center.lng, center.lat],
    zoom: 15.4,
    pitch: 58,
    bearing: -22,
    antialias: true,
    attributionControl: false,
    maxZoom: 18.6,
    minZoom: 12.5,
    dragPan: false,
    dragRotate: false,
    touchZoomRotate: true,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false
  })
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')
  return map
}
