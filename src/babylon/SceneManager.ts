import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Curve3 } from '@babylonjs/core/Maths/math.path'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { CLOUD_FRAGMENT_SHADER, CLOUD_VERTEX_SHADER, SKY_FRAGMENT_SHADER, SKY_VERTEX_SHADER } from './shaders'
import { HEIGHT_RES, MASK_RES, WORLD_SIZE } from '../constants'
import { base64ToBytes } from '../terrain/maskCodec'
import type { CloudBand, ProjectData } from '../types'

const FOG_COLOR = Color3.FromHexString('#cfe7ff')
const CLOUD_SIZE = WORLD_SIZE * 1.58
const SHEET_OFFSETS = [-0.46, 0, 0.46]
const SHEET_ALPHAS = [0.52, 0.94, 0.64]

interface CloudView {
  id: string
  name: string
  sheets: Mesh[]
  materials: ShaderMaterial[]
  texture: DynamicTexture
  maskKey: string | null
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function mixColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = clamp01(t)
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

function terrainColor(height: number, slope: number): [number, number, number] {
  const h = clamp01(height)
  let color: [number, number, number]
  if (h < 0.3) {
    color = mixColor([0.19, 0.36, 0.25], [0.43, 0.57, 0.33], h / 0.3)
  } else if (h < 0.64) {
    color = mixColor([0.43, 0.57, 0.33], [0.55, 0.48, 0.38], (h - 0.3) / 0.34)
  } else {
    color = mixColor([0.55, 0.48, 0.38], [0.94, 0.96, 0.98], (h - 0.64) / 0.36)
  }
  const rockAmount = clamp01((slope - 0.22) * 1.7)
  color = mixColor(color, [0.43, 0.4, 0.36], rockAmount * 0.72)
  if (h > 0.76 && slope < 0.34) color = mixColor(color, [0.94, 0.97, 1], ((h - 0.76) / 0.24) * 0.7)
  return color
}

function stableSeed(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

export interface CloudOrderItem {
  id: string
  name: string
  distance: number
}

export class SceneManager {
  private canvas: HTMLCanvasElement
  private engine: Engine
  private scene: Scene
  private camera: ArcRotateCamera
  private terrain!: Mesh
  private cloudViews = new Map<string, CloudView>()
  private pathPoints: Vector3[] = []
  private pathLine: LinesMesh | null = null
  private marker!: Mesh
  private sky!: Mesh

  private elapsed = 0
  private orderElapsed = 0
  private pathProgressValue = 0
  private disposed = false

  playing = false
  speed = 1
  onProgress: ((progress: number) => void) | null = null
  onOrder: ((order: CloudOrderItem[]) => void) | null = null

  constructor(canvas: HTMLCanvasElement, project: ProjectData) {
    this.canvas = canvas
    const dprCap = Math.min(window.devicePixelRatio || 1, 1.6)
    this.engine = new Engine(canvas, true, { antialias: true, powerPreference: 'high-performance' }, true)
    this.engine.setHardwareScalingLevel(1 / dprCap)

    this.scene = new Scene(this.engine)
    this.scene.clearColor = new Color4(FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b, 1)
    this.scene.fogMode = Scene.FOGMODE_LINEAR
    this.scene.fogColor = FOG_COLOR
    this.scene.fogStart = 260
    this.scene.fogEnd = 680

    this.camera = new ArcRotateCamera(
      'aerial-camera',
      -2.35,
      1.04,
      250,
      new Vector3(0, 30, 0),
      this.scene,
    )
    this.camera.attachControl(this.canvas, true)
    this.camera.lowerRadiusLimit = 70
    this.camera.upperRadiusLimit = 430
    this.camera.lowerBetaLimit = 0.16
    this.camera.upperBetaLimit = Math.PI * 0.49
    this.camera.minZ = 0.5
    this.camera.maxZ = 1400
    this.camera.wheelDeltaPercentage = 0.012
    this.camera.pinchDeltaPercentage = 0.012

    const hemisphere = new HemisphericLight('sky-hemi', new Vector3(0.15, 1, 0.08), this.scene)
    hemisphere.intensity = 0.95
    hemisphere.groundColor = Color3.FromHexString('#756653')

    const sun = new DirectionalLight('sun', new Vector3(-0.42, -0.72, -0.36), this.scene)
    sun.intensity = 1.35
    sun.diffuse = Color3.FromHexString('#fff2d8')

    this.createSky()
    this.createBaseGround()
    this.createTerrain()
    this.updateTerrain(project)
    this.syncClouds(project.bands)
    this.buildCameraPath()
    this.setPathProgress(0)

    this.engine.runRenderLoop(() => this.frame())
  }

  private createSky(): void {
    this.sky = MeshBuilder.CreateSphere(
      'gradient-sky',
      { diameter: 1100, segments: 24, sideOrientation: Mesh.BACKSIDE },
      this.scene,
    )
    const material = new ShaderMaterial(
      'gradient-sky-material',
      this.scene,
      { vertexSource: SKY_VERTEX_SHADER, fragmentSource: SKY_FRAGMENT_SHADER },
      {
        attributes: ['position'],
        uniforms: ['worldViewProjection'],
      },
    )
    material.disableDepthWrite = true
    material.backFaceCulling = false
    this.sky.material = material
    this.sky.infiniteDistance = true
    this.sky.isPickable = false
  }

  private createBaseGround(): void {
    const ground = MeshBuilder.CreateGround(
      'distant-ground',
      { width: 1400, height: 1400, subdivisions: 1 },
      this.scene,
    )
    ground.position.y = -2.5
    ground.isPickable = false
    const material = new StandardMaterial('distant-ground-material', this.scene)
    material.diffuseColor = Color3.FromHexString('#71866f')
    material.specularColor = Color3.Black()
    material.fogEnabled = true
    ground.material = material
  }

  private createTerrain(): void {
    this.terrain = MeshBuilder.CreateGround(
      'height-field-terrain',
      {
        width: WORLD_SIZE,
        height: WORLD_SIZE,
        subdivisions: HEIGHT_RES - 1,
        updatable: true,
      },
      this.scene,
    )
    const material = new StandardMaterial('terrain-material', this.scene)
    material.diffuseColor = Color3.White()
    material.specularColor = new Color3(0.06, 0.06, 0.05)
    material.specularPower = 18
    this.terrain.useVertexColors = true
    this.terrain.material = material
    this.terrain.isPickable = false
    this.terrain.receiveShadows = false
  }

  updateTerrain(project: ProjectData): void {
    if (this.disposed) return
    const positions = this.terrain.getVerticesData(VertexBuffer.PositionKind)
    if (!positions) return

    const resolution = project.heightResolution
    const heightScale = project.terrain.ridgeHeight

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]
      const z = positions[i + 2]
      const gx = Math.round((x / WORLD_SIZE + 0.5) * (resolution - 1))
      const gz = Math.round((z / WORLD_SIZE + 0.5) * (resolution - 1))
      const ix = Math.max(0, Math.min(resolution - 1, gx))
      const iz = Math.max(0, Math.min(resolution - 1, gz))
      const h = project.heights[iz * resolution + ix] ?? 0
      positions[i + 1] = h * heightScale
    }
    this.terrain.updateVerticesData(VertexBuffer.PositionKind, positions)

    const indices = this.terrain.getIndices()
    let normals = this.terrain.getVerticesData(VertexBuffer.NormalKind)
    const normalLength = (positions.length / 3) * 3
    if (!normals || normals.length !== normalLength) normals = new Float32Array(normalLength)
    VertexData.ComputeNormals(positions, indices ?? [], normals)
    this.terrain.updateVerticesData(VertexBuffer.NormalKind, normals)

    this.updateTerrainColors(positions, normals, heightScale)
  }

