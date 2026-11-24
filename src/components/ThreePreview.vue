<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { getModel } from '../data/booths'
import { getMaterial } from '../data/materials'
import { boundaryMap, getTextOutline } from '../services/outlines'
import { fontState } from '../services/fonts'
import {
  selectFace,
  setHoveredFace,
  studio,
} from '../services/store'
import type { LaidFace } from '../types'

const hostRef = ref<HTMLDivElement | null>(null)
const webglError = ref('')

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let boothGroup: THREE.Group | null = null
let resizeObserver: ResizeObserver | null = null
let animationFrame = 0
let textureFrame = 0

interface FaceView3D {
  face: LaidFace
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>
}

interface TextOverlay {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  texture: THREE.CanvasTexture
  canvas: HTMLCanvasElement
  ppu: number
}

const faceViews = new Map<string, FaceView3D>()
const textOverlays = new Map<string, TextOverlay>()
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let pointerDown = { x: 0, y: 0 }

function materialFor(faceId: string): THREE.MeshStandardMaterial {
  const def = getMaterial(studio.doc.assignments[faceId])
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(def.color),
    metalness: def.metalness,
    roughness: def.roughness,
    transparent: (def.opacity ?? 1) < 1,
    opacity: def.opacity ?? 1,
    emissive: new THREE.Color(def.emissive ?? '#000000'),
    emissiveIntensity: def.emissiveIntensity ?? 0,
    side: THREE.DoubleSide,
  })
}

function paintHighlights() {
  const warningFaceIds = new Set(
    studio.doc.texts.filter((text) => boundaryMap[text.id]?.out).map((text) => text.faceId),
  )

  faceViews.forEach((view, faceId) => {
    const selected = studio.selectedFaceId === faceId
    const hovered = studio.hoveredFaceId === faceId
    const warning = warningFaceIds.has(faceId)
    const base = getMaterial(studio.doc.assignments[faceId])

    if (selected) {
      view.mesh.material.emissive.set(warning ? '#ef4444' : '#2563eb')
      view.mesh.material.emissiveIntensity = warning ? 0.34 : 0.24
      view.edges.material.color.set(warning ? '#ef4444' : '#1d4ed8')
      view.edges.material.opacity = 1
    } else if (warning) {
      view.mesh.material.emissive.set('#ef4444')
      view.mesh.material.emissiveIntensity = 0.18
      view.edges.material.color.set('#ef4444')
      view.edges.material.opacity = 0.95
    } else if (hovered) {
      view.mesh.material.emissive.set('#0ea5e9')
      view.mesh.material.emissiveIntensity = 0.16
      view.edges.material.color.set('#0284c7')
      view.edges.material.opacity = 0.9
    } else {
      view.mesh.material.emissive.set(base.emissive ?? '#000000')
      view.mesh.material.emissiveIntensity = base.emissiveIntensity ?? 0
      view.edges.material.color.set('#263449')
      view.edges.material.opacity = 0.32
    }
  })
}

function updateMaterials() {
  faceViews.forEach((view, faceId) => {
    const def = getMaterial(studio.doc.assignments[faceId])
    const mat = view.mesh.material
    mat.color.set(def.color)
    mat.metalness = def.metalness
    mat.roughness = def.roughness
    mat.opacity = def.opacity ?? 1
    mat.transparent = (def.opacity ?? 1) < 1
    mat.emissive.set(def.emissive ?? '#000000')
    mat.emissiveIntensity = def.emissiveIntensity ?? 0
    mat.needsUpdate = true
  })
  paintHighlights()
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else material?.dispose()
  })
}

function disposeTextOverlay(faceId: string) {
  const overlay = textOverlays.get(faceId)
  if (!overlay || !boothGroup) return
  boothGroup.remove(overlay.mesh)
  overlay.mesh.geometry.dispose()
  overlay.mesh.material.dispose()
  overlay.texture.dispose()
  textOverlays.delete(faceId)
}

