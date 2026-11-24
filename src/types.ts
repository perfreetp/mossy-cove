export type Vec3 = [number, number, number]
export type Point2 = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }

export type FaceKind = 'wall' | 'fascia' | 'top' | 'counter' | 'display'

export interface FaceDef {
  id: string
  name: string
  group: string
  kind: FaceKind
  width: number
  height: number
  /** Top-left, top-right, bottom-right, bottom-left in booth coordinates (cm). */
  corners: [Vec3, Vec3, Vec3, Vec3]
  normal: Vec3
  textAllowed: boolean
}

export interface LaidFace extends FaceDef {
  rect: Rect
}

export interface BoothModel {
  id: string
  name: string
  tagline: string
  description: string
  width: number
  depth: number
  height: number
  faceCount: number
  textFaceCount: number
  sheet: { width: number; height: number }
  faces: LaidFace[]
}

export type MaterialFinish = 'matte' | 'metal' | 'wood' | 'glass' | 'light'

export interface MaterialDef {
  id: string
  name: string
  category: string
  color: string
  color2: string
  metalness: number
  roughness: number
  opacity?: number
  emissive?: string
  emissiveIntensity?: number
  finish: MaterialFinish
}

export interface TextBlock {
  id: string
  faceId: string
  content: string
  fontId: 'noto' | 'montserrat'
  /** Center position, normalized inside the unfolded face rectangle. */
  nx: number
  ny: number
  /** Design units (cm-equivalent on the booth elevation). */
  fontSize: number
  letterSpacing: number
  lineHeight: number
  color: string
  bold: boolean
}

export interface Scheme {
  schema: 'booth-brand-scheme'
  schemaVersion: 1
  name: string
  modelId: string
  assignments: Record<string, string>
  texts: TextBlock[]
  updatedAt: string
}

export interface SchemeSlot {
  id: string
  label: string
  savedAt: string | null
  scheme: Scheme | null
}

export interface OutlineData {
  d: string
  width: number
  height: number
  x1: number
  y1: number
  x2: number
  y2: number
  lines: number
}

export interface BoundaryState {
  overflowX: number
  overflowY: number
  out: boolean
}