  private updateTerrainColors(positions: Float32Array | number[], normals: Float32Array | number[], heightScale: number): void {
    const vertexCount = positions.length / 3
    const colors = new Float32Array(vertexCount * 4)
    for (let i = 0; i < vertexCount; i += 1) {
      const height = heightScale > 0 ? positions[i * 3 + 1] / heightScale : 0
      const slope = 1 - clamp01(normals[i * 3 + 1])
      const [r, g, b] = terrainColor(height, slope)
      colors[i * 4] = r
      colors[i * 4 + 1] = g
      colors[i * 4 + 2] = b
      colors[i * 4 + 3] = 1
    }

    if (this.terrain.isVerticesDataPresent(VertexBuffer.ColorKind)) {
      this.terrain.updateVerticesData(VertexBuffer.ColorKind, colors)
    } else {
      this.terrain.setVerticesData(VertexBuffer.ColorKind, colors)
    }
  }

  private createCloudView(band: CloudBand, index: number): CloudView {
    const texture = new DynamicTexture(
      `cloud-mask-${band.id}`,
      { width: MASK_RES, height: MASK_RES },
      this.scene,
      false,
    )
    texture.hasAlpha = false

    const sheets: Mesh[] = []
    const materials: ShaderMaterial[] = []

    for (let sheet = 0; sheet < SHEET_OFFSETS.length; sheet += 1) {
      const mesh = MeshBuilder.CreatePlane(
        `cloud-${band.id}-sheet-${sheet}`,
        { width: CLOUD_SIZE, height: CLOUD_SIZE },
        this.scene,
      )
      mesh.rotation.x = -Math.PI / 2
      mesh.isPickable = false
      mesh.receiveShadows = false

      const material = new ShaderMaterial(
        `cloud-material-${band.id}-${sheet}`,
        this.scene,
        { vertexSource: CLOUD_VERTEX_SHADER, fragmentSource: CLOUD_FRAGMENT_SHADER },
        {
          attributes: ['position', 'uv'],
          uniforms: [
            'world',
            'worldViewProjection',
            'time',
            'coverage',
            'density',
            'bandSeed',
            'sheetSeed',
            'sheetAlpha',
            'cameraPosition',
            'fogColor',
          ],
          samplers: ['maskTex'],
          needAlphaBlending: true,
        },
      )
      material.backFaceCulling = false
      material.disableDepthWrite = true
      material.setFloat('time', this.elapsed)
      material.setFloat('bandSeed', stableSeed(band.id) * 18 + index * 4.1)
      material.setFloat('sheetSeed', sheet * 8.73 + index * 2.31)
      material.setFloat('sheetAlpha', SHEET_ALPHAS[sheet])
      material.setColor3('fogColor', FOG_COLOR)
      material.setVector3('cameraPosition', this.camera.position)
      material.setTexture('maskTex', texture)

      mesh.material = material
      sheets.push(mesh)
      materials.push(material)
    }

    return { id: band.id, name: band.name, sheets, materials, texture, maskKey: null }
  }

