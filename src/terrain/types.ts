export type ToolMode = 'sculpt' | 'building';
export type BrushType = 'raise' | 'lower' | 'smooth' | 'flatten';

export interface BrushSettings {
  type: BrushType;
  radius: number;
  strength: number;
}

export interface Building {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  color: string;
}

export interface SectionSettings {
  xEnabled: boolean;
  yEnabled: boolean;
  zEnabled: boolean;
  x: number;
  y: number;
  z: number;
}

export interface ProjectData {
  format: 'micro-sandbox-terrain';
  version: 1;
  name: string;
  savedAt?: string;
  resolution: number;
  cellSize: number;
  heightField: number[];
  buildings: Building[];
  waterLevel: number;
  waterEnabled: boolean;
  showContours: boolean;
  strataBoundaries: number[];
  sections: SectionSettings;
}

export interface UiState {
  ready: boolean;
  name: string;
  tool: ToolMode;
  brush: BrushSettings;
  resolution: number;
  cellSize: number;
  buildingCount: number;
  buildings: Building[];
  canUndo: boolean;
  canRedo: boolean;
  waterLevel: number;
  waterEnabled: boolean;
  showContours: boolean;
  heightMin: number;
  heightMax: number;
  contourInterval: number;
  contourLevels: number[];
  strataBoundaries: number[];
  strataColors: string[];
  strataNames: string[];
  sections: SectionSettings;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  savedAt: string | null;
  stats: { vertices: number; triangles: number; instances: number };
}
