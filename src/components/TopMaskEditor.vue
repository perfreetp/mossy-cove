<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { HEIGHT_RES, MASK_RES } from '../constants'
import { sceneManagerRef } from '../babylon/bridge'
import { base64ToBytes, bytesToBase64 } from '../terrain/maskCodec'
import { history, project, selectedBandId } from '../state/store'
import type { BrushMode } from '../types'

const VIEW_RES = 256

const baseCanvasRef = ref<HTMLCanvasElement | null>(null)
const paintCanvasRef = ref<HTMLCanvasElement | null>(null)

const brushSize = ref(30)
const hardness = ref(0.62)
const brushMode = ref<BrushMode>('erase')
const cursor = ref<{ x: number; y: number } | null>(null)

let maskBytes = new Uint8Array(MASK_RES * MASK_RES).fill(255)
let drawing = false
let lastPoint: { x: number; y: number } | null = null

const selectedBand = computed(() => {
  return project.value.bands.find((band) => band.id === selectedBandId.value) ?? project.value.bands[0]
})

function loadMask(): void {
  if (!selectedBand.value) return
  maskBytes.set(base64ToBytes(selectedBand.value.mask, MASK_RES * MASK_RES))
  renderMask()
}

function renderBase(): void {
  const canvas = baseCanvasRef.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return

  const small = document.createElement('canvas')
  small.width = HEIGHT_RES
  small.height = HEIGHT_RES
  const smallContext = small.getContext('2d')
  if (!smallContext) return
  const image = smallContext.createImageData(HEIGHT_RES, HEIGHT_RES)

  const heights = project.value.heights
  for (let y = 0; y < HEIGHT_RES; y += 1) {
    for (let x = 0; x < HEIGHT_RES; x += 1) {
      const index = y * HEIGHT_RES + x
      const h = heights[index] ?? 0
      const left = heights[y * HEIGHT_RES + Math.max(0, x - 1)] ?? h
      const right = heights[y * HEIGHT_RES + Math.min(HEIGHT_RES - 1, x + 1)] ?? h
      const up = heights[Math.max(0, y - 1) * HEIGHT_RES + x] ?? h
      const down = heights[Math.min(HEIGHT_RES - 1, y + 1) * HEIGHT_RES + x] ?? h
      const shade = Math.max(0.58, Math.min(1.12, 1 + (left - right + up - down) * 1.7))

      let r: number
      let g: number
      let b: number
      if (h < 0.3) {
        const t = h / 0.3
        r = 31 + (74 - 31) * t
        g = 74 + (116 - 74) * t
        b = 49 + (77 - 49) * t
      } else if (h < 0.66) {
        const t = (h - 0.3) / 0.36
        r = 74 + (132 - 74) * t
        g = 116 + (112 - 116) * t
        b = 77 + (88 - 77) * t
      } else {
        const t = (h - 0.66) / 0.34
        r = 132 + (238 - 132) * t
        g = 124 + (242 - 124) * t
        b = 104 + (248 - 104) * t
      }

      const offset = index * 4
      image.data[offset] = Math.round(r * shade)
      image.data[offset + 1] = Math.round(g * shade)
      image.data[offset + 2] = Math.round(b * shade)
      image.data[offset + 3] = 255
    }
  }
  smallContext.putImageData(image, 0, 0)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.clearRect(0, 0, VIEW_RES, VIEW_RES)
  context.drawImage(small, 0, 0, VIEW_RES, VIEW_RES)
}

function renderMask(): void {
  const canvas = paintCanvasRef.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return

  context.clearRect(0, 0, VIEW_RES, VIEW_RES)
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = MASK_RES
  maskCanvas.height = MASK_RES
  const maskContext = maskCanvas.getContext('2d')
  if (!maskContext) return
  const image = maskContext.createImageData(MASK_RES, MASK_RES)
  for (let i = 0; i < maskBytes.length; i += 1) {
    const value = maskBytes[i]
    image.data[i * 4] = 126
    image.data[i * 4 + 1] = 232
    image.data[i * 4 + 2] = 255
    image.data[i * 4 + 3] = Math.round((value / 255) * 118)
  }
  maskContext.putImageData(image, 0, 0)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(maskCanvas, 0, 0, VIEW_RES, VIEW_RES)

  if (cursor.value) {
    const scale = VIEW_RES / MASK_RES
    const radius = (brushSize.value / 2) * scale
    const x = cursor.value.x * scale
    const y = cursor.value.y * scale
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.strokeStyle = 'rgba(8, 15, 28, 0.8)'
    context.lineWidth = 3
    context.stroke()
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.strokeStyle = 'rgba(255,255,255,0.96)'
    context.lineWidth = 1.4
    context.stroke()
  }
}

function eventToMaskPoint(event: PointerEvent): { x: number; y: number } {
  const canvas = paintCanvasRef.value!
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) / rect.width) * MASK_RES,
    y: ((event.clientY - rect.top) / rect.height) * MASK_RES,
  }
}

