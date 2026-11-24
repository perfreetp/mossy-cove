import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ControlPoint, MeshGeometryData, Vec3Tuple } from './types'

export function cloneMeshData(data: MeshGeometryData): MeshGeometryData {
  return {
    positions: new Float32Array(data.positions),
    indices: new Uint32Array(data.indices),
  }
}

export function toBufferGeometry(data: MeshGeometryData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.positions), 3))
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(data.indices), 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function fromBufferGeometry(input: THREE.BufferGeometry): MeshGeometryData {
  let geometry = input
  if (!geometry.index) {
    const count = geometry.getAttribute('position').count
    const indices = new Uint32Array(count)
    for (let i = 0; i < count; i++) indices[i] = i
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  }

  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const sourceIndices = geometry.index!
  const positions = new Float32Array(position.array.length)
  positions.set(position.array as ArrayLike<number>)

  const indices = new Uint32Array(sourceIndices.count)
  for (let i = 0; i < sourceIndices.count; i++) {
    indices[i] = sourceIndices.getX(i)
  }

  return { positions, indices }
}

function positionOnlyNonIndexed(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = g.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) throw new Error('网格缺少 position 顶点属性')
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position.array), 3))
  g.dispose()
  return out
}

export function prepareLoadedObject(root: THREE.Object3D): MeshGeometryData {
  root.updateMatrixWorld(true)
  const parts: THREE.BufferGeometry[] = []

  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    let g = mesh.geometry.clone()
    g.applyMatrix4(mesh.matrixWorld)
    parts.push(positionOnlyNonIndexed(g))
    g.dispose()
  })

  if (parts.length === 0) throw new Error('文件中没有找到可读取的三角网格')

  let merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)
  if (!merged) throw new Error('无法合并文件中的网格')

  merged = mergeVertices(merged, 1e-5)
  merged.computeBoundingBox()
  const center = new THREE.Vector3()
  merged.boundingBox!.getCenter(center)
  merged.translate(-center.x, -center.y, -center.z)
  merged.computeBoundingBox()
  merged.computeVertexNormals()

  for (const part of parts) part.dispose()

  const result = fromBufferGeometry(merged)
  merged.dispose()
  if (result.indices.length < 3) throw new Error('网格中没有有效三角面')
  return result
}

export async function readMeshFile(file: File): Promise<MeshGeometryData> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

  if (ext === 'stl') {
    const buffer = await file.arrayBuffer()
    const geometry = new STLLoader().parse(buffer)
    geometry.computeVertexNormals()
    return prepareGeometryDirect(geometry)
  }

  if (ext === 'ply') {
    const buffer = await file.arrayBuffer()
    const geometry = new PLYLoader().parse(buffer)
    geometry.computeVertexNormals()
    return prepareGeometryDirect(geometry)
  }

  if (ext === 'obj') {
    const text = await file.text()
    const object = new OBJLoader().parse(text)
    return prepareLoadedObject(object)
  }

  if (ext === 'glb' || ext === 'gltf') {
    const path = ''
    if (ext === 'glb') {
      const buffer = await file.arrayBuffer()
      const gltf = await parseGltf(buffer, path)
      return prepareLoadedObject(gltf.scene)
    }
    const text = await file.text()
    const gltf = await parseGltf(text, path)
    return prepareLoadedObject(gltf.scene)
  }

  throw new Error(`暂不支持 .${ext} 格式，请选择 STL、OBJ、PLY、GLB 或 glTF 文件`)
}

function parseGltf(data: ArrayBuffer | string, path: string): Promise<{ scene: THREE.Group }> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      data,
      path,
      (gltf) => resolve(gltf as unknown as { scene: THREE.Group }),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    )
  })
}

function prepareGeometryDirect(geometry: THREE.BufferGeometry): MeshGeometryData {
  let g = positionOnlyNonIndexed(geometry)
  g = mergeVertices(g, 1e-5)
  g.computeBoundingBox()
  const center = new THREE.Vector3()
  g.boundingBox!.getCenter(center)
  g.translate(-center.x, -center.y, -center.z)
  g.computeVertexNormals()
  const result = fromBufferGeometry(g)
  g.dispose()
  geometry.dispose()
  return result
}

