import Module from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import type { Manifold, ManifoldToplevel } from 'manifold-3d/manifold'
import { signedVolumeMm3 } from './geometry'
import type { MeshGeometryData } from './types'

export interface MeasurementResult {
  rawVolumeMm3: number
  volumeMm3: number | null
  ratio: number | null
  geometry: MeshGeometryData | null
  status: string
}

class ManifoldEngine {
  private module: ManifoldToplevel | null = null
  private initPromise: Promise<ManifoldToplevel> | null = null
  private organ: Manifold | null = null
  organVolumeMm3: number | null = null

  init(): Promise<ManifoldToplevel> {
    if (this.initPromise) return this.initPromise
    this.initPromise = Module({ locateFile: () => wasmUrl }).then((mod) => {
      mod.setup()
      this.module = mod
      return mod
    })
    return this.initPromise
  }

  async ready(): Promise<ManifoldToplevel> {
    return this.init()
  }

  private toManifold(data: MeshGeometryData): Manifold {
    if (!this.module) throw new Error('Manifold WASM 尚未初始化')
    const { Manifold: M, Mesh } = this.module
    return new M(
      new Mesh({
        numProp: 3,
        vertProperties: data.positions,
        triVerts: data.indices,
      }),
    )
  }

  setOrgan(data: MeshGeometryData): string {
    if (!this.module) throw new Error('Manifold WASM 尚未初始化')
    this.clearOrgan()
    const candidate = this.toManifold(data)
    const status = candidate.status()
    if (status === 'NoError' && !candidate.isEmpty()) {
      this.organ = candidate
      this.organVolumeMm3 = Math.abs(candidate.volume())
      return status
    }
    candidate.delete()
    this.organVolumeMm3 = null
    return status
  }

  clearOrgan() {
    this.organ?.delete()
    this.organ = null
    this.organVolumeMm3 = null
  }

  private fromManifold(result: Manifold): MeshGeometryData | null {
    if (result.isEmpty() || result.numTri() === 0) return null
    const mesh = result.getMesh()
    const numProp = mesh.numProp || 3
    const vertexCount = mesh.vertProperties.length / numProp
    const positions = new Float32Array(vertexCount * 3)
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = mesh.vertProperties[i * numProp]
      positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1]
      positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2]
    }
    const indices = new Uint32Array(mesh.triVerts.length)
    indices.set(mesh.triVerts)
    return { positions, indices }
  }

  async measure(data: MeshGeometryData): Promise<MeasurementResult> {
    await this.ready()
    let lesion: Manifold | null = null
    let rawVolumeMm3 = signedVolumeMm3(data)
    let lesionStatus = 'NoError'

    try {
      lesion = this.toManifold(data)
      const manifoldVolume = Math.abs(lesion.volume())
      if (Number.isFinite(manifoldVolume) && manifoldVolume > 0) rawVolumeMm3 = manifoldVolume
      lesionStatus = lesion.status()
    } catch (error) {
      lesionStatus = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : 'NotManifold'
      lesion?.delete()
      lesion = null
    }

    if (!lesion || lesionStatus !== 'NoError') {
      lesion?.delete()
      return {
        rawVolumeMm3,
        volumeMm3: this.organ ? null : rawVolumeMm3,
        ratio: null,
        geometry: null,
        status: `Lesion${lesionStatus}`,
      }
    }

    let intersected: Manifold | null = null

    try {
      if (!this.organ) {
        return {
          rawVolumeMm3,
          volumeMm3: rawVolumeMm3,
          ratio: null,
          geometry: null,
          status: 'OrganUnavailable',
        }
      }

      intersected = this.module!.Manifold.intersection(this.organ, lesion)
      const status = intersected.status()
      if (status !== 'NoError') {
        return { rawVolumeMm3, volumeMm3: null, ratio: null, geometry: null, status }
      }

      const volumeMm3 = Math.abs(intersected.volume())
      const geometry = this.fromManifold(intersected)
      const ratio = this.organVolumeMm3 && this.organVolumeMm3 > 0 ? volumeMm3 / this.organVolumeMm3 : null
      return { rawVolumeMm3, volumeMm3, ratio, geometry, status }
    } finally {
      intersected?.delete()
      lesion.delete()
    }
  }

  async boolean(
    aData: MeshGeometryData,
    bData: MeshGeometryData,
    operation: 'union' | 'difference',
  ): Promise<{ geometry: MeshGeometryData; volumeMm3: number; status: string }> {
    await this.ready()
    const a = this.toManifold(aData)
    const b = this.toManifold(bData)
    let result: Manifold | null = null
    try {
      result = operation === 'union' ? a.add(b) : a.subtract(b)
      const status = result.status()
      if (status !== 'NoError') throw new Error(`布尔运算失败：${status}`)
      const geometry = this.fromManifold(result)
      if (!geometry) throw new Error('布尔运算结果为空网格')
      return { geometry, volumeMm3: Math.abs(result.volume()), status }
    } finally {
      result?.delete()
      a.delete()
      b.delete()
    }
  }
}

export const manifoldEngine = new ManifoldEngine()