  syncClouds(bands: CloudBand[]): void {
    if (this.disposed) return

    for (const [id, view] of this.cloudViews) {
      if (!bands.some((band) => band.id === id)) {
        view.sheets.forEach((sheet) => sheet.dispose())
        view.materials.forEach((material) => material.dispose())
        view.texture.dispose()
        this.cloudViews.delete(id)
      }
    }

    bands.forEach((band, index) => {
      let view = this.cloudViews.get(band.id)
      if (!view) {
        view = this.createCloudView(band, index)
        this.cloudViews.set(band.id, view)
      }
      view.name = band.name

      if (view.maskKey !== band.mask) {
        this.uploadMask(view.texture, band.mask)
        view.maskKey = band.mask
      }

      view.sheets.forEach((sheet, sheetIndex) => {
        sheet.position.set(
          0,
          band.altitude + SHEET_OFFSETS[sheetIndex] * band.thickness,
          0,
        )
        sheet.isVisible = band.visible
        // Equal alphaIndex leaves ordering to Babylon's per-frame camera-distance sort.
        sheet.alphaIndex = Number.MAX_VALUE
      })

      view.materials.forEach((material) => {
        material.setFloat('coverage', band.coverage)
        material.setFloat('density', band.density)
      })
    })
  }

  private uploadMask(texture: DynamicTexture, base64Mask: string): void {
    const bytes = base64ToBytes(base64Mask, MASK_RES * MASK_RES)
    this.writeMaskBytes(texture, bytes)
  }

  private writeMaskBytes(texture: DynamicTexture, bytes: ArrayLike<number>): void {
    const context = texture.getContext() as CanvasRenderingContext2D
    const image = context.createImageData(MASK_RES, MASK_RES)
    for (let i = 0; i < MASK_RES * MASK_RES; i += 1) {
      const value = bytes[i] ?? 255
      image.data[i * 4] = value
      image.data[i * 4 + 1] = value
      image.data[i * 4 + 2] = value
      image.data[i * 4 + 3] = 255
    }
    context.putImageData(image, 0, 0)
    // true flips canvas top row to UV v=1, which maps to world -Z on the cloud plane.
    texture.update(true)
  }

