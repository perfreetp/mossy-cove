export type ReliefStyle = 'rolling' | 'ridges' | 'alpine'

export type BrushMode = 'add' | 'erase'

export interface TerrainParams {
  /** Procedural noise seed. */
  seed: number
  /** Peak height in Babylon world units. */
  ridgeHeight: number
  /** Large-scale ridge frequency. */
  frequency: number
  /** 0..1 erosion amount. */
  erosion: number
  style: ReliefStyle
}

export interface CloudBand {
  id: string
  name: string
  /** Band centre height in world units. */
  altitude: number
  /** Vertical thickness in world units. */
  thickness: number
  /** 0..1 fraction of the sky covered by cloud. */
  coverage: number
  /** 0..1 opacity / cloud density. */
  density: number
  visible: boolean
  /** Base64 encoded MASK_RES * MASK_RES bytes. Empty means fully allowed. */
  mask: string
}

export interface ProjectData {
  app: 'cloud-sea-terrain-generator'
  formatVersion: 1
  name: string
  heightResolution: number
  maskResolution: number
  terrain: TerrainParams
  /** Normalized 0..1 height field, row-major HEIGHT_RES². */
  heights: number[]
  bands: CloudBand[]
}

export interface ProjectFile {
  app: 'cloud-sea-terrain-generator'
  formatVersion: 1
  exportedAt: string
  project: ProjectData
}

export interface CameraViewState {
  progress: number
  playing: boolean
  showPath: boolean
  speed: number
  order: Array<{ id: string; name: string; distance: number }>
}