function drawTextOverlay(face: LaidFace, overlay: TextOverlay) {
  const ctx = overlay.canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height)
  ctx.scale(overlay.ppu, overlay.ppu)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const text of studio.doc.texts.filter((item) => item.faceId === face.id)) {
    const outline = getTextOutline(text)
    ctx.save()
    ctx.translate(text.nx * face.width, text.ny * face.height)
    if (outline && outline.d) {
      const path = new Path2D(outline.d)
      const centerX = (outline.x1 + outline.x2) / 2
      const centerY = (outline.y1 + outline.y2) / 2
      ctx.translate(-centerX, -centerY)
      ctx.fillStyle = text.color
      if (text.bold) {
        ctx.strokeStyle = text.color
        ctx.lineWidth = Math.max(1, text.fontSize * 0.052)
        ctx.lineJoin = 'round'
        ctx.stroke(path)
      }
      ctx.fill(path)
    } else {
      ctx.fillStyle = text.color
      ctx.font = `${text.bold ? 700 : 500} ${text.fontSize}px "Noto Sans SC", sans-serif`
      const lines = text.content.split('\n')
      lines.forEach((line, index) => {
        ctx.fillText(line, 0, (index - (lines.length - 1) / 2) * text.fontSize * text.lineHeight)
      })
    }
    ctx.restore()
  }
  overlay.texture.needsUpdate = true
}

function syncTextOverlays() {
  if (!boothGroup) return
  const model = getModel(studio.modelId)
  const usedFaceIds = new Set(studio.doc.texts.map((text) => text.faceId))

  for (const faceId of [...textOverlays.keys()]) {
    if (!usedFaceIds.has(faceId)) disposeTextOverlay(faceId)
  }

  for (const faceId of usedFaceIds) {
    const face = model.faces.find((item) => item.id === faceId)
    const view = faceViews.get(faceId)
    if (!face || !view) continue

    let overlay = textOverlays.get(faceId)
    if (!overlay) {
      const ppu = Math.min(2048 / face.width, 2048 / face.height, 9)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(64, Math.round(face.width * ppu))
      canvas.height = Math.max(64, Math.round(face.height * ppu))
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() ?? 1)

      const geometry = view.mesh.geometry.clone()
      geometry.translate(face.normal[0] * 1.35, face.normal[1] * 1.35, face.normal[2] * 1.35)
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 10
      boothGroup.add(mesh)
      overlay = { mesh, texture, canvas, ppu }
      textOverlays.set(faceId, overlay)
    }
    drawTextOverlay(face, overlay)
  }
}

function scheduleTextOverlays() {
  window.cancelAnimationFrame(textureFrame)
  textureFrame = window.requestAnimationFrame(() => {
    syncTextOverlays()
  })
}

function createBooth() {
  if (!scene) return
  if (boothGroup) {
    scene.remove(boothGroup)
    disposeObject(boothGroup)
  }
  textOverlays.forEach((_overlay, id) => disposeTextOverlay(id))
  textOverlays.clear()
  faceViews.clear()

  const model = getModel(studio.modelId)
  boothGroup = new THREE.Group()
  boothGroup.name = model.name

  for (const face of model.faces) {
    const vertices = face.corners.flat()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 1,
      1, 1,
      1, 0,
      0, 0,
    ], 2))
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    geometry.computeVertexNormals()

    const mesh = new THREE.Mesh(geometry, materialFor(face.id))
    mesh.userData.faceId = face.id
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: '#263449', transparent: true, opacity: 0.32 }),
    )
    mesh.add(edges)
    boothGroup.add(mesh)
    faceViews.set(face.id, { face, mesh, edges })
  }

  // A thin presentation plinth beneath the booth.
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(model.width + 90, 18, model.depth + 90),
    new THREE.MeshStandardMaterial({ color: '#dfe6f1', roughness: 0.86, metalness: 0.02 }),
  )
  plinth.position.set(0, -11, 0)
  plinth.receiveShadow = false
  boothGroup.add(plinth)

  scene.add(boothGroup)
  frameCamera()
  syncTextOverlays()
  paintHighlights()
}

function frameCamera() {
  if (!camera || !controls) return
  const model = getModel(studio.modelId)
  const target = new THREE.Vector3(0, model.height * 0.43, 0)
  const boundingRadius = Math.max(model.width * 0.62, model.depth * 0.78, model.height * 0.72, 260)
  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov) / 2
  const fitVertical = boundingRadius / Math.sin(verticalHalfFov)
  const fitHorizontal = boundingRadius / (Math.sin(verticalHalfFov) * Math.max(0.35, camera.aspect))
  const distance = Math.max(fitVertical, fitHorizontal) * 1.04
  const direction = new THREE.Vector3(0.82, 0.5, 1).normalize()

  camera.position.copy(target).addScaledVector(direction, distance)
  camera.near = 1
  camera.far = 12000
  camera.updateProjectionMatrix()
  controls.target.copy(target)
  controls.minDistance = boundingRadius * 0.35
  controls.maxDistance = distance * 3.2
  controls.maxPolarAngle = Math.PI * 0.49
  controls.update()
}

