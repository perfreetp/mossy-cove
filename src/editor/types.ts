export type Side = 'left' | 'right';
export type EditorMode = 'brow' | 'lash';
export type Tool = 'draw' | 'adjust' | 'erase';
export type Density = 'sparse' | 'natural' | 'dense';

export interface Point2 {
  x: number;
  y: number;
}

export interface BrowPoint extends Point2 {
  id: string;
  /** Half-width of the brow body in world units. */
  width: number;
  /** 0 = square/full endpoint, 1 = fully tapered tip. Only endpoint values are used. */
  taper: number;
}

export interface Brow {
  id: Side;
  points: BrowPoint[];
  /** Mirror link for interval i, between points[i] and points[i+1]. */
  segmentMirror: boolean[];
  density: Density;
  color: string;
}

export interface Lash {
  id: string;
  side: Side;
  /** Position on the upper eyelid curve, 0 = inner corner, 1 = outer corner. */
  t: number;
  /** UI length value; converted to world units by the renderer. */
  length: number;
  /** Curl angle in degrees. */
  curl: number;
  /** UI thickness value. */
  thickness: number;
  rowId: string | null;
}

export interface LashRow {
  id: string;
  side: Side;
  name: string;
  /** Whole-row fan/rotation angle in degrees. */
  rotation: number;
  /** Extra offset away from the eyelid, used by duplicated rows. */
  lift: number;
}

export interface ProjectDocument {
  format: 'brow-lash-studio';
  version: 1;
  mirror: boolean;
  brows: Record<Side, Brow>;
  lashes: Lash[];
  rows: LashRow[];
}

export interface SelectionState {
  side: Side;
  browPointId: string | null;
  lashId: string | null;
  rowId: string | null;
}

export interface SelectionPatch {
  side?: Side;
  browPointId?: string | null;
  lashId?: string | null;
  rowId?: string | null;
}

export type RefreshKind = 'all' | 'brows' | 'lashes' | 'selection';

export const DENSITY_COUNTS: Record<Density, number> = {
  sparse: 72,
  natural: 148,
  dense: 286,
};

export const DENSITY_LABELS: Record<Density, string> = {
  sparse: '稀疏',
  natural: '自然',
  dense: '浓密',
};
