<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Konva from 'konva'
import { getModel } from '../data/booths'
import { getMaterial } from '../data/materials'
import { boundaryMap, getTextBoundary, getTextOutline, refreshBoundaryMap } from '../services/outlines'
import {
  selectFace,
  selectText,
  setHoveredFace,
  studio,
  updateText,
} from '../services/store'
import { fontState } from '../services/fonts'
import type { LaidFace, MaterialDef, TextBlock } from '../types'

const containerRef = ref<HTMLDivElement | null>(null)
const zoomLabel = ref('适配')

let stage: Konva.Stage | null = null
let layer: Konva.Layer | null = null
let viewport: Konva.Group | null = null
let faceGroup: Konva.Group | null = null
let textGroup: Konva.Group | null = null
let guideGroup: Konva.Group | null = null
let verticalGuide: Konva.Line | null = null
let horizontalGuide: Konva.Line | null = null
let resizeObserver: ResizeObserver | null = null
let cleanupWheel: (() => void) | null = null

let model = getModel(studio.modelId)
const faceViews = new Map<string, { group: Konva.Group; rect: Konva.Rect; face: LaidFace }>()
const textViews = new Map<string, TextNodeView>()
let draggingTextId: string | null = null

interface TextNodeView {
  group: Konva.Group
  content: Konva.Group
  hit: Konva.Rect
  box: Konva.Rect
  signature: string
}

function applyMaterial(rect: Konva.Rect, material: MaterialDef, width: number, height: number) {
  rect.fillLinearGradientStartPoint({ x: 0, y: 0 })
  rect.fillLinearGradientEndPoint({ x: width, y: height })
  rect.fillLinearGradientColorStops([0, material.color, 1, material.color2])
  rect.opacity(material.opacity ?? 1)
}

function currentScale(): number {
  return viewport?.scaleX() ?? 1
}

function updateZoomLabel() {
  zoomLabel.value = `${Math.round(currentScale() * 100)}%`
}

function fitView() {
  if (!stage || !viewport || !containerRef.value) return
  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight
  const padding = 54
  const scale = Math.min(
    (width - padding * 2) / model.sheet.width,
    (height - padding * 2) / model.sheet.height,
    1.15,
  )
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 0.35
  viewport.scale({ x: safeScale, y: safeScale })
  viewport.position({
    x: Math.max(16, (width - model.sheet.width * safeScale) / 2),
    y: Math.max(12, (height - model.sheet.height * safeScale) / 2),
  })
  updateZoomLabel()
}

