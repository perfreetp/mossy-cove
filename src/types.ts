export type Vec2 = { x: number; z: number }

export type BuildingCategory = 'residential' | 'tower' | 'warehouse'

export type RoofStyle = 'flat' | 'gable' | 'hip'

export interface BuildingDef {
  defId: string
  name: string
  category: BuildingCategory
  tier: number
  tierName: string
  width: number
  depth: number
  height: number
  color: string
  roof: RoofStyle
}

export interface Building {
  id: string
  defId: string
  name: string
  category: BuildingCategory
  tier: number
  tierName: string
  width: number
  depth: number
  height: number
  color: string
  roof: RoofStyle
  x: number
  z: number
  rotation: number
  streetId?: string | null
  streetSide?: 1 | -1 | null
  streetU?: number | null
}

export interface Street {
  id: string
  name: string
  points: Vec2[]
  width: number
  setback: number
  color: string
}

export interface Settings {
  gridSize: number
  snapThreshold: number
  showGrid: boolean
  showStreetLabels: boolean
  autoStreetAlign: boolean
}

export interface ProjectSnapshot {
  buildings: Building[]
  streets: Street[]
}

export interface ExportedBuilding {
  id: string
  defId: string
  name: string
  category: BuildingCategory
  tier: number
  tierName: string
  roof: RoofStyle
  position: { x: number; y: number; z: number }
  dimensions: { width: number; depth: number; height: number }
  orientation: { radians: number; degrees: number; stepDegrees: 15 }
  streetBinding: { streetId: string; side: 1 | -1; u: number } | null
  // Flat compatibility fields for simple scripts and spreadsheet transforms.
  x: number
  z: number
  width: number
  depth: number
  height: number
  rotation: number
  rotationDegrees: number
}

export interface ProjectFile {
  app: 'mini-sandbox-planner'
  formatVersion: 1
  exportedAt: string
  settings?: Settings
  buildings: ExportedBuilding[]
  streets: Street[]
}

export interface MarqueeRect {
  x1: number
  y1: number
  x2: number
  y2: number
}
