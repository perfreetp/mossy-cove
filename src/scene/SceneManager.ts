import * as BABYLON from 'babylonjs'
import { BUILDING_DEF_MAP } from '../data/library'
import {
  addStreetDrawingPoint,
  beginTransaction,
  commitTransaction,
  relayoutStreetBuildings,
  rollbackTransaction,
  setSelection,
  store,
  type Transaction
} from '../state/store'
import type { Building, MarqueeRect, Vec2 } from '../types'
import { obbCorners, resolvePlacement, snapToGrid } from '../utils/geometry'

interface BuildingView {
  root: BABYLON.TransformNode
  body: BABYLON.Mesh
  roof: BABYLON.Mesh | null
  bodyMaterial: BABYLON.StandardMaterial
  roofMaterial: BABYLON.StandardMaterial | null
  signature: string
}

interface StreetView {
  group: BABYLON.TransformNode
  signature: string
}

type DragState =
  | {
      kind: 'building'
      tx: Transaction
      primaryId: string
      startGround: Vec2
      originals: Map<string, { x: number; z: number; rotation: number }>
      moved: boolean
    }
  | {
      kind: 'street-point'
      tx: Transaction
      streetId: string
      index: number
      moved: boolean
    }
  | {
      kind: 'marquee'
      startClientX: number
      startClientY: number
      additive: boolean
    }
  | null

export class SceneManager {
  private canvas: HTMLCanvasElement
  private engine: BABYLON.Engine
  private scene: BABYLON.Scene
  private camera: BABYLON.ArcRotateCamera
  private highlight: BABYLON.HighlightLayer
  private shadowGenerator: BABYLON.ShadowGenerator
  private ground: BABYLON.Mesh
  private gridMinor: BABYLON.LinesMesh | null = null
  private gridMajor: BABYLON.LinesMesh | null = null
  private resizeObserver: ResizeObserver

  private buildingViews = new Map<string, BuildingView>()
  private streetViews = new Map<string, StreetView>()
  private drag: DragState = null
  private marqueeElement: HTMLDivElement | null = null

  private ghostRoot: BABYLON.TransformNode | null = null
  private ghostBody: BABYLON.Mesh | null = null
  private ghostDefId: string | null = null

  public onMarqueeChange: ((rect: MarqueeRect | null) => void) | null = null

  constructor(canvas: HTMLCanvasElement, marqueeElement: HTMLDivElement | null) {
    this.canvas = canvas
    this.marqueeElement = marqueeElement
    this.engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true)
    this.scene = new BABYLON.Scene(this.engine)
    this.scene.clearColor = new BABYLON.Color4(0.91, 0.94, 0.97, 1)
    this.scene.ambientColor = new BABYLON.Color3(0.75, 0.78, 0.82)

