export type Vec3Tuple = [number, number, number]

export interface MeshGeometryData {
  positions: Float32Array
  indices: Uint32Array
}

export interface ControlPoint {
  position: Vec3Tuple
  normal: Vec3Tuple
}

export type MeasureStatus = 'idle' | 'calculating' | 'ready' | 'error'

export interface Lesion {
  id: string
  name: string
  color: string
  visible: boolean
  points: ControlPoint[]
  thickness: number
  smoothing: number
  geometry: MeshGeometryData | null
  occupiedGeometry: MeshGeometryData | null
  rawVolumeMm3: number | null
  volumeMm3: number | null
  organRatio: number | null
  sectionAreaMm2: number | null
  measureStatus: MeasureStatus
  measureMessage: string
  booleanHistory: string[]
  createdAt: number
}

export type SimplifyLevel = 0 | 1 | 2 | 3

export interface OrganState {
  status: 'empty' | 'loading' | 'ready' | 'error'
  busy: boolean
  name: string
  format: string
  error: string
  original: MeshGeometryData | null
  geometry: MeshGeometryData | null
  simplifyLevel: SimplifyLevel
  originalFaceCount: number
  faceCount: number
  vertexCount: number
  size: Vec3Tuple
  min: Vec3Tuple
  max: Vec3Tuple
  volumeMm3: number | null
  csgStatus: string
  csgSource: string
}

export type ViewMode = 'all' | 'lesions' | 'organ'
export type ModuleTab = 'load' | 'draw' | 'measure' | 'section'

export interface SectionState {
  enabled: boolean
  active: boolean
  normal: Vec3Tuple
  position: number
  flip: boolean
  organAreaMm2: number | null
  dragging: boolean
}

export interface Toast {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  message: string
}

export interface ProjectFileMesh {
  positionsB64: string
  indicesB64: string
}

export interface ProjectFile {
  app: 'ct-mri-lesion-studio'
  formatVersion: 1
  exportedAt: string
  organ: {
    name: string
    format: string
    simplifyLevel: SimplifyLevel
    originalFaceCount: number
    original: ProjectFileMesh
  } | null
  lesions: Array<{
    id: string
    name: string
    color: string
    visible: boolean
    points: ControlPoint[]
    thickness: number
    smoothing: number
    geometry: ProjectFileMesh | null
    occupiedGeometry: ProjectFileMesh | null
    rawVolumeMm3: number | null
    volumeMm3: number | null
    organRatio: number | null
    sectionAreaMm2: number | null
    measureStatus: MeasureStatus
    measureMessage: string
    booleanHistory: string[]
    createdAt: number
  }>
  thresholdMl: number
  section: Pick<SectionState, 'enabled' | 'normal' | 'position' | 'flip'>
  viewMode: ViewMode
  activeLesionId: string | null
}