function paintAt(centerX: number, centerY: number): void {
  const radius = brushSize.value / 2
  const innerRadius = radius * hardness.value
  const minX = Math.max(0, Math.floor(centerX - radius))
  const maxX = Math.min(MASK_RES - 1, Math.ceil(centerX + radius))
  const minY = Math.max(0, Math.floor(centerY - radius))
  const maxY = Math.min(MASK_RES - 1, Math.ceil(centerY + radius))

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY)
      if (distance > radius) continue
      let alpha = 1
      if (distance > innerRadius && radius > innerRadius) {
        const t = (distance - innerRadius) / (radius - innerRadius)
        alpha = 1 - t * t * (3 - 2 * t)
      }
      const index = y * MASK_RES + x
      if (brushMode.value === 'add') {
        maskBytes[index] = Math.max(maskBytes[index], Math.round(alpha * 255))
      } else {
        maskBytes[index] = Math.min(maskBytes[index], Math.round((1 - alpha) * 255))
      }
    }
  }
}

function paintLine(from: { x: number; y: number }, to: { x: number; y: number }): void {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const steps = Math.max(1, Math.ceil(distance / Math.max(1.5, brushSize.value * 0.16)))
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    paintAt(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
  }
}

function onPointerDown(event: PointerEvent): void {
  if (!selectedBand.value) return
  event.preventDefault()
  ;(event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId)
  history.begin()
  drawing = true
  const point = eventToMaskPoint(event)
  cursor.value = point
  lastPoint = point
  paintAt(point.x, point.y)
  renderMask()
  sceneManagerRef.value?.previewMask(selectedBand.value.id, maskBytes)
}

function onPointerMove(event: PointerEvent): void {
  const point = eventToMaskPoint(event)
  cursor.value = point
  if (drawing && lastPoint) {
    paintLine(lastPoint, point)
    lastPoint = point
    renderMask()
    if (selectedBand.value) sceneManagerRef.value?.previewMask(selectedBand.value.id, maskBytes)
  } else {
    renderMask()
  }
}

function finishStroke(event?: PointerEvent): void {
  if (!drawing) return
  drawing = false
  lastPoint = null
  if (event?.currentTarget && 'releasePointerCapture' in event.currentTarget) {
    try {
      ;(event.currentTarget as HTMLCanvasElement).releasePointerCapture(event.pointerId)
    } catch {
      // Pointer may already have been released by the browser.
    }
  }
  if (selectedBand.value) {
    selectedBand.value.mask = bytesToBase64(maskBytes)
    history.commit('涂抹云带遮罩')
  }
}

function onPointerLeave(): void {
  if (!drawing) {
    cursor.value = null
    renderMask()
  }
}

function fillMask(value: 0 | 255): void {
  const band = selectedBand.value
  if (!band) return
  history.run(value === 255 ? '填满云带遮罩' : '清空云带遮罩', () => {
    if (value === 255) {
      band.mask = ''
    } else {
      const bytes = new Uint8Array(MASK_RES * MASK_RES)
      band.mask = bytesToBase64(bytes)
    }
  })
  loadMask()
}

function invertMask(): void {
  const band = selectedBand.value
  if (!band) return
  history.run('反相云带遮罩', () => {
    const bytes = base64ToBytes(band.mask, MASK_RES * MASK_RES)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = 255 - bytes[i]
    band.mask = bytesToBase64(bytes)
  })
  loadMask()
}

watch(selectedBandId, loadMask)
watch(() => selectedBand.value?.mask, loadMask)
watch(() => project.value.heights, renderBase)
watch([brushSize, hardness], renderMask)

onMounted(() => {
  renderBase()
  loadMask()
})
</script>

<template>
  <div v-if="selectedBand" class="mask-editor">
    <div class="mask-editor__head">
      <strong>地形俯视图 · {{ selectedBand.name }}</strong>
      <span>白/青色 = 允许成云</span>
    </div>

    <div class="canvas-stack">
      <canvas ref="baseCanvasRef" :width="VIEW_RES" :height="VIEW_RES" class="mask-canvas mask-canvas--base" />
      <canvas
        ref="paintCanvasRef"
        :width="VIEW_RES"
        :height="VIEW_RES"
        class="mask-canvas mask-canvas--paint"
        aria-label="云带遮罩笔刷俯视图"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="finishStroke"
        @pointercancel="finishStroke"
        @pointerleave="onPointerLeave"
      />
    </div>

    <div class="segmented segmented--two">
      <button type="button" :class="{ active: brushMode === 'erase' }" @click="brushMode = 'erase'">
        擦除云区
      </button>
      <button type="button" :class="{ active: brushMode === 'add' }" @click="brushMode = 'add'">
        绘制云区
      </button>
    </div>

    <label class="mini-slider">
      <span>笔刷大小 <b>{{ brushSize }}px</b></span>
      <input v-model.number="brushSize" type="range" min="6" max="82" step="1" />
    </label>
    <label class="mini-slider">
      <span>边缘软硬 <b>{{ Math.round(hardness * 100) }}%</b></span>
      <input v-model.number="hardness" type="range" min="0" max="1" step="0.01" />
    </label>

    <div class="mask-actions">
      <button type="button" class="button button--subtle" @click="fillMask(255)">填满</button>
      <button type="button" class="button button--subtle" @click="fillMask(0)">清空</button>
      <button type="button" class="button button--subtle" @click="invertMask">反相</button>
    </div>
    <p class="fine-print">笔刷遮罩会与高度深度遮挡相乘：黑色区域无云，山体高于云带的部分仍由深度缓冲自动遮住云层。</p>
  </div>
</template>
