import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { toBufferGeometry } from '../lib/geometry'
import type { ControlPoint, MeshGeometryData, Vec3Tuple } from '../lib/types'

export interface LesionViewStyle {
  color: string
  visible: boolean
  highlighted: boolean
  selected: boolean
  opacity?: number
}

interface ViewerCallbacks {
  onSurfacePick?: (position: Vec3Tuple, normal: Vec3Tuple) => void
  onSectionPositionChange?: (position: number) => void
  onSectionDragStateChange?: (dragging: boolean) => void
}

export class Viewer {
  private container: HTMLElement
  private callbacks: ViewerCallbacks
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private resizeObserver: ResizeObserver
  private animationFrame = 0
  private animationStart = performance.now()

  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private pickEnabled = false
  private downPoint = { x: 0, y: 0 }
  private pointerDown = false

  private organMesh: THREE.Mesh | null = null
  private organCenter = new THREE.Vector3()
  private organRadius = 50
  private lesionGroup = new THREE.Group()
  private lesionMeshes = new Map<string, THREE.Mesh>()
  private lesionOutlineLines = new Map<string, THREE.LineSegments>()

  private draftGroup = new THREE.Group()
  private contourGroup = new THREE.Group()
  private organOutline: THREE.LineSegments | null = null

  private clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e9)
  private sectionNormal = new THREE.Vector3(1, 0, 0)
  private sectionPosition = 0
  private sectionRange = 100
  private sectionHelperSize = 120
  private sectionInteractive = false
  private sectionHelper = new THREE.Group()
  private sectionPlaneMesh: THREE.Mesh | null = null
  private sectionHandle: THREE.Mesh | null = null
  private dragState:
    | { mode: 'section'; startClientX: number; startClientY: number; startPosition: number; startHit: THREE.Vector3 }
    | null = null

  private sharedSphereGeometry = new THREE.SphereGeometry(1, 18, 12)

  constructor(container: HTMLElement, callbacks: ViewerCallbacks = {}) {
    this.container = container
    this.callbacks = callbacks

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 600)
    this.renderer.localClippingEnabled = true
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.domElement.className = 'three-canvas'
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x0b1220)
    this.scene.fog = new THREE.Fog(0x0b1220, 500, 1400)

    this.camera = new THREE.PerspectiveCamera(45, (container.clientWidth || 800) / (container.clientHeight || 600), 0.1, 5000)
    this.camera.position.set(130, 90, 170)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.screenSpacePanning = true
    this.controls.minDistance = 5
    this.controls.maxDistance = 1200

    this.addLights()
    this.addReferenceGrid()
    this.scene.add(this.lesionGroup, this.draftGroup, this.contourGroup, this.sectionHelper)
    this.createSectionHelper()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)

    const dom = this.renderer.domElement
    dom.addEventListener('pointerdown', this.handlePointerDown, { capture: true })
    dom.addEventListener('pointermove', this.handlePointerMove)
    dom.addEventListener('pointerup', this.handlePointerUp)
    dom.addEventListener('pointercancel', this.handlePointerCancel)

    this.animate()
  }

  private addLights() {
    this.scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.65))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(160, 220, 180)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0x7dd3fc, 0.85)
    fill.position.set(-180, 80, -120)
    this.scene.add(fill)
    const rim = new THREE.DirectionalLight(0xf0abfc, 0.55)
    rim.position.set(40, -120, 160)
    this.scene.add(rim)
  }

  private addReferenceGrid() {
    const grid = new THREE.GridHelper(500, 25, 0x334155, 0x1e293b)
    grid.position.y = -72
    const material = grid.material as THREE.Material
    material.transparent = true
    material.opacity = 0.35
    this.scene.add(grid)
  }

  private createSectionHelper() {
    const planeGeometry = new THREE.PlaneGeometry(1, 1)
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.sectionPlaneMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    this.sectionPlaneMesh.scale.setScalar(this.sectionHelperSize)
    this.sectionPlaneMesh.renderOrder = 8
    this.sectionHelper.add(this.sectionPlaneMesh)

    const borderGeometry = new THREE.EdgesGeometry(planeGeometry)
    const border = new THREE.LineSegments(
      borderGeometry,
      new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.95, depthTest: false }),
    )
    border.scale.setScalar(this.sectionHelperSize)
    border.renderOrder = 10
    this.sectionHelper.add(border)

    this.sectionHandle = new THREE.Mesh(
      this.sharedSphereGeometry,
      new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x0891b2, emissiveIntensity: 0.7, roughness: 0.25 }),
    )
    this.sectionHandle.scale.setScalar(4)
    this.sectionHandle.renderOrder = 11
    this.sectionHelper.add(this.sectionHandle)
    this.sectionHelper.visible = false
    this.updateSectionHelperTransform()
  }

  setOrgan(data: MeshGeometryData | null) {
    if (this.organMesh) {
      this.scene.remove(this.organMesh)
      this.organMesh.geometry.dispose()
      ;(this.organMesh.material as THREE.Material).dispose()
      this.organMesh = null
    }
    if (this.organOutline) {
      this.scene.remove(this.organOutline)
      this.organOutline.geometry.dispose()
      ;(this.organOutline.material as THREE.Material).dispose()
      this.organOutline = null
    }
    if (!data) return

    const geometry = toBufferGeometry(data)
    const material = new THREE.MeshStandardMaterial({
      color: 0xd98b7a,
      roughness: 0.68,
      metalness: 0.03,
      transparent: true,
      opacity: 0.43,
      side: THREE.DoubleSide,
      depthWrite: false,
      clippingPlanes: [this.clipPlane],
    })
    this.organMesh = new THREE.Mesh(geometry, material)
    this.organMesh.renderOrder = 1
    this.scene.add(this.organMesh)

    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    box.getCenter(this.organCenter)
    const sphere = new THREE.Sphere()
    box.getBoundingSphere(sphere)
    this.organRadius = Math.max(sphere.radius, 10)
    this.sectionRange = this.organRadius * 1.05
    this.sectionHelperSize = this.organRadius * 2.5
    if (this.sectionPlaneMesh) this.sectionPlaneMesh.scale.setScalar(this.sectionHelperSize)
    this.sectionHelper.children.forEach((child) => {
      if (child instanceof THREE.LineSegments) child.scale.setScalar(this.sectionHelperSize)
    })
    if (this.sectionHandle) this.sectionHandle.scale.setScalar(Math.max(3, this.organRadius * 0.055))
    this.updateSectionHelperTransform()
  }

  frameOrgan() {
    if (!this.organMesh) return
    const box = new THREE.Box3().setFromObject(this.organMesh)
    const sphere = new THREE.Sphere()
    box.getBoundingSphere(sphere)
    const radius = Math.max(sphere.radius, 10)
    const direction = new THREE.Vector3(1.15, 0.72, 1.35).normalize()
    this.camera.position.copy(sphere.center).addScaledVector(direction, radius * 2.65)
    this.camera.near = Math.max(0.05, radius / 120)
    this.camera.far = radius * 30
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(sphere.center)
    this.controls.maxDistance = radius * 12
    this.controls.minDistance = Math.max(2, radius * 0.08)
    this.controls.update()
  }

  setPickEnabled(enabled: boolean) {
    this.pickEnabled = enabled
    this.renderer.domElement.style.cursor = enabled ? 'crosshair' : ''
  }

  setViewMode(mode: 'all' | 'lesions' | 'organ') {
    if (this.organMesh) this.organMesh.visible = mode !== 'lesions'
    this.lesionGroup.visible = mode !== 'organ'
  }

  upsertLesion(id: string, data: MeshGeometryData | null, style: LesionViewStyle) {
    let mesh = this.lesionMeshes.get(id)
    if (!data) {
      if (mesh) mesh.visible = false
      return
    }

    const geometry = toBufferGeometry(data)
    if (!mesh) {
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(style.color),
        roughness: 0.34,
        metalness: 0.06,
        transparent: true,
        opacity: style.opacity ?? 0.88,
        side: THREE.DoubleSide,
        clippingPlanes: [this.clipPlane],
      })
      mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 3
      mesh.userData.lesionId = id
      this.lesionGroup.add(mesh)
      this.lesionMeshes.set(id, mesh)
    } else {
      mesh.geometry.dispose()
      mesh.geometry = geometry
      const material = mesh.material as THREE.MeshStandardMaterial
      material.color.set(style.color)
    }
    this.applyLesionStyle(mesh, style)
  }

  updateLesionStyle(id: string, style: LesionViewStyle) {
    const mesh = this.lesionMeshes.get(id)
    if (mesh) this.applyLesionStyle(mesh, style)
    const outline = this.lesionOutlineLines.get(id)
    if (outline) {
      ;(outline.material as THREE.LineBasicMaterial).color.set(style.highlighted ? '#fbbf24' : style.color)
    }
  }

  private applyLesionStyle(mesh: THREE.Mesh, style: LesionViewStyle) {
    mesh.visible = style.visible
    mesh.userData.highlighted = style.highlighted
    mesh.userData.selected = style.selected
    const material = mesh.material as THREE.MeshStandardMaterial
    material.color.set(style.highlighted ? '#f59e0b' : style.color)
    material.opacity = style.opacity ?? (style.highlighted ? 0.96 : 0.88)
    material.emissive.set(style.selected ? '#0ea5e9' : '#000000')
    material.emissiveIntensity = style.selected ? 0.28 : 0
    material.needsUpdate = true
  }

  removeLesion(id: string) {
    const mesh = this.lesionMeshes.get(id)
    if (mesh) {
      this.lesionGroup.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      this.lesionMeshes.delete(id)
    }
    this.removeLesionOutline(id)
  }

  setDraftPoints(points: ControlPoint[]) {
    this.clearGroup(this.draftGroup)
    if (points.length === 0) return

    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0xfde047,
      emissive: 0xca8a04,
      emissiveIntensity: 0.55,
      roughness: 0.3,
    })
    const radius = Math.max(1.1, this.organRadius * 0.025)
    points.forEach((point, index) => {
      const marker = new THREE.Mesh(this.sharedSphereGeometry, sphereMaterial)
      marker.position.set(...point.position)
      marker.scale.setScalar(index === 0 ? radius * 1.25 : radius)
      marker.renderOrder = 20
      this.draftGroup.add(marker)
    })

    if (points.length >= 2) {
      const linePoints = points.map((p) => new THREE.Vector3(...p.position))
      if (points.length >= 3) linePoints.push(new THREE.Vector3(...points[0].position))
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints)
      const line = new THREE.Line(
        lineGeometry,
        new THREE.LineBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.95, depthTest: false }),
      )
      line.renderOrder = 19
      this.draftGroup.add(line)
    }
  }

  setContour(points: ControlPoint[] | null, color = '#38bdf8') {
    this.clearGroup(this.contourGroup)
    if (!points || points.length < 2) return
    const linePoints = points.map((p) => new THREE.Vector3(...p.position))
    if (points.length >= 3) linePoints.push(new THREE.Vector3(...points[0].position))
    const geometry = new THREE.BufferGeometry().setFromPoints(linePoints)
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }),
    )
    line.renderOrder = 18
    this.contourGroup.add(line)
  }

  setOrganOutline(positions: Float32Array | null) {
    if (this.organOutline) {
      this.scene.remove(this.organOutline)
      this.organOutline.geometry.dispose()
      ;(this.organOutline.material as THREE.Material).dispose()
      this.organOutline = null
    }
    if (!positions || positions.length < 6) return
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.organOutline = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xa5f3fc, transparent: true, opacity: 1, depthTest: false }),
    )
    this.organOutline.renderOrder = 30
    this.scene.add(this.organOutline)
  }

  upsertLesionOutline(id: string, color: string, positions: Float32Array | null) {
    if (!positions || positions.length < 6) {
      this.removeLesionOutline(id)
      return
    }
    let line = this.lesionOutlineLines.get(id)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    if (!line) {
      line = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthTest: false }),
      )
      line.renderOrder = 31
      this.scene.add(line)
      this.lesionOutlineLines.set(id, line)
    } else {
      line.geometry.dispose()
      line.geometry = geometry
      ;(line.material as THREE.LineBasicMaterial).color.set(color)
    }
  }

  removeLesionOutline(id: string) {
    const line = this.lesionOutlineLines.get(id)
    if (!line) return
    this.scene.remove(line)
    line.geometry.dispose()
    ;(line.material as THREE.Material).dispose()
    this.lesionOutlineLines.delete(id)
  }

  setSectionInteractive(interactive: boolean) {
    this.sectionInteractive = interactive
    if (this.sectionPlaneMesh) {
      const material = this.sectionPlaneMesh.material as THREE.MeshBasicMaterial
      material.opacity = interactive ? 0.18 : 0.08
    }
  }

  setSection(enabled: boolean, normalTuple: Vec3Tuple, position: number, flip: boolean) {
    this.sectionNormal.set(...normalTuple).normalize()
    this.sectionPosition = position
    this.sectionHelper.visible = enabled
    this.updateSectionHelperTransform()

    if (!enabled) {
      this.clipPlane.normal.set(1, 0, 0)
      this.clipPlane.constant = 1e9
      return
    }

    const clipNormal = this.sectionNormal.clone()
    if (flip) clipNormal.negate()
    const point = this.sectionNormal.clone().multiplyScalar(position)
    this.clipPlane.normal.copy(clipNormal)
    this.clipPlane.constant = -clipNormal.dot(point)
  }

  getSectionRange() {
    return this.sectionRange
  }

  getSectionHandleClientPosition(): { x: number; y: number } | null {
    if (!this.sectionHandle || !this.sectionHelper.visible) return null
    const world = this.sectionHandle.getWorldPosition(new THREE.Vector3())
    const projected = world.project(this.camera)
    const rect = this.renderer.domElement.getBoundingClientRect()
    return {
      x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    }
  }

  private updateSectionHelperTransform() {
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.sectionNormal)
    this.sectionHelper.quaternion.copy(quaternion)
    this.sectionHelper.position.copy(this.sectionNormal.clone().multiplyScalar(this.sectionPosition))
    if (this.sectionHandle) {
      this.sectionHandle.position.set(this.sectionHelperSize * 0.52, 0, 0)
    }
  }

  private updatePointer(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  private handlePointerDown = (event: PointerEvent) => {
    this.updatePointer(event)
    this.downPoint = { x: event.clientX, y: event.clientY }
    this.pointerDown = true

    if (this.sectionHelper.visible && this.sectionInteractive && (event.button === 0 || event.pointerType === 'touch')) {
      this.raycaster.setFromCamera(this.pointer, this.camera)
      const targets: THREE.Object3D[] = []
      if (this.sectionPlaneMesh) targets.push(this.sectionPlaneMesh)
      if (this.sectionHandle) targets.push(this.sectionHandle)
      const hits = this.raycaster.intersectObjects(targets, false)
      if (hits.length > 0) {
        const viewDirection = new THREE.Vector3()
        this.camera.getWorldDirection(viewDirection)
        const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          viewDirection,
          this.sectionNormal.clone().multiplyScalar(this.sectionPosition),
        )
        const hit = new THREE.Vector3()
        this.raycaster.ray.intersectPlane(dragPlane, hit)
        this.dragState = {
          mode: 'section',
          startClientX: event.clientX,
          startClientY: event.clientY,
          startPosition: this.sectionPosition,
          startHit: hit,
        }
        this.controls.enabled = false
        this.renderer.domElement.setPointerCapture(event.pointerId)
        this.callbacks.onSectionDragStateChange?.(true)
        event.preventDefault()
        event.stopPropagation()
      }
    }
  }

  private handlePointerMove = (event: PointerEvent) => {
    this.updatePointer(event)
    if (!this.dragState || this.dragState.mode !== 'section') return

    this.raycaster.setFromCamera(this.pointer, this.camera)
    const viewDirection = new THREE.Vector3()
    this.camera.getWorldDirection(viewDirection)
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      viewDirection,
      this.sectionNormal.clone().multiplyScalar(this.dragState.startPosition),
    )
    const hit = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(dragPlane, hit) || !this.dragState.startHit) return
    const delta = hit.clone().sub(this.dragState.startHit).dot(this.sectionNormal)
    const next = THREE.MathUtils.clamp(this.dragState.startPosition + delta, -this.sectionRange, this.sectionRange)
    this.sectionPosition = next
    this.updateSectionHelperTransform()
    this.callbacks.onSectionPositionChange?.(next)
  }

  private handlePointerUp = (event: PointerEvent) => {
    const wasDraggingSection = this.dragState?.mode === 'section'
    if (wasDraggingSection) {
      this.dragState = null
      this.controls.enabled = true
      try { this.renderer.domElement.releasePointerCapture(event.pointerId) } catch { /* pointer already released */ }
      this.callbacks.onSectionDragStateChange?.(false)
      this.pointerDown = false
      return
    }

    const moved = Math.hypot(event.clientX - this.downPoint.x, event.clientY - this.downPoint.y)
    this.pointerDown = false
    if (moved > 6 || event.button !== 0) return
    if (!this.pickEnabled || !this.organMesh) return
    this.pickSurface(event)
  }

  private handlePointerCancel = () => {
    this.dragState = null
    this.pointerDown = false
    this.controls.enabled = true
    this.callbacks.onSectionDragStateChange?.(false)
  }

  private pickSurface(event: PointerEvent) {
    if (!this.callbacks.onSurfacePick || !this.organMesh) return
    this.updatePointer(event)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObject(this.organMesh, false)
    const hit = hits[0]
    if (!hit) return

    const geometry = this.organMesh.geometry
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    let ia = 0, ib = 0, ic = 0
    if (hit.face) {
      ia = hit.face.a; ib = hit.face.b; ic = hit.face.c
    } else if (geometry.index && hit.faceIndex !== undefined && hit.faceIndex !== null) {
      const base = Math.floor(hit.faceIndex) * 3
      ia = geometry.index.getX(base)
      ib = geometry.index.getX(base + 1)
      ic = geometry.index.getX(base + 2)
    }

    const a = new THREE.Vector3().fromBufferAttribute(position, ia)
    const b = new THREE.Vector3().fromBufferAttribute(position, ib)
    const c = new THREE.Vector3().fromBufferAttribute(position, ic)
    a.applyMatrix4(this.organMesh.matrixWorld)
    b.applyMatrix4(this.organMesh.matrixWorld)
    c.applyMatrix4(this.organMesh.matrixWorld)
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
    const outward = hit.point.clone().sub(this.organCenter)
    if (normal.dot(outward) < 0) normal.negate()

    this.callbacks.onSurfacePick(
      [hit.point.x, hit.point.y, hit.point.z],
      [normal.x, normal.y, normal.z],
    )
  }

  private resize() {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private animate = () => {
    this.animationFrame = requestAnimationFrame(this.animate)
    const elapsed = (performance.now() - this.animationStart) / 1000
    this.controls.update()

    for (const mesh of this.lesionMeshes.values()) {
      if (!mesh.visible) continue
      const material = mesh.material as THREE.MeshStandardMaterial
      if (mesh.userData.highlighted) {
        material.emissive.set(0xf59e0b)
        material.emissiveIntensity = 0.5 + 0.32 * Math.sin(elapsed * 4.5)
      } else if (mesh.userData.selected) {
        material.emissive.set(0x0ea5e9)
        material.emissiveIntensity = 0.24 + 0.08 * Math.sin(elapsed * 2.4)
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  private clearGroup(group: THREE.Group) {
    for (const child of [...group.children]) {
      group.remove(child)
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry?.dispose()
        const material = child.material
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material?.dispose()
      }
    }
  }

  dispose() {
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver.disconnect()
    const dom = this.renderer.domElement
    dom.removeEventListener('pointerdown', this.handlePointerDown, { capture: true })
    dom.removeEventListener('pointermove', this.handlePointerMove)
    dom.removeEventListener('pointerup', this.handlePointerUp)
    dom.removeEventListener('pointercancel', this.handlePointerCancel)
    this.controls.dispose()
    this.renderer.dispose()
    dom.remove()
  }
}
