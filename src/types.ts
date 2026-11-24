export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export interface Pose {
  position: Vec3Tuple;
  quaternion: QuatTuple;
  scale: Vec3Tuple;
}

export type FragmentCategory =
  | '未归类'
  | '股骨'
  | '胫骨'
  | '腓骨'
  | '肱骨'
  | '桡尺骨'
  | '椎骨'
  | '骨盆'
  | '颅骨'
  | '其他';

export interface FragmentRecord {
  id: string;
  code: string;
  name: string;
  category: FragmentCategory;
  color: string;
  visible: boolean;
  opacity: number;
  groupId: string | null;
  geometryId: string;
  sourceName?: string;
  vertexCount: number;
  triangleCount: number;
  pose: Pose;
  createdAt: number;
}

export interface AssemblyGroup {
  id: string;
  name: string;
  color: string;
  memberIds: string[];
  pose: Pose;
  lockedAt: number;
}

export interface CorrespondencePair {
  id: string;
  aId: string;
  bId: string;
  aLocal: Vec3Tuple;
  bLocal: Vec3Tuple;
  createdAt: number;
}

export interface PairResidual {
  pairId: string;
  distance: number;
  aWorld: Vec3Tuple;
  bAlignedWorld: Vec3Tuple;
  direction: Vec3Tuple;
  overThreshold: boolean;
}

export interface RegistrationReport {
  aId: string;
  bId: string;
  pairCount: number;
  rms: number;
  maxResidual: number;
  meanResidual: number;
  threshold: number;
  acceptable: boolean;
  residuals: PairResidual[];
  evaluatedAt: number;
}

export interface InterferenceReport {
  aId: string;
  bId: string;
  intersectionVolume: number;
  smallerVolume: number;
  overlapRatio: number;
  minGap: number;
  blocking: boolean;
  manifold: boolean;
  message: string;
  evaluatedAt: number;
}

export interface SerializedGeometry {
  geometryId: string;
  format: 'bone-pack-geometry-v1';
  vertexCount: number;
  indexCount: number;
  positionBase64: string;
  indexBase64?: string;
}

export interface ProjectSettings {
  residualThreshold: number;
  overlapRatioLimit: number;
  gapSearchLength: number;
  showGrid: boolean;
  showAxes: boolean;
  deviationArrows: boolean;
}

export interface ProjectFile {
  app: 'bone-fragment-reassembly';
  formatVersion: 1;
  exportedAt: string;
  projectName: string;
  fragments: FragmentRecord[];
  groups: AssemblyGroup[];
  pairs: CorrespondencePair[];
  settings: ProjectSettings;
  geometries: SerializedGeometry[];
  lastRegistration?: RegistrationReport | null;
}

export interface PoseReportFragment {
  id: string;
  code: string;
  name: string;
  category: FragmentCategory;
  groupId: string | null;
  position: Vec3Tuple;
  quaternion: QuatTuple;
  eulerDegrees: Vec3Tuple;
  scale: Vec3Tuple;
  matrixWorld: number[];
}

export interface PoseReport {
  app: 'bone-fragment-reassembly';
  reportType: 'final-poses-and-groups';
  formatVersion: 1;
  exportedAt: string;
  coordinateConvention: 'Three.js right-handed, Y-up';
  projectName: string;
  fragments: PoseReportFragment[];
  groups: Array<Omit<AssemblyGroup, 'pose'> & { pose: Pose; memberCodes: string[] }>;
  registration?: RegistrationReport | null;
  interference?: InterferenceReport | null;
}