    this.camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 4, Math.PI / 3.25, 150, new BABYLON.Vector3(0, 4, 0), this.scene)
    this.camera.attachControl(canvas, true)
    this.camera.wheelPrecision = 1.25
    this.camera.lowerRadiusLimit = 18
    this.camera.upperRadiusLimit = 260
    this.camera.upperBetaLimit = Math.PI / 2.04
    this.camera.lowerBetaLimit = 0.12
    this.camera.panningSensibility = 120
    this.setCameraMode(false)

    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.2, 1, 0.1), this.scene)
    hemi.intensity = 0.72
    hemi.groundColor = new BABYLON.Color3(0.55, 0.6, 0.68)

    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.45, -0.85, -0.35), this.scene)
    sun.position = new BABYLON.Vector3(45, 80, 35)
    sun.intensity = 1.15

    this.shadowGenerator = new BABYLON.ShadowGenerator(2048, sun)
    this.shadowGenerator.useBlurExponentialShadowMap = true
    this.shadowGenerator.blurKernel = 24
    this.shadowGenerator.darkness = 0.24

    const groundMat = new BABYLON.StandardMaterial('groundMat', this.scene)
    groundMat.diffuseColor = BABYLON.Color3.FromHexString('#e7edf3')
    groundMat.roughness = 0.95
    groundMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02)
    this.ground = BABYLON.MeshBuilder.CreateGround('sandbox-ground', { width: 160, height: 120 }, this.scene)
    this.ground.material = groundMat
    this.ground.receiveShadows = true
    this.ground.metadata = { ground: true }
    this.ground.isPickable = true

    this.createGrid()

    this.highlight = new BABYLON.HighlightLayer('selection-highlight', this.scene, {
      blurHorizontalSize: 1,
      blurVerticalSize: 1
    })
    this.highlight.innerGlow = false

    this.bindPointer()

    this.resizeObserver = new ResizeObserver(() => this.engine.resize())
    this.resizeObserver.observe(canvas.parentElement ?? canvas)
    window.addEventListener('resize', this.handleWindowResize)

    this.engine.runRenderLoop(() => this.scene.render())
  }

  private handleWindowResize = () => this.engine.resize()

  public setMarqueeElement(el: HTMLDivElement | null) {
    this.marqueeElement = el
  }

  public setCameraMode(orbit: boolean) {
    const pointers = this.camera.inputs.attached.pointers as
      | (BABYLON.ArcRotateCameraPointersInput & { buttons: number[] })
      | undefined
    if (pointers) pointers.buttons = orbit ? [0, 1, 2] : [1, 2]
    if (orbit) this.canvas.style.cursor = 'grab'
    else this.canvas.style.cursor = 'default'
  }

  public setView(view: 'top' | 'perspective' | 'reset') {
    if (view === 'top') {
      this.camera.alpha = -Math.PI / 2
      this.camera.beta = 0.08
      this.camera.radius = 145
      this.camera.target = new BABYLON.Vector3(0, 0, 0)
    } else if (view === 'perspective') {
      this.camera.alpha = -Math.PI / 4
      this.camera.beta = Math.PI / 3.25
      this.camera.radius = 150
      this.camera.target = new BABYLON.Vector3(0, 4, 0)
    } else {
      this.camera.alpha = -Math.PI / 4
      this.camera.beta = Math.PI / 3.25
      this.camera.radius = 150
      this.camera.setTarget(new BABYLON.Vector3(0, 4, 0))
    }
  }

  private createGrid() {
    const minor: BABYLON.Vector3[][] = []
    const major: BABYLON.Vector3[][] = []
    const minX = -80
    const maxX = 80
    const minZ = -60
    const maxZ = 60

    for (let x = minX; x <= maxX; x += 2) {
      const line = [new BABYLON.Vector3(x, 0.025, minZ), new BABYLON.Vector3(x, 0.025, maxZ)]
      ;(x % 10 === 0 ? major : minor).push(line)
    }
    for (let z = minZ; z <= maxZ; z += 2) {
      const line = [new BABYLON.Vector3(minX, 0.025, z), new BABYLON.Vector3(maxX, 0.025, z)]
      ;(z % 10 === 0 ? major : minor).push(line)
    }

    this.gridMinor = BABYLON.MeshBuilder.CreateLineSystem('grid-minor', { lines: minor }, this.scene)
    this.gridMinor.color = BABYLON.Color3.FromHexString('#cbd5e1')
    this.gridMinor.alpha = 0.55
    this.gridMinor.isPickable = false

    this.gridMajor = BABYLON.MeshBuilder.CreateLineSystem('grid-major', { lines: major }, this.scene)
    this.gridMajor.color = BABYLON.Color3.FromHexString('#94a3b8')
    this.gridMajor.alpha = 0.7
    this.gridMajor.isPickable = false
  }

  public setGridVisible(visible: boolean) {
    if (this.gridMinor) this.gridMinor.isEnabled(visible)
    if (this.gridMajor) this.gridMajor.isEnabled(visible)
  }

  public groundPointFromClient(clientX: number, clientY: number): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const pick = this.scene.pick(x, y, (mesh) => mesh === this.ground || mesh.metadata?.ground === true)
    if (pick?.pickedPoint) return { x: pick.pickedPoint.x, z: pick.pickedPoint.z }

    // Fallback: intersect the camera ray with y=0.
    const ray = this.scene.createPickingRay(x, y, BABYLON.Matrix.Identity(), this.camera)
    const distance = ray.intersectsPlane(new BABYLON.Plane(0, 1, 0, 0))
    if (distance != null && Number.isFinite(distance)) {
      const p = ray.origin.add(ray.direction.scale(distance))
      return { x: p.x, z: p.z }
    }
    return null
  }

  private bindPointer() {
    this.scene.onPointerObservable.add((pointerInfo) => {
      const event = pointerInfo.event as PointerEvent

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && event.button === 0) {
        this.handlePointerDown(event)
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        this.handlePointerMove(event)
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP && event.button === 0) {
        this.handlePointerUp(event)
      }
    })

    this.canvas.addEventListener('pointercancel', () => this.cancelDrag())
  }

  private handlePointerDown(event: PointerEvent) {
    if (this.isOrbitModeActive()) return

    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY)
    const mesh = pick?.pickedMesh as BABYLON.AbstractMesh | null | undefined
    const handle = mesh?.metadata?.streetHandle as { streetId: string; index: number } | undefined

    if (handle) {
      store.activeStreetId = handle.streetId
      this.drag = {
        kind: 'street-point',
        tx: beginTransaction('街道重排'),
        streetId: handle.streetId,
        index: handle.index,
        moved: false
      }
      this.canvas.style.cursor = 'grabbing'
      return
    }

    const streetId = mesh?.metadata?.streetId as string | undefined
    const buildingId = mesh?.metadata?.buildingId as string | undefined

    if (store.drawingStreet) {
      const p = this.groundPointFromClient(event.clientX, event.clientY)
      if (p) addStreetDrawingPoint(p.x, p.z)
      return
    }

    if (buildingId) {
      let ids = store.selectedIds
      if (event.shiftKey) {
        if (ids.includes(buildingId)) ids = ids.filter((id) => id !== buildingId)
        else ids = [...ids, buildingId]
        setSelection(ids)
      } else if (!ids.includes(buildingId)) {
        setSelection([buildingId])
      }

      const activeIds = new Set(store.selectedIds)
      const originals = new Map<string, { x: number; z: number; rotation: number }>()
      for (const b of store.buildings) {
        if (activeIds.has(b.id)) originals.set(b.id, { x: b.x, z: b.z, rotation: b.rotation })
      }
      const primary = store.buildings.find((b) => b.id === buildingId)
      const ground = this.groundPointFromClient(event.clientX, event.clientY)
      if (primary && ground) {
        this.drag = {
          kind: 'building',
          tx: beginTransaction('移动建筑'),
          primaryId: buildingId,
          startGround: ground,
          originals,
          moved: false
        }
        this.canvas.style.cursor = 'grabbing'
      }
      return
    }

    if (streetId) store.activeStreetId = streetId

    const rect = this.canvas.getBoundingClientRect()
    this.drag = {
      kind: 'marquee',
      startClientX: event.clientX - rect.left,
      startClientY: event.clientY - rect.top,
      additive: event.shiftKey
    }
    if (!event.shiftKey) setSelection([])
  }

  private orbitMode = false
  public isOrbitModeActive() {
    return this.orbitMode
  }
  public setOrbitMode(value: boolean) {
    this.orbitMode = value
    this.setCameraMode(value)
  }

  private handlePointerMove(event: PointerEvent) {
    if (!this.drag) {
      this.updateHoverCursor(event)
      return
    }

    if (this.drag.kind === 'marquee') {
      const rect = this.canvas.getBoundingClientRect()
      const currentX = event.clientX - rect.left
      const currentY = event.clientY - rect.top
      const next: MarqueeRect = {
        x1: Math.min(this.drag.startClientX, currentX),
        y1: Math.min(this.drag.startClientY, currentY),
        x2: Math.max(this.drag.startClientX, currentX),
        y2: Math.max(this.drag.startClientY, currentY)
      }
      this.showMarquee(next)
      this.previewMarqueeSelection(next, this.drag.additive)
      return
    }

    const ground = this.groundPointFromClient(event.clientX, event.clientY)
    if (!ground) return

    if (this.drag.kind === 'building') {
      const drag = this.drag
      const primaryOriginal = drag.originals.get(drag.primaryId)
      const primary = store.buildings.find((b) => b.id === drag.primaryId)
      if (!primaryOriginal || !primary) return

      const rawX = primaryOriginal.x + (ground.x - drag.startGround.x)
      const rawZ = primaryOriginal.z + (ground.z - drag.startGround.z)
      const snappedBase = {
        x: snapToGrid(rawX, store.settings.gridSize),
        z: snapToGrid(rawZ, store.settings.gridSize)
      }

      const selectedIds = new Set(drag.originals.keys())
      if (selectedIds.size === 1) {
        const others = store.buildings.filter((b) => !selectedIds.has(b.id))
        const pose = resolvePlacement(
          snappedBase,
          { width: primary.width, depth: primary.depth, rotation: primary.rotation },
          others,
          store.streets,
          store.settings.snapThreshold,
          store.settings.gridSize
        )
        const dx = pose.x - primaryOriginal.x
        const dz = pose.z - primaryOriginal.z
        primary.x = pose.x
        primary.z = pose.z
        primary.rotation = pose.rotation
        primary.streetId = pose.streetId ?? null
        primary.streetSide = pose.streetSide ?? null
        primary.streetU = pose.streetU ?? null

        for (const b of store.buildings) {
          const o = drag.originals.get(b.id)
          if (o && b.id !== primary.id) {
            b.x = o.x + dx
            b.z = o.z + dz
          }
        }
      } else {
        const dx = snappedBase.x - primaryOriginal.x
        const dz = snappedBase.z - primaryOriginal.z
        for (const b of store.buildings) {
          const o = drag.originals.get(b.id)
          if (o) {
            b.x = o.x + dx
            b.z = o.z + dz
            // A multi-building manual translation is an explicit override of street binding.
            b.streetId = null
            b.streetSide = null
            b.streetU = null
          }
        }
      }

      drag.moved =
        drag.moved ||
        Math.hypot(ground.x - drag.startGround.x, ground.z - drag.startGround.z) > 0.35
      this.syncBuildings()
      this.syncSelection()
      return
    }

    if (this.drag.kind === 'street-point') {
      const drag = this.drag
      const street = store.streets.find((s) => s.id === drag.streetId)
      if (!street) return
      const p = this.groundPointFromClient(event.clientX, event.clientY)
      if (!p) return
      street.points[drag.index] = {
        x: snapToGrid(p.x, store.settings.gridSize),
        z: snapToGrid(p.z, store.settings.gridSize)
      }
      drag.moved = true
      relayoutStreetBuildings(street.id)
      this.syncStreets()
      this.syncBuildings()
      this.syncSelection()
    }
  }

  private updateHoverCursor(event: PointerEvent) {
    if (this.orbitMode || store.drawingStreet) {
      this.canvas.style.cursor = store.drawingStreet ? 'crosshair' : 'grab'
      return
    }
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY)
    const mesh = pick?.pickedMesh as BABYLON.AbstractMesh | null | undefined
    if (mesh?.metadata?.streetHandle || mesh?.metadata?.buildingId) this.canvas.style.cursor = 'move'
    else this.canvas.style.cursor = 'default'
  }

  private handlePointerUp(_event: PointerEvent) {
    if (!this.drag) return

    if (this.drag.kind === 'building') {
      const drag = this.drag
      if (drag.moved) commitTransaction(drag.tx)
      else rollbackTransaction(drag.tx)
      this.drag = null
      this.canvas.style.cursor = 'default'
    } else if (this.drag.kind === 'street-point') {
      const drag = this.drag
      if (drag.moved) commitTransaction(drag.tx)
      else rollbackTransaction(drag.tx)
      this.drag = null
      this.canvas.style.cursor = 'default'
    } else if (this.drag.kind === 'marquee') {
      this.hideMarquee()
      this.drag = null
    }
  }

  private cancelDrag() {
    if (this.drag && (this.drag.kind === 'building' || this.drag.kind === 'street-point')) {
      rollbackTransaction(this.drag.tx)
    }
    if (this.drag?.kind === 'marquee') this.hideMarquee()
    this.drag = null
  }

  private showMarquee(rect: MarqueeRect) {
    if (this.onMarqueeChange) this.onMarqueeChange(rect)
    if (this.marqueeElement) {
      this.marqueeElement.style.display = 'block'
      this.marqueeElement.style.left = `${rect.x1}px`
      this.marqueeElement.style.top = `${rect.y1}px`
      this.marqueeElement.style.width = `${rect.x2 - rect.x1}px`
      this.marqueeElement.style.height = `${rect.y2 - rect.y1}px`
    }
  }

  private hideMarquee() {
    if (this.onMarqueeChange) this.onMarqueeChange(null)
    if (this.marqueeElement) this.marqueeElement.style.display = 'none'
  }

  private projectBuildingScreenRect(b: Building): { left: number; top: number; right: number; bottom: number } | null {
    const rect = this.canvas.getBoundingClientRect()
    const corners = obbCorners(b)
    const points: BABYLON.Vector3[] = []
    for (const c of corners) {
      points.push(new BABYLON.Vector3(c.x, 0, c.z))
      points.push(new BABYLON.Vector3(c.x, b.height, c.z))
    }

    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    const matrix = this.scene.getTransformMatrix()

    for (const p of points) {
      const clip = BABYLON.Vector3.TransformCoordinates(p, matrix)
      if (!Number.isFinite(clip.x) || !Number.isFinite(clip.y)) continue
      const sx = (clip.x * 0.5 + 0.5) * rect.width
      const sy = (-clip.y * 0.5 + 0.5) * rect.height
      left = Math.min(left, sx)
      right = Math.max(right, sx)
      top = Math.min(top, sy)
      bottom = Math.max(bottom, sy)
    }

    if (!Number.isFinite(left)) return null
    return { left, top, right, bottom }
  }

  private previewMarqueeSelection(rect: MarqueeRect, additive: boolean) {
    const ids: string[] = []
    for (const b of store.buildings) {
      const screenRect = this.projectBuildingScreenRect(b)
      if (!screenRect) continue
      const hit =
        screenRect.right >= rect.x1 &&
        screenRect.left <= rect.x2 &&
        screenRect.bottom >= rect.y1 &&
        screenRect.top <= rect.y2
      if (hit) ids.push(b.id)
    }
    if (additive) {
      const baseline = new Set(store.selectedIds)
      for (const id of ids) baseline.add(id)
      setSelection(Array.from(baseline))
    } else {
      setSelection(ids)
    }
  }

  // ---------------------------------------------------------------------------
  // Ghost from library
  // ---------------------------------------------------------------------------

  public setGhost(defId: string | null) {
    if (this.ghostDefId === defId) return
    this.disposeGhost()
    this.ghostDefId = defId
    if (!defId) return
    const def = BUILDING_DEF_MAP.get(defId)
    if (!def) return

    this.ghostRoot = new BABYLON.TransformNode('ghost-root', this.scene)
    const mat = new BABYLON.StandardMaterial('ghost-mat', this.scene)
    mat.diffuseColor = BABYLON.Color3.FromHexString(def.color)
    mat.alpha = 0.42
    mat.specularColor = BABYLON.Color3.Black()
    this.ghostBody = BABYLON.MeshBuilder.CreateBox(
      'ghost-body',
      { width: def.width, height: def.height, depth: def.depth },
      this.scene
    )
    this.ghostBody.parent = this.ghostRoot
    this.ghostBody.position.y = def.height / 2
    this.ghostBody.material = mat
    this.ghostBody.isPickable = false
    this.ghostRoot.setEnabled(false)
  }

  public updateGhostFromClient(clientX: number, clientY: number) {
    if (!this.ghostRoot || !this.ghostDefId) return
    const def = BUILDING_DEF_MAP.get(this.ghostDefId)
    const p = this.groundPointFromClient(clientX, clientY)
    if (!def || !p) return
    const pose = resolvePlacement(
      p,
      { width: def.width, depth: def.depth, rotation: 0 },
      store.buildings,
      store.streets,
      store.settings.snapThreshold,
      store.settings.gridSize
    )
    this.ghostRoot.setEnabled(true)
    this.ghostRoot.position.set(pose.x, 0, pose.z)
    this.ghostRoot.rotation.y = pose.rotation
  }

  public hideGhost() {
    this.ghostRoot?.setEnabled(false)
  }

  private disposeGhost() {
    this.ghostBody?.dispose()
    if (this.ghostRoot) this.ghostRoot.dispose()
    this.ghostBody = null
    this.ghostRoot = null
  }

  // ---------------------------------------------------------------------------
  // Building synchronization and roof geometry
  // ---------------------------------------------------------------------------

  private buildingSignature(b: Building): string {
    return [b.width, b.depth, b.height, b.roof, b.color].join('|')
  }

  public syncBuildings() {
    const liveIds = new Set(store.buildings.map((b) => b.id))
    for (const [id, view] of this.buildingViews) {
      if (!liveIds.has(id)) {
        this.shadowGenerator.removeShadowCaster(view.body)
        if (view.roof) this.shadowGenerator.removeShadowCaster(view.roof)
        this.highlight.removeMesh(view.body)
        if (view.roof) this.highlight.removeMesh(view.roof)
        view.body.dispose()
        view.roof?.dispose()
        view.bodyMaterial.dispose()
        view.roofMaterial?.dispose()
        view.root.dispose()
        this.buildingViews.delete(id)
      }
    }

    for (const b of store.buildings) {
      let view = this.buildingViews.get(b.id)
      if (view && view.signature !== this.buildingSignature(b)) {
        this.shadowGenerator.removeShadowCaster(view.body)
        if (view.roof) this.shadowGenerator.removeShadowCaster(view.roof)
        this.highlight.removeMesh(view.body)
        if (view.roof) this.highlight.removeMesh(view.roof)
        view.body.dispose()
        view.roof?.dispose()
        view.bodyMaterial.dispose()
        view.roofMaterial?.dispose()
        view.root.dispose()
        this.buildingViews.delete(b.id)
        view = undefined
      }

      if (!view) {
        view = this.createBuildingView(b)
        this.buildingViews.set(b.id, view)
      }

      view.root.position.set(b.x, 0, b.z)
      view.root.rotation.set(0, b.rotation, 0)
    }
  }

  private createBuildingView(b: Building): BuildingView {
    const root = new BABYLON.TransformNode(`root-${b.id}`, this.scene)
    const bodyMaterial = new BABYLON.StandardMaterial(`body-mat-${b.id}`, this.scene)
    bodyMaterial.diffuseColor = BABYLON.Color3.FromHexString(b.color)
    bodyMaterial.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08)

    const body = BABYLON.MeshBuilder.CreateBox(
      `body-${b.id}`,
      { width: b.width, height: b.height, depth: b.depth },
      this.scene
    )
    body.parent = root
    body.position.y = b.height / 2
    body.material = bodyMaterial
    body.receiveShadows = true
    body.metadata = { buildingId: b.id }
    this.shadowGenerator.addShadowCaster(body)

    const roofMaterial = new BABYLON.StandardMaterial(`roof-mat-${b.id}`, this.scene)
    roofMaterial.diffuseColor = BABYLON.Color3.FromHexString(b.color).scale(0.62)
    roofMaterial.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04)
    roofMaterial.backFaceCulling = false

    const roof = this.createRoofMesh(b, root, roofMaterial)
    if (roof) {
      roof.metadata = { buildingId: b.id }
      roof.receiveShadows = true
      this.shadowGenerator.addShadowCaster(roof)
    }

    root.position.set(b.x, 0, b.z)
    root.rotation.y = b.rotation

    return {
      root,
      body,
      roof,
      bodyMaterial,
      roofMaterial,
      signature: this.buildingSignature(b)
    }
  }

  private createRoofMesh(
    b: Building,
    parent: BABYLON.TransformNode,
    material: BABYLON.StandardMaterial
  ): BABYLON.Mesh | null {
    const id = `roof-${b.id}-${b.roof}`

    if (b.roof === 'flat') {
      const roof = BABYLON.MeshBuilder.CreateBox(
        id,
        { width: b.width + 0.45, height: 0.38, depth: b.depth + 0.45 },
        this.scene
      )
      roof.parent = parent
      roof.position.y = b.height + 0.19
      roof.material = material
      return roof
    }

    const positions: number[] = []
    const indices: number[] = []
    const overhang = 0.38
    const w = b.width + overhang * 2
    const d = b.depth + overhang * 2
    const y0 = b.height + 0.05
    const roofHeight = Math.min(3.4, Math.max(1.1, Math.min(b.width, b.depth) * 0.34))

    if (b.roof === 'gable') {
      // Cross-section triangle in X/Y, extruded along Z.
      const zA = -d / 2
      const zB = d / 2
      const vertices = [
        [-w / 2, y0, zA],
        [w / 2, y0, zA],
        [0, y0 + roofHeight, zA],
        [-w / 2, y0, zB],
        [w / 2, y0, zB],
        [0, y0 + roofHeight, zB]
      ]
      vertices.forEach((v) => positions.push(...v))
      indices.push(
        0, 2, 1, // near triangle
        3, 4, 5, // far triangle
        0, 3, 5, 0, 5, 2, // left slope
        1, 2, 5, 1, 5, 4, // right slope
        0, 1, 4, 0, 4, 3 // underside
      )
    } else {
      // Four-slope hip/pyramid roof.
      const vertices = [
        [-w / 2, y0, -d / 2],
        [w / 2, y0, -d / 2],
        [w / 2, y0, d / 2],
        [-w / 2, y0, d / 2],
        [0, y0 + roofHeight, 0]
      ]
      vertices.forEach((v) => positions.push(...v))
      indices.push(
        0, 1, 4,
        1, 2, 4,
        2, 3, 4,
        3, 0, 4,
        0, 2, 1,
        0, 3, 2
      )
    }

    const mesh = new BABYLON.Mesh(id, this.scene)
    const vertexData = new BABYLON.VertexData()
    vertexData.positions = positions
    vertexData.indices = indices
    const normals: number[] = []
    BABYLON.VertexData.ComputeNormals(positions, indices, normals)
    vertexData.normals = normals
    vertexData.applyToMesh(mesh)
    mesh.parent = parent
    mesh.material = material
    return mesh
  }

  public syncSelection() {
    this.highlight.removeAllMeshes()
    const selected = new Set(store.selectedIds)
    const color = BABYLON.Color3.FromHexString('#0ea5e9')
    for (const id of selected) {
      const view = this.buildingViews.get(id)
      if (!view) continue
      this.highlight.addMesh(view.body, color)
      if (view.roof) this.highlight.addMesh(view.roof, color)
    }
  }

  // ---------------------------------------------------------------------------
  // Streets
  // ---------------------------------------------------------------------------

  private streetSignature(street: (typeof store.streets)[number]): string {
    return JSON.stringify({
      points: street.points,
      width: street.width,
      color: street.color,
      active: store.activeStreetId === street.id,
      drawing: store.drawingStreet && store.activeStreetId === street.id
    })
  }

  public syncStreets() {
    const liveIds = new Set(store.streets.map((s) => s.id))
    for (const [id, view] of this.streetViews) {
      if (!liveIds.has(id)) {
        view.group.dispose(false, true)
        this.streetViews.delete(id)
      }
    }

    for (const street of store.streets) {
      const signature = this.streetSignature(street)
      const existing = this.streetViews.get(street.id)
      if (existing && existing.signature === signature) continue
      existing?.group.dispose(false, true)
      this.streetViews.delete(street.id)

      if (street.points.length === 0) continue
      const group = new BABYLON.TransformNode(`street-${street.id}`, this.scene)
      this.createRoadMesh(street, group)
      this.createStreetLine(street, group)

      if (store.activeStreetId === street.id) {
        street.points.forEach((p, index) => {
          const handle = BABYLON.MeshBuilder.CreateSphere(
            `handle-${street.id}-${index}`,
            { diameter: 0.85, segments: 12 },
            this.scene
          )
          handle.parent = group
          handle.position.set(p.x, 0.45, p.z)
          const mat = new BABYLON.StandardMaterial(`handle-mat-${street.id}-${index}`, this.scene)
          mat.diffuseColor = BABYLON.Color3.FromHexString('#f97316')
          mat.emissiveColor = BABYLON.Color3.FromHexString('#7c2d12')
          handle.material = mat
          handle.metadata = { streetHandle: { streetId: street.id, index } }
        })
      }

      this.streetViews.set(street.id, { group, signature })
    }
  }

  private createRoadMesh(street: (typeof store.streets)[number], parent: BABYLON.TransformNode) {
    if (street.points.length < 2) return
    const halfWidth = street.width / 2
    const offsets: Vec2[] = []

    for (let i = 0; i < street.points.length; i++) {
      let tangent: Vec2
      if (i === 0) {
        const a = street.points[0]
        const b = street.points[1]
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
        tangent = { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
      } else if (i === street.points.length - 1) {
        const a = street.points[i - 1]
        const b = street.points[i]
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
        tangent = { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
      } else {
        const a = street.points[i - 1]
        const b = street.points[i + 1]
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
        tangent = { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
      }
      offsets.push({ x: -tangent.z * halfWidth, z: tangent.x * halfWidth })
    }

    const positions: number[] = []
    const indices: number[] = []
    const uvs: number[] = []

    street.points.forEach((p, i) => {
      const n = offsets[i]
      positions.push(p.x + n.x, 0.07, p.z + n.z)
      positions.push(p.x - n.x, 0.07, p.z - n.z)
      uvs.push(0, i / 4, 1, i / 4)
    })

    for (let i = 0; i < street.points.length - 1; i++) {
      const a = i * 2
      const b = a + 1
      const c = a + 2
      const d = a + 3
      indices.push(a, b, c, b, d, c)
    }

    const road = new BABYLON.Mesh(`road-${street.id}`, this.scene)
    const data = new BABYLON.VertexData()
    data.positions = positions
    data.indices = indices
    data.uvs = uvs
    const normals: number[] = []
    BABYLON.VertexData.ComputeNormals(positions, indices, normals)
    data.normals = normals
    data.applyToMesh(road)
    road.parent = parent
    road.metadata = { streetId: street.id }
    road.isPickable = true

    const mat = new BABYLON.StandardMaterial(`road-mat-${street.id}`, this.scene)
    mat.diffuseColor = BABYLON.Color3.FromHexString(street.color)
    mat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02)
    road.material = mat
  }

  private createStreetLine(street: (typeof store.streets)[number], parent: BABYLON.TransformNode) {
    if (street.points.length < 2) return
    const line = BABYLON.MeshBuilder.CreateDashedLines(
      `street-line-${street.id}`,
      {
        points: street.points.map((p) => new BABYLON.Vector3(p.x, 0.14, p.z)),
        dashSize: 2,
        gapSize: 1.4,
        dashNb: street.points.length * 3
      },
      this.scene
    )
    line.parent = parent
    line.color = BABYLON.Color3.FromHexString('#f8fafc')
    line.alpha = 0.9
    line.isPickable = false
  }

  public syncAll() {
    this.syncBuildings()
    this.syncStreets()
    this.syncSelection()
    this.setGridVisible(store.settings.showGrid)
  }

  public dispose() {
    window.removeEventListener('resize', this.handleWindowResize)
    this.resizeObserver.disconnect()
    this.disposeGhost()
    this.engine.stopRenderLoop()
    this.scene.dispose()
    this.engine.dispose()
  }
}