function zoomBy(factor: number) {
  if (!stage || !viewport || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const pointer = { x: rect.width / 2, y: rect.height / 2 }
  const oldScale = viewport.scaleX()
  const newScale = Math.min(2.6, Math.max(0.12, oldScale * factor))
  const worldX = (pointer.x - viewport.x()) / oldScale
  const worldY = (pointer.y - viewport.y()) / oldScale
  viewport.scale({ x: newScale, y: newScale })
  viewport.position({
    x: pointer.x - worldX * newScale,
    y: pointer.y - worldY * newScale,
  })
  updateZoomLabel()
}

function zoomIn() { zoomBy(1.18) }
function zoomOut() { zoomBy(1 / 1.18) }

function paintFaceStates() {
  const warningFaceIds = new Set(
    studio.doc.texts.filter((text) => boundaryMap[text.id]?.out).map((text) => text.faceId),
  )

  faceViews.forEach((view, faceId) => {
    const selected = studio.selectedFaceId === faceId
    const hovered = studio.hoveredFaceId === faceId
    const warning = warningFaceIds.has(faceId)
    const rect = view.rect

    if (selected && warning) {
      rect.stroke('#ef4444')
      rect.strokeWidth(4.5 / currentScale() * Math.min(1, currentScale() * 2.2))
      rect.dash([14, 8])
      rect.shadowColor('rgba(239,68,68,.55)')
      rect.shadowBlur(24)
      rect.shadowOpacity(0.7)
    } else if (selected) {
      rect.stroke('#2563eb')
      rect.strokeWidth(4)
      rect.dash([])
      rect.shadowColor('rgba(37,99,235,.42)')
      rect.shadowBlur(22)
      rect.shadowOpacity(0.65)
    } else if (warning) {
      rect.stroke('#ef4444')
      rect.strokeWidth(3.2)
      rect.dash([13, 8])
      rect.shadowColor('rgba(239,68,68,.35)')
      rect.shadowBlur(16)
      rect.shadowOpacity(0.55)
    } else if (hovered) {
      rect.stroke('#0ea5e9')
      rect.strokeWidth(3)
      rect.dash([])
      rect.shadowColor('rgba(14,165,233,.28)')
      rect.shadowBlur(14)
      rect.shadowOpacity(0.5)
    } else {
      rect.stroke('rgba(15,23,42,.30)')
      rect.strokeWidth(1.4)
      rect.dash([])
      rect.shadowBlur(0)
      rect.shadowOpacity(0)
    }
  })
  layer?.batchDraw()
}

function paintMaterials() {
  faceViews.forEach((view, faceId) => {
    const material = getMaterial(studio.doc.assignments[faceId])
    applyMaterial(view.rect, material, view.face.width, view.face.height)
  })
  layer?.batchDraw()
}

function hideGuides() {
  verticalGuide?.visible(false)
  horizontalGuide?.visible(false)
}

function showGuides(face: LaidFace, nx: number, ny: number, halfWidth: number, halfHeight: number) {
  if (!verticalGuide || !horizontalGuide || !guideGroup) return
  const candidatesX = [
    { value: halfWidth / face.width, pos: face.rect.x },
    { value: 0.5, pos: face.rect.x + face.rect.width / 2 },
    { value: 1 - halfWidth / face.width, pos: face.rect.x + face.rect.width },
  ]
  const candidatesY = [
    { value: halfHeight / face.height, pos: face.rect.y },
    { value: 0.5, pos: face.rect.y + face.rect.height / 2 },
    { value: 1 - halfHeight / face.height, pos: face.rect.y + face.rect.height },
  ]
  const toleranceX = 13 / Math.max(0.25, currentScale())
  const toleranceY = 13 / Math.max(0.25, currentScale())
  const snapX = candidatesX.find((candidate) => Math.abs(candidate.value - nx) * face.width < toleranceX)
  const snapY = candidatesY.find((candidate) => Math.abs(candidate.value - ny) * face.height < toleranceY)

  if (snapX) {
    verticalGuide.points([snapX.pos, face.rect.y - 12, snapX.pos, face.rect.y + face.rect.height + 12])
    verticalGuide.visible(true)
  } else {
    verticalGuide.visible(false)
  }
  if (snapY) {
    horizontalGuide.points([face.rect.x - 12, snapY.pos, face.rect.x + face.rect.width + 12, snapY.pos])
    horizontalGuide.visible(true)
  } else {
    horizontalGuide.visible(false)
  }
  return { snapX: snapX?.value, snapY: snapY?.value }
}

function renderTextContent(view: TextNodeView, text: TextBlock) {
  view.content.destroyChildren()
  const outline = getTextOutline(text)

  if (outline && outline.d) {
    const path = new Konva.Path({
      data: outline.d,
      fill: text.color,
      stroke: text.color,
      strokeWidth: text.bold ? Math.max(1.2, text.fontSize * 0.045) : 0,
      lineJoin: 'round',
      lineCap: 'round',
      listening: false,
      perfectDrawEnabled: false,
    })
    path.offsetX((outline.x1 + outline.x2) / 2)
    path.offsetY((outline.y1 + outline.y2) / 2)
    view.content.add(path)
    const padX = Math.max(16, text.fontSize * 0.34)
    const padY = Math.max(12, text.fontSize * 0.24)
    const w = outline.width + padX * 2
    const h = outline.height + padY * 2
    view.hit.setAttrs({ x: -w / 2, y: -h / 2, width: w, height: h })
    view.box.setAttrs({ x: -w / 2, y: -h / 2, width: w, height: h, cornerRadius: 8 })
  } else {
    const fallback = new Konva.Text({
      text: text.content,
      fontSize: text.fontSize,
      fontStyle: text.bold ? '700' : '400',
      fontFamily: text.fontId === 'montserrat' ? 'Montserrat, sans-serif' : '"Noto Sans SC", sans-serif',
      fill: text.color,
      listening: false,
      align: 'center',
      verticalAlign: 'middle',
    })
    fallback.offsetX(fallback.width() / 2)
    fallback.offsetY(fallback.height() / 2)
    view.content.add(fallback)
    const w = fallback.width() + 24
    const h = fallback.height() + 18
    view.hit.setAttrs({ x: -w / 2, y: -h / 2, width: w, height: h })
    view.box.setAttrs({ x: -w / 2, y: -h / 2, width: w, height: h, cornerRadius: 8 })
  }

  const boundary = boundaryMap[text.id]
  const selected = studio.selectedTextId === text.id
  view.box.stroke(boundary?.out ? '#ef4444' : selected ? '#2563eb' : 'rgba(37,99,235,0)')
  view.box.strokeWidth(boundary?.out || selected ? 2.4 : 0)
  view.box.dash(boundary?.out ? [10, 6] : [])
  view.signature = [text.content, text.fontId, text.fontSize, text.letterSpacing, text.lineHeight, text.bold].join('|')
}

function syncTexts() {
  if (!textGroup) return
  const faceMap = new Map(model.faces.map((face) => [face.id, face]))
  refreshBoundaryMap(studio.doc.texts, faceMap)
  const alive = new Set<string>()

  studio.doc.texts.forEach((text) => {
    const face = faceMap.get(text.faceId)
    if (!face) return
    alive.add(text.id)
    let view = textViews.get(text.id)

    if (!view) {
      const group = new Konva.Group({ draggable: true, id: `text-${text.id}` })
      const box = new Konva.Rect({ listening: false, fill: 'rgba(37,99,235,0.04)' })
      const content = new Konva.Group({ listening: false })
      const hit = new Konva.Rect({ fill: 'rgba(37,99,235,0.001)', name: 'text-hit' })
      group.add(box)
      group.add(content)
      group.add(hit)
      textGroup!.add(group)
      view = { group, content, hit, box, signature: '' }
      textViews.set(text.id, view)

      group.on('click tap', (event) => {
        event.cancelBubble = true
        selectText(text.id)
      })
      group.on('dragstart', (event) => {
        event.cancelBubble = true
        draggingTextId = text.id
        selectText(text.id)
        group.moveToTop()
      })
      group.on('dragmove', () => {
        const currentFace = faceMap.get(text.faceId)
        if (!currentFace) return
        let nx = (group.x() - currentFace.rect.x) / currentFace.rect.width
        let ny = (group.y() - currentFace.rect.y) / currentFace.rect.height
        const outline = getTextOutline(text)
        const halfWidth = outline ? outline.width / 2 + 10 : 40
        const halfHeight = outline ? outline.height / 2 + 8 : 24
        const snapped = showGuides(currentFace, nx, ny, halfWidth, halfHeight)
        if (snapped?.snapX !== undefined) nx = snapped.snapX
        if (snapped?.snapY !== undefined) ny = snapped.snapY
        // Keep a dragged block recoverable while still allowing it to cross the face edge.
        nx = Math.min(1.35, Math.max(-0.35, nx))
        ny = Math.min(1.45, Math.max(-0.45, ny))
        group.x(currentFace.rect.x + nx * currentFace.rect.width)
        group.y(currentFace.rect.y + ny * currentFace.rect.height)
        const nextBoundary = getTextBoundary({ ...text, nx, ny }, currentFace)
        boundaryMap[text.id] = nextBoundary
        view?.box.stroke(nextBoundary.out ? '#ef4444' : '#2563eb')
        view?.box.dash(nextBoundary.out ? [10, 6] : [])
      })
      group.on('dragend', () => {
        const currentFace = faceMap.get(text.faceId)
        hideGuides()
        if (currentFace) {
          const nx = (group.x() - currentFace.rect.x) / currentFace.rect.width
          const ny = (group.y() - currentFace.rect.y) / currentFace.rect.height
          updateText(text.id, { nx, ny })
        }
        draggingTextId = null
        paintFaceStates()
      })
      group.on('mouseenter', () => {
        if (containerRef.value) containerRef.value.style.cursor = 'move'
      })
      group.on('mouseleave', () => {
        if (containerRef.value && draggingTextId !== text.id) containerRef.value.style.cursor = 'default'
      })
    }

    const signature = [text.content, text.fontId, text.fontSize, text.letterSpacing, text.lineHeight, text.bold].join('|')
    if (view.signature !== signature) renderTextContent(view, text)

    if (draggingTextId !== text.id) {
      view.group.position({
        x: face.rect.x + text.nx * face.rect.width,
        y: face.rect.y + text.ny * face.rect.height,
      })
    }
  })

  textViews.forEach((view, id) => {
    if (!alive.has(id)) {
      view.group.destroy()
      textViews.delete(id)
    }
  })
  paintFaceStates()
  layer?.batchDraw()
}

function buildFaces() {
  if (!viewport) return
  faceGroup = new Konva.Group({ name: 'faces' })
  textGroup = new Konva.Group({ name: 'texts' })
  guideGroup = new Konva.Group({ name: 'guides', listening: false })
  viewport.add(faceGroup)
  viewport.add(textGroup)
  viewport.add(guideGroup)

  verticalGuide = new Konva.Line({ stroke: '#2563eb', strokeWidth: 2, dash: [8, 6], visible: false, listening: false })
  horizontalGuide = new Konva.Line({ stroke: '#2563eb', strokeWidth: 2, dash: [8, 6], visible: false, listening: false })
  guideGroup.add(verticalGuide, horizontalGuide)

  faceViews.clear()
  textViews.clear()

  const sheet = new Konva.Rect({
    x: 20,
    y: 20,
    width: model.sheet.width - 40,
    height: model.sheet.height - 40,
    cornerRadius: 22,
    fill: '#f8fafc',
    stroke: 'rgba(15,23,42,.10)',
    strokeWidth: 1,
    shadowColor: 'rgba(15,23,42,.16)',
    shadowBlur: 34,
    shadowOffsetY: 14,
    name: 'pan-background',
  })
  viewport.add(sheet)
  sheet.moveToBottom()

  model.faces.forEach((face) => {
    const material = getMaterial(studio.doc.assignments[face.id])
    const group = new Konva.Group({ x: face.rect.x, y: face.rect.y })
    const rect = new Konva.Rect({
      width: face.rect.width,
      height: face.rect.height,
      cornerRadius: 5,
      name: `face-${face.id}`,
    })
    applyMaterial(rect, material, face.rect.width, face.rect.height)

    const label = new Konva.Label({ x: 0, y: -27, listening: false })
    label.add(new Konva.Tag({ fill: 'rgba(255,255,255,.86)', cornerRadius: 7, stroke: 'rgba(15,23,42,.08)' }))
    label.add(new Konva.Text({
      text: face.name,
      fontSize: 14,
      fontStyle: '600',
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      fill: '#334155',
      padding: 6,
    }))

    group.add(rect)
    group.add(label)
    group.on('click tap', (event) => {
      event.cancelBubble = true
      selectFace(face.id)
    })
    group.on('mouseenter', () => {
      setHoveredFace(face.id)
      if (containerRef.value) containerRef.value.style.cursor = 'pointer'
      paintFaceStates()
    })
    group.on('mouseleave', () => {
      setHoveredFace(null)
      if (containerRef.value) containerRef.value.style.cursor = 'default'
      paintFaceStates()
    })
    faceGroup!.add(group)
    faceViews.set(face.id, { group, rect, face })
  })

  paintFaceStates()
  syncTexts()
}

function rebuildModel() {
  model = getModel(studio.modelId)
  if (!viewport) return
  hideGuides()
  viewport.destroyChildren()
  faceViews.clear()
  textViews.clear()
  buildFaces()
  fitView()
}

function setupPan() {
  if (!stage || !containerRef.value) return
  let panning = false
  let lastX = 0
  let lastY = 0

  stage.on('mousedown', (event) => {
    const targetName = event.target.name()
    if (targetName === 'pan-background' || event.target === stage) {
      panning = true
      const pointer = stage!.getPointerPosition()
      lastX = pointer?.x ?? 0
      lastY = pointer?.y ?? 0
      containerRef.value!.style.cursor = 'grabbing'
    }
  })
  stage.on('mousemove', () => {
    if (!panning || !viewport || !stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    viewport.x(viewport.x() + pointer.x - lastX)
    viewport.y(viewport.y() + pointer.y - lastY)
    lastX = pointer.x
    lastY = pointer.y
  })
  const endPan = () => {
    panning = false
    if (containerRef.value) containerRef.value.style.cursor = 'default'
  }
  stage.on('mouseup mouseleave', endPan)
}

onMounted(() => {
  if (!containerRef.value) return
  const { clientWidth: width, clientHeight: height } = containerRef.value
  stage = new Konva.Stage({ container: containerRef.value, width, height })
  ;(window as unknown as { __konvaStage?: Konva.Stage | null }).__konvaStage = stage
  layer = new Konva.Layer()
  stage.add(layer)
  viewport = new Konva.Group()
  layer.add(viewport)

  const background = new Konva.Rect({
    x: -5000,
    y: -5000,
    width: 12000,
    height: 12000,
    fill: 'transparent',
    name: 'pan-background',
  })
  viewport.add(background)

  buildFaces()
  setupPan()
  fitView()

  const wheelHandler = (event: WheelEvent) => {
    event.preventDefault()
    if (!viewport || !stage || !containerRef.value) return
    const rect = containerRef.value.getBoundingClientRect()
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const oldScale = viewport.scaleX()
    const factor = event.deltaY < 0 ? 1.09 : 1 / 1.09
    const newScale = Math.min(2.6, Math.max(0.12, oldScale * factor))
    const worldX = (pointer.x - viewport.x()) / oldScale
    const worldY = (pointer.y - viewport.y()) / oldScale
    viewport.scale({ x: newScale, y: newScale })
    viewport.position({ x: pointer.x - worldX * newScale, y: pointer.y - worldY * newScale })
    updateZoomLabel()
  }
  containerRef.value.addEventListener('wheel', wheelHandler, { passive: false })
  cleanupWheel = () => containerRef.value?.removeEventListener('wheel', wheelHandler)

  resizeObserver = new ResizeObserver(() => {
    if (!stage || !containerRef.value) return
    stage.width(containerRef.value.clientWidth)
    stage.height(containerRef.value.clientHeight)
    layer?.batchDraw()
  })
  resizeObserver.observe(containerRef.value)
})

onBeforeUnmount(() => {
  cleanupWheel?.()
  resizeObserver?.disconnect()
  stage?.destroy()
  ;(window as unknown as { __konvaStage?: Konva.Stage | null }).__konvaStage = null
  stage = null
})

watch(() => studio.modelId, rebuildModel)
watch(() => studio.doc.assignments, paintMaterials, { deep: true })
watch(
  () => [studio.selectedFaceId, studio.hoveredFaceId, studio.selectedTextId, Object.keys(boundaryMap).map((k) => boundaryMap[k]?.out).join(',')],
  paintFaceStates,
)
watch(() => studio.doc.texts, syncTexts, { deep: true })
watch(() => fontState.ready, syncTexts)
</script>

<template>
  <section class="canvas-card unfolded-card">
    <header class="canvas-header">
      <div>
        <p class="eyebrow">UNFOLDED ELEVATIONS</p>
        <h2>立面 / 顶面展开图</h2>
      </div>
      <div class="canvas-meta">
        <span>{{ model.faces.length }} 个面</span>
        <span>{{ studio.doc.texts.length }} 个文字块</span>
      </div>
    </header>
    <div ref="containerRef" class="konva-container" aria-label="展台展开图画布"></div>
    <div class="zoom-toolbar">
      <button type="button" class="icon-btn" title="缩小" @click="zoomOut">−</button>
      <span class="zoom-value">{{ zoomLabel }}</span>
      <button type="button" class="icon-btn" title="放大" @click="zoomIn">＋</button>
      <button type="button" class="fit-btn" title="适配画布" @click="fitView">适配</button>
    </div>
    <div class="canvas-hint">拖动文字可排版；靠近中线或边界会吸附，红色虚线表示超出立面。</div>
  </section>
</template>