  previewMask(bandId: string, bytes: ArrayLike<number>): void {
    const view = this.cloudViews.get(bandId)
    if (view) this.writeMaskBytes(view.texture, bytes)
  }

  private buildCameraPath(): void {
    const controls = [
      new Vector3(-190, 122, -166),
      new Vector3(-52, 148, -202),
      new Vector3(154, 132, -162),
      new Vector3(202, 158, 22),
      new Vector3(106, 128, 190),
      new Vector3(-98, 150, 180),
      new Vector3(-204, 124, 42),
    ]
    this.pathPoints = Curve3.CreateCatmullRomSpline(controls, 20, true).getPoints()
    this.pathLine = MeshBuilder.CreateLines(
      'aerial-camera-path',
      { points: this.pathPoints, updatable: false },
      this.scene,
    )
    this.pathLine.color = Color3.FromHexString('#67e8f9')
    this.pathLine.alpha = 0.7
    this.pathLine.isPickable = false

    this.marker = MeshBuilder.CreateSphere('camera-path-marker', { diameter: 7, segments: 16 }, this.scene)
    const markerMaterial = new StandardMaterial('path-marker-material', this.scene)
    markerMaterial.emissiveColor = Color3.FromHexString('#22d3ee')
    markerMaterial.diffuseColor = Color3.Black()
    this.marker.material = markerMaterial
    this.marker.isPickable = false
  }

  setPathVisible(visible: boolean): void {
    if (this.pathLine) this.pathLine.isEnabled(visible)
    this.marker?.setEnabled(visible)
  }

  setPathProgress(progress: number): void {
    this.pathProgressValue = Math.max(0, Math.min(1, progress))
    const points = this.pathPoints
    if (points.length < 2) return

    const scaled = this.pathProgressValue * (points.length - 1)
    const index = Math.floor(scaled)
    const blend = scaled - index
    const nextIndex = Math.min(points.length - 1, index + 1)
    const position = Vector3.Lerp(points[index], points[nextIndex], blend)

    const angle = this.pathProgressValue * Math.PI * 2
    const target = new Vector3(
      Math.sin(angle) * 18,
      25 + Math.sin(angle * 2) * 7,
      Math.cos(angle) * 18,
    )
    this.camera.setTarget(target)
    this.camera.setPosition(position)
    // The camera itself occupies the path sample, so draw the visible marker at its look target.
    this.marker?.position.copyFrom(target)
  }

  resetView(): void {
    this.playing = false
    this.setPathProgress(0)
    this.camera.alpha = -2.35
    this.camera.beta = 1.04
    this.camera.radius = 250
    const target = new Vector3(0, 30, 0)
    this.camera.setTarget(target)
    this.marker?.position.copyFrom(target)
  }

  getCloudOrder(): CloudOrderItem[] {
    const cameraPosition = this.camera.globalPosition
    return Array.from(this.cloudViews.values())
      .filter((view) => view.sheets.some((sheet) => sheet.isVisible))
      .map((view) => ({
        id: view.id,
        name: view.name,
        distance: Math.round(Vector3.Distance(view.sheets[1]?.position ?? Vector3.Zero(), cameraPosition)),
      }))
      .sort((a, b) => b.distance - a.distance)
  }

  resize(): void {
    this.engine.resize()
  }

  private frame(): void {
    if (this.disposed) return
    const delta = Math.min(0.05, this.engine.getDeltaTime() / 1000)
    this.elapsed += delta

    if (this.playing) {
      // Roughly 42 seconds for one closed circuit at speed 1.
      const next = (this.pathProgressValue + delta * 0.024 * this.speed) % 1
      this.setPathProgress(next)
      this.onProgress?.(next)
    }

    for (const view of this.cloudViews.values()) {
      for (const material of view.materials) {
        material.setFloat('time', this.elapsed)
        material.setVector3('cameraPosition', this.camera.globalPosition)
      }
    }

    this.orderElapsed += delta
    if (this.orderElapsed > 0.25) {
      this.orderElapsed = 0
      this.onOrder?.(this.getCloudOrder())
    }

    this.scene.render()
  }

  dispose(): void {
    this.disposed = true
    this.engine.stopRenderLoop()
    this.scene.dispose()
    this.engine.dispose()
  }
}
