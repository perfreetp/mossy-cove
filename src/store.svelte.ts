import { Box3, Vector3 } from 'three';
import type {
  Box3JSON,
  EvidenceMarker,
  EvidenceType,
  PathKeyPoint,
  SceneProject,
  TourPath,
  Vec3JSON
} from './types';
import { HistoryStack, cloneState } from './lib/history';
import { uid } from './lib/util';
import type { CloudRecord } from './lib/db';

/**
 * 全局工程状态。Svelte 5 runes 类，组件直接访问字段即可获得响应式。
 * 标记、路径、裁剪盒各自维护独立撤销/重做栈，互不干扰。
 */
export class ProjectStore {
  // ---------- 点云 ----------
  cloudRecord = $state<CloudRecord | null>(null);
  cloudLoading = $state(false);
  cloudProgress = $state(0);
  cloudError = $state<string | null>(null);

  // ---------- 裁剪 ----------
  clipBox = $state<Box3JSON | null>(null);
  private clipHistory = new HistoryStack<Box3JSON | null>();

  // ---------- 证据标记 ----------
  markers = $state<EvidenceMarker[]>([]);
  private markerHistory = new HistoryStack<EvidenceMarker[]>();
  /** 下一个放置标记使用的类型 */
  activeMarkerType = $state<EvidenceType>('blood');
  placeMode = $state(false);

  // ---------- 漫游路径 ----------
  paths = $state<TourPath[]>([]);
  activePathId = $state<string | null>(null);
  private pathHistory = new HistoryStack<TourPath[]>();
  recordMode = $state(false);

  /**
   * 活动路径。注意：Svelte 5 对类内 $derived 字段的模板追踪不稳定，
   * 这里保留普通 getter 供逻辑代码调用；组件侧用 $derived(store.activePath)
   * 建立显式响应式依赖。
   */
  get activePath(): TourPath | null {
    return this.paths.find((p) => p.id === this.activePathId) ?? this.paths[0] ?? null;
  }

  // ---------- 撤销/重做可用性（驱动按钮禁用态） ----------
  markerCanUndo = $state(false);
  markerCanRedo = $state(false);
  pathCanUndo = $state(false);
  pathCanRedo = $state(false);
  clipCanUndo = $state(false);
  clipCanRedo = $state(false);

  // ---------- 漫游播放 ----------
  touring = $state(false);

  // ================= 裁剪 =================

  setClipBox(box: Box3 | Box3JSON | null, record = true): void {
    if (record) {
      this.clipHistory.push(cloneState(this.clipBox));
    }
    if (box === null) {
      this.clipBox = null;
    } else if (box instanceof Box3) {
      this.clipBox = {
        min: { x: box.min.x, y: box.min.y, z: box.min.z },
        max: { x: box.max.x, y: box.max.y, z: box.max.z }
      };
    } else {
      this.clipBox = cloneState(box);
    }
    this.refreshClipFlags();
  }

  undoClip(): void {
    const r = this.clipHistory.undo(cloneState(this.clipBox));
    if (r) {
      this.clipBox = r.snapshot;
      this.refreshClipFlags();
    }
  }

  redoClip(): void {
    const r = this.clipHistory.redo(cloneState(this.clipBox));
    if (r) {
      this.clipBox = r.snapshot;
      this.refreshClipFlags();
    }
  }

  private refreshClipFlags(): void {
    this.clipCanUndo = this.clipHistory.canUndo;
    this.clipCanRedo = this.clipHistory.canRedo;
  }

  // ================= 证据标记 =================

  private nextSeq(type: EvidenceType): number {
    const used = this.markers.filter((m) => m.type === type).map((m) => m.seq);
    let seq = 1;
    while (used.includes(seq)) seq++;
    return seq;
  }

  addMarker(type: EvidenceType, position: Vec3JSON, note = ''): EvidenceMarker {
    this.markerHistory.push(cloneState(this.markers));
    const marker: EvidenceMarker = {
      id: uid('mk'),
      seq: this.nextSeq(type),
      type,
      position: { ...position },
      note,
      createdAt: Date.now()
    };
    this.markers = [...this.markers, marker];
    this.refreshMarkerFlags();
    return marker;
  }

  updateMarkerPosition(id: string, position: Vec3JSON): void {
    this.markerHistory.push(cloneState(this.markers));
    this.markers = this.markers.map((m) =>
      m.id === id ? { ...m, position: { ...position } } : m
    );
    this.refreshMarkerFlags();
  }

  updateMarkerNote(id: string, note: string): void {
    this.markerHistory.push(cloneState(this.markers));
    this.markers = this.markers.map((m) => (m.id === id ? { ...m, note } : m));
    this.refreshMarkerFlags();
  }

  updateMarkerType(id: string, type: EvidenceType): void {
    this.markerHistory.push(cloneState(this.markers));
    this.markers = this.markers.map((m) =>
      m.id === id ? { ...m, type, seq: this.nextSeq(type) } : m
    );
    this.refreshMarkerFlags();
  }

  removeMarker(id: string): void {
    this.markerHistory.push(cloneState(this.markers));
    this.markers = this.markers.filter((m) => m.id !== id);
    this.refreshMarkerFlags();
  }

  undoMarker(): void {
    const r = this.markerHistory.undo(cloneState(this.markers));
    if (r) {
      this.markers = r.snapshot;
      this.refreshMarkerFlags();
    }
  }