export function createSampleOrganData(): MeshGeometryData {
  const geometry = new THREE.SphereGeometry(1, 96, 64)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()

  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i)
    const wave =
      1 +
      0.045 * Math.sin(v.x * 5.1 + v.y * 2.3) +
      0.03 * Math.cos(v.z * 6.7 - v.y * 3.1) +
      0.018 * Math.sin((v.x + v.z) * 9.0)
    v.x *= 64 * wave * (1 + 0.05 * v.y)
    v.y *= 43 * wave
    v.z *= 52 * wave * (1 - 0.035 * v.x)
    position.setXYZ(i, v.x, v.y, v.z)
  }

  const positionOnly = positionOnlyNonIndexed(geometry)
  const welded = mergeVertices(positionOnly, 1e-5)
  welded.computeVertexNormals()
  const result = fromBufferGeometry(welded)
  welded.dispose()
  positionOnly.dispose()
  geometry.dispose()
  return result
}

export const SIMPLIFY_RATIOS = [1, 0.62, 0.32, 0.14] as const
export const SIMPLIFY_LABELS = ['原始精度', '轻度简化', '均衡档位', '流畅档位'] as const

export async function simplifyMeshData(data: MeshGeometryData, level: number): Promise<MeshGeometryData> {
  const ratio = SIMPLIFY_RATIOS[level] ?? 1
  if (ratio >= 0.999) return cloneMeshData(data)

  try {
    const geometry = toBufferGeometry(data)
    const vertexCount = geometry.getAttribute('position').count
    const removeCount = Math.floor(vertexCount * (1 - ratio))
    const safeRemove = Math.max(1, Math.min(removeCount, vertexCount - 8))
    const simplified = await new SimplifyModifier().modify(geometry, safeRemove)
    const result = fromBufferGeometry(simplified)
    geometry.dispose()
    simplified.dispose()
    if (result.indices.length < 12 || result.positions.length < 9) {
      throw new Error('simplifier returned empty mesh')
    }
    return result
  } catch (error) {
    console.warn('SimplifyModifier failed, using vertex clustering fallback', error)
    return clusterSimplify(data, ratio)
  }
}

function clusterSimplify(data: MeshGeometryData, ratio: number): MeshGeometryData {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  const p = data.positions
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i])
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1])
    minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2])
  }
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6)
  const originalVertices = p.length / 3
  const targetVertices = Math.max(24, Math.floor(originalVertices * ratio))
  const axisCells = Math.max(5, Math.ceil(Math.cbrt(targetVertices) * 1.7))
  const cellSize = size / axisCells

  const clusterIndex = new Map<string, number>()
  const sums: number[] = []
  const counts: number[] = []
  const oldToNew = new Uint32Array(originalVertices)

  for (let i = 0; i < originalVertices; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
    const ix = Math.floor((x - minX) / cellSize)
    const iy = Math.floor((y - minY) / cellSize)
    const iz = Math.floor((z - minZ) / cellSize)
    const key = `${ix},${iy},${iz}`
    let next = clusterIndex.get(key)
    if (next === undefined) {
      next = sums.length / 3
      clusterIndex.set(key, next)
      sums.push(x, y, z)
      counts.push(1)
    } else {
      sums[next * 3] += x
      sums[next * 3 + 1] += y
      sums[next * 3 + 2] += z
      counts[next]++
    }
    oldToNew[i] = next
  }

  const positions = new Float32Array(sums.length)
  for (let i = 0; i < counts.length; i++) {
    positions[i * 3] = sums[i * 3] / counts[i]
    positions[i * 3 + 1] = sums[i * 3 + 1] / counts[i]
    positions[i * 3 + 2] = sums[i * 3 + 2] / counts[i]
  }

  const indices: number[] = []
  for (let i = 0; i < data.indices.length; i += 3) {
    const a = oldToNew[data.indices[i]]
    const b = oldToNew[data.indices[i + 1]]
    const c = oldToNew[data.indices[i + 2]]
    if (a !== b && b !== c && a !== c) indices.push(a, b, c)
  }

  return { positions, indices: new Uint32Array(indices) }
}

export function averageEdgeLength(points: ControlPoint[]): number {
  if (points.length < 2) return 10
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i].position
    const b = points[(i + 1) % points.length].position
    total += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  }
  return total / points.length
}