function setPointerFromEvent(event: PointerEvent) {
  if (!renderer || !hostRef.value) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
}

function pickFace(event: PointerEvent): string | null {
  if (!renderer || !camera) return null
  setPointerFromEvent(event)
  raycaster.setFromCamera(pointer, camera)
  const meshes = [...faceViews.values()].map((view) => view.mesh)
  const hits = raycaster.intersectObjects(meshes, false)
  return (hits[0]?.object.userData.faceId as string | undefined) ?? null
}

function resetView() {
  frameCamera()
}

onMounted(() => {
  if (!hostRef.value) return
  try {
    const width = hostRef.value.clientWidth
    const height = hostRef.value.clientHeight
    scene = new THREE.Scene()
    scene.fog = new THREE.Fog('#eef3fb', 1500, 3600)

    camera = new THREE.PerspectiveCamera(42, width / Math.max(1, height), 1, 6000)
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    hostRef.value.appendChild(renderer.domElement)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = true
    controls.panSpeed = 0.7
    controls.rotateSpeed = 0.72

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8fa2bd, 2.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(520, 850, 620)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xbdd7ff, 1.1)
    fill.position.set(-620, 420, -420)
    scene.add(fill)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4200, 4200),
      new THREE.MeshStandardMaterial({ color: '#e9eef7', roughness: 0.96, metalness: 0 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -20.5
    scene.add(ground)

    const grid = new THREE.GridHelper(2400, 48, 0x91a4c3, 0xc7d2e2)
    grid.position.y = -20
    const gridMaterial = grid.material as THREE.Material
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.28
    scene.add(grid)

    createBooth()

    renderer.domElement.addEventListener('pointerdown', (event) => {
      pointerDown = { x: event.clientX, y: event.clientY }
    })
    renderer.domElement.addEventListener('pointerup', (event) => {
      const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y)
      if (moved > 6) return
      const faceId = pickFace(event)
      if (faceId) selectFace(faceId)
    })
    renderer.domElement.addEventListener('pointermove', (event) => {
      if (event.buttons) return
      const faceId = pickFace(event)
      setHoveredFace(faceId)
      renderer!.domElement.style.cursor = faceId ? 'pointer' : 'grab'
    })
    renderer.domElement.addEventListener('pointerleave', () => setHoveredFace(null))

    resizeObserver = new ResizeObserver(() => {
      if (!renderer || !camera || !hostRef.value) return
      const w = hostRef.value.clientWidth
      const h = hostRef.value.clientHeight
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    resizeObserver.observe(hostRef.value)

    const renderLoop = () => {
      controls?.update()
      if (renderer && scene && camera) renderer.render(scene, camera)
      animationFrame = requestAnimationFrame(renderLoop)
    }
    renderLoop()
  } catch (error) {
    console.error(error)
    webglError.value = error instanceof Error ? error.message : 'WebGL 初始化失败'
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  cancelAnimationFrame(textureFrame)
  resizeObserver?.disconnect()
  controls?.dispose()
  textOverlays.forEach((_overlay, id) => disposeTextOverlay(id))
  if (boothGroup) disposeObject(boothGroup)
  renderer?.dispose()
  renderer?.domElement.remove()
  renderer = null
})

watch(() => studio.modelId, createBooth)
watch(() => studio.doc.assignments, updateMaterials, { deep: true })
watch(
  () => [studio.selectedFaceId, studio.hoveredFaceId, Object.keys(boundaryMap).map((k) => boundaryMap[k]?.out).join(',')],
  paintHighlights,
)
watch(() => studio.doc.texts, scheduleTextOverlays, { deep: true })
watch(() => fontState.ready, scheduleTextOverlays)
</script>

<template>
  <section class="canvas-card three-card">
    <header class="canvas-header">
      <div>
        <p class="eyebrow">LIVE 3D PREVIEW</p>
        <h2>三维展台对照视图</h2>
      </div>
      <button type="button" class="fit-btn" @click="resetView">重置视角</button>
    </header>
    <div ref="hostRef" class="three-host" aria-label="三维展台预览"></div>
    <div v-if="webglError" class="webgl-error">
      当前浏览器无法启动 WebGL：{{ webglError }}。展开图、配色与方案功能仍可使用。
    </div>
    <div class="canvas-hint">拖动旋转 · 滚轮缩放 · 右键平移；点击三维面与展开图双向联动高亮。</div>
  </section>
</template>