  redoMarker(): void {
    const r = this.markerHistory.redo(cloneState(this.markers));
    if (r) {
      this.markers = r.snapshot;
      this.refreshMarkerFlags();
    }
  }

  private refreshMarkerFlags(): void {
    this.markerCanUndo = this.markerHistory.canUndo;
    this.markerCanRedo = this.markerHistory.canRedo;
  }

  // ================= 路径 =================

  ensurePath(): TourPath {
    let path = this.activePath;
    if (!path) {
      path = { id: uid('path'), name: `巡检路径 ${this.paths.length + 1}`, points: [], speed: 3 };
      this.pathHistory.push(cloneState(this.paths));
      this.paths = [...this.paths, path];
      this.activePathId = path.id;
      this.refreshPathFlags();
    }
    return path;
  }

  addPathPoint(position: Vec3JSON, lookAt: Vec3JSON | null = null): PathKeyPoint {
    this.pathHistory.push(cloneState(this.paths));
    const path = this.ensurePath();
    const point: PathKeyPoint = { id: uid('kp'), position: { ...position }, lookAt };
    this.paths = this.paths.map((p) =>
      p.id === path.id ? { ...p, points: [...p.points, point] } : p
    );
    this.refreshPathFlags();
    return point;
  }

  updatePathPoint(id: string, position: Vec3JSON): void {
    this.pathHistory.push(cloneState(this.paths));
    this.paths = this.paths.map((p) => ({
      ...p,
      points: p.points.map((kp) => (kp.id === id ? { ...kp, position: { ...position } } : kp))
    }));
    this.refreshPathFlags();
  }

  removePathPoint(id: string): void {
    this.pathHistory.push(cloneState(this.paths));
    this.paths = this.paths.map((p) => ({
      ...p,
      points: p.points.filter((kp) => kp.id !== id)
    }));
    this.refreshPathFlags();
  }

  setPathSpeed(speed: number): void {
    if (!this.activePathId) return;
    this.pathHistory.push(cloneState(this.paths));
    this.paths = this.paths.map((p) => (p.id === this.activePathId ? { ...p, speed } : p));
    this.refreshPathFlags();
  }

  renamePath(id: string, name: string): void {
    this.pathHistory.push(cloneState(this.paths));
    this.paths = this.paths.map((p) => (p.id === id ? { ...p, name } : p));
    this.refreshPathFlags();
  }

  addPath(): TourPath {
    this.pathHistory.push(cloneState(this.paths));
    const path: TourPath = {
      id: uid('path'),
      name: `巡检路径 ${this.paths.length + 1}`,
      points: [],
      speed: 3
    };
    this.paths = [...this.paths, path];
    this.activePathId = path.id;
    this.refreshPathFlags();
    return path;
  }

  removePath(id: string): void {
    this.pathHistory.push(cloneState(this.paths));
    this.paths = this.paths.filter((p) => p.id !== id);
    if (this.activePathId === id) {
      this.activePathId = this.paths[0]?.id ?? null;
    }
    this.refreshPathFlags();
  }

  undoPath(): void {
    const r = this.pathHistory.undo(cloneState(this.paths));
    if (r) {
      this.paths = r.snapshot;
      if (!this.paths.some((p) => p.id === this.activePathId)) {
        this.activePathId = this.paths[0]?.id ?? null;
      }
      this.refreshPathFlags();
    }
  }

  redoPath(): void {
    const r = this.pathHistory.redo(cloneState(this.paths));
    if (r) {
      this.paths = r.snapshot;
      this.refreshPathFlags();
    }
  }

  private refreshPathFlags(): void {
    this.pathCanUndo = this.pathHistory.canUndo;
    this.pathCanRedo = this.pathHistory.canRedo;
  }

  // ================= 工程导入导出 =================

  serialize(): SceneProject {
    return {
      format: 'crime-scene-pcv',
      version: 1,
      exportedAt: Date.now(),
      cloudKey: this.cloudRecord?.key ?? null,
      cloudName: this.cloudRecord?.name,
      clipBox: cloneState(this.clipBox),
      markers: cloneState(this.markers),
      paths: cloneState(this.paths)
    };
  }

  /**
   * 载入工程文件。cloudKey 指向的点云若本地不存在，由视图层提示重新导入；
   * 标记/路径/裁剪盒仍会恢复。
   */
  loadProject(project: SceneProject): void {
    this.clipBox = cloneState(project.clipBox ?? null);
    this.markers = cloneState(project.markers ?? []);
    this.paths = cloneState(project.paths ?? []);
    this.activePathId = this.paths[0]?.id ?? null;
    this.clipHistory.clear();
    this.markerHistory.clear();
    this.pathHistory.clear();
    this.refreshClipFlags();
    this.refreshMarkerFlags();
    this.refreshPathFlags();
  }

  resetAll(): void {
    this.cloudRecord = null;
    this.clipBox = null;
    this.markers = [];
    this.paths = [];
    this.activePathId = null;
    this.clipHistory.clear();
    this.markerHistory.clear();
    this.pathHistory.clear();
    this.refreshClipFlags();
    this.refreshMarkerFlags();
    this.refreshPathFlags();
    this.placeMode = false;
    this.recordMode = false;
    this.touring = false;
  }
}

export const store = new ProjectStore();

/** 工具：Box3JSON -> three Box3 */
export function jsonToBox3(j: Box3JSON | null): Box3 | null {
  if (!j) return null;
  return new Box3(
    new Vector3(j.min.x, j.min.y, j.min.z),
    new Vector3(j.max.x, j.max.y, j.max.z)
  );
}