export function createContourExtrusion(
  controlPoints: ControlPoint[],
  thickness: number,
  smoothing: number,
): MeshGeometryData {
  if (controlPoints.length < 3) throw new Error('至少需要 3 个控制点才能闭合区域')

  const centroid = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (const point of controlPoints) {
    centroid.add(new THREE.Vector3(...point.position))
    normal.add(new THREE.Vector3(...point.normal))
  }
  centroid.multiplyScalar(1 / controlPoints.length)
  if (normal.lengthSq() < 1e-10) normal.set(0, 0, 1)
  normal.normalize()

  const helper = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const u = new THREE.Vector3().crossVectors(helper, normal).normalize()
  const v = new THREE.Vector3().crossVectors(normal, u).normalize()

  const shape = new THREE.Shape()
  const coords: Array<[number, number]> = []
  for (const cp of controlPoints) {
    const delta = new THREE.Vector3(...cp.position).sub(centroid)
    const x = delta.dot(u)
    const y = delta.dot(v)
    coords.push([x, y])
  }
  shape.moveTo(coords[0][0], coords[0][1])
  for (let i = 1; i < coords.length; i++) shape.lineTo(coords[i][0], coords[i][1])
  shape.closePath()

  const edge = averageEdgeLength(controlPoints)
  const smooth = THREE.MathUtils.clamp(Math.round(smoothing), 0, 3)
  const bevelEnabled = smooth > 0
  const bevelSize = bevelEnabled ? edge * (0.045 + smooth * 0.035) : 0
  const bevelThickness = bevelEnabled ? thickness * (0.05 + smooth * 0.035) : 0

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.1, thickness),
    steps: 1,
    bevelEnabled,
    bevelSegments: smooth * 2 + 1,
    bevelSize,
    bevelThickness,
    curveSegments: 10 + smooth * 4,
  })

  geometry.computeBoundingBox()
  const zCenter = (geometry.boundingBox!.min.z + geometry.boundingBox!.max.z) / 2
  geometry.translate(0, 0, -zCenter)

  const basis = new THREE.Matrix4().makeBasis(u, v, normal)
  basis.setPosition(centroid)
  geometry.applyMatrix4(basis)

  const positionOnly = positionOnlyNonIndexed(geometry)
  const welded = mergeVertices(positionOnly, 1e-5)
  welded.computeVertexNormals()

  const result = fromBufferGeometry(welded)
  welded.dispose()
  positionOnly.dispose()
  geometry.dispose()
  return result
}

export function getBounds(data: MeshGeometryData): {
  min: Vec3Tuple
  max: Vec3Tuple
  size: Vec3Tuple
  center: Vec3Tuple
} {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  const p = data.positions
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
  }
  if (!Number.isFinite(minX)) {
    minX = minY = minZ = maxX = maxY = maxZ = 0
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  }
}

export function signedVolumeMm3(data: MeshGeometryData): number {
  const p = data.positions
  const idx = data.indices
  let volume = 0
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i] * 3, ib = idx[i + 1] * 3, ic = idx[i + 2] * 3
    const ax = p[ia], ay = p[ia + 1], az = p[ia + 2]
    const bx = p[ib], by = p[ib + 1], bz = p[ib + 2]
    const cx = p[ic], cy = p[ic + 1], cz = p[ic + 2]
    volume +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx)
  }
  return Math.abs(volume) / 6
}

export function randomSurfacePoints(
  data: MeshGeometryData,
  count: number,
  seed = 1,
): ControlPoint[] {
  const geometry = toBufferGeometry(data)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const index = geometry.index!
  const points: ControlPoint[] = []

  const center = new THREE.Vector3()
  new THREE.Box3().setFromBufferAttribute(position).getCenter(center)

  let state = seed >>> 0
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }

  for (let k = 0; k < count; k++) {
    const triangle = Math.floor(rand() * (index.count / 3)) * 3
    const ia = index.getX(triangle), ib = index.getX(triangle + 1), ic = index.getX(triangle + 2)
    const a = new THREE.Vector3().fromBufferAttribute(position, ia)
    const b = new THREE.Vector3().fromBufferAttribute(position, ib)
    const c = new THREE.Vector3().fromBufferAttribute(position, ic)
    let r1 = rand(), r2 = rand()
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2 }
    const point = a.clone().addScaledVector(b.clone().sub(a), r1).addScaledVector(c.clone().sub(a), r2)
    const normal = new THREE.Vector3()
      .crossVectors(b.clone().sub(a), c.clone().sub(a))
      .normalize()
    const outward = point.clone().sub(center)
    if (normal.dot(outward) < 0) normal.negate()
    points.push({
      position: [point.x, point.y, point.z],
      normal: [normal.x, normal.y, normal.z],
    })
  }

  geometry.dispose()
  return points
}
