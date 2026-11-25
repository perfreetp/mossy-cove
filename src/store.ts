import { createStore, produce } from 'solid-js/store';
import type {
  AnnotationRecord,
  AxisName,
  MeasureRecord,
  PartState,
  PlaneState,
  SavedDoc,
  ToolMode,
} from './types';

const AXES: AxisName[] = ['x', 'y', 'z'];

export interface AppState {
  planes: Record<AxisName, PlaneState>;
  parts: PartState[];
  annotations: AnnotationRecord[];
  measures: MeasureRecord[];
  mode: ToolMode;
  canUndo: boolean;
  canRedo: boolean;
}

export function createInitialPlanes(bounds: { min: number; max: number }[]): Record<AxisName, PlaneState> {
  const make = (i: number): PlaneState => {
    const mid = (bounds[i].min + bounds[i].max) / 2;
    return { offset: mid, enabled: i === 0, visible: true };
  };
  return { x: make(0), y: make(1), z: make(2) };
}

interface Snapshot {
  planes: Record<AxisName, PlaneState>;
  parts: { id: string; visible: boolean }[];
  annotations: AnnotationRecord[];
}

const HISTORY_LIMIT = 100;

export class AppStore {
  readonly state: AppState;
  private set: (fn: (s: AppState) => void) => void;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private initialBounds: { min: number; max: number }[];

  constructor(parts: PartState[], planes: Record<AxisName, PlaneState>) {
    const [state, setState] = createStore<AppState>({
      planes,
      parts,
      annotations: [],
      measures: [],
      mode: 'annotate',
      canUndo: false,
      canRedo: false,
    });
    this.state = state;
    this.set = (fn) => setState(produce(fn));
    this.initialBounds = AXES.map((axis) => {
      void axis;
      return { min: -2, max: 2 };
    });
  }

  setBounds(bounds: { min: number; max: number }[]): void {
    this.initialBounds = bounds;
  }

  getBounds(): { min: number; max: number }[] {
    return this.initialBounds;
  }

  // ---------------- 历史快照 ----------------

  private takeSnapshot(): Snapshot {
    return {
      planes: JSON.parse(JSON.stringify(this.state.planes)) as Record<AxisName, PlaneState>,
      parts: this.state.parts.map((p) => ({ id: p.id, visible: p.visible })),
      annotations: JSON.parse(JSON.stringify(this.state.annotations)) as AnnotationRecord[],
    };
  }

  private restore(snapshot: Snapshot): void {
    this.set((s) => {
      s.planes = JSON.parse(JSON.stringify(snapshot.planes));
      const vis = new Map(snapshot.parts.map((p) => [p.id, p.visible]));
      for (const p of s.parts) p.visible = vis.get(p.id) ?? p.visible;
      s.annotations = JSON.parse(JSON.stringify(snapshot.annotations));
    });
  }

  private pushHistory(): void {
    this.undoStack.push(this.takeSnapshot());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.refreshFlags();
  }

  private refreshFlags(): void {
    this.set((s) => {
      s.canUndo = this.undoStack.length > 0;
      s.canRedo = this.redoStack.length > 0;
    });
  }

  /** 拖动开始时调用,把拖动前状态压栈 */
  beginInteraction(): void {
    this.pushHistory();
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.redoStack.push(this.takeSnapshot());
    this.restore(snapshot);
    this.refreshFlags();
  }

  redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return;
    this.undoStack.push(this.takeSnapshot());
    this.restore(snapshot);
    this.refreshFlags();
  }

  // ---------------- 剖切面 ----------------

  setPlaneOffset(axis: AxisName, offset: number, recordHistory = false): void {
    if (recordHistory) this.pushHistory();
    this.set((s) => {
      s.planes[axis].offset = offset;
    });
  }

  togglePlaneEnabled(axis: AxisName): void {
    this.pushHistory();
    this.set((s) => {
      s.planes[axis].enabled = !s.planes[axis].enabled;
    });
  }

  togglePlaneVisible(axis: AxisName): void {
    this.set((s) => {
      s.planes[axis].visible = !s.planes[axis].visible;
    });
  }

  // ---------------- 构件显隐 ----------------

  togglePart(id: string): void {
    this.pushHistory();
    this.set((s) => {
      const part = s.parts.find((p) => p.id === id);
      if (part) part.visible = !part.visible;
    });
  }

  // ---------------- 标注 ----------------

  addAnnotation(record: AnnotationRecord): void {
    this.pushHistory();
    this.set((s) => {
      s.annotations.push(record);
    });
  }

  removeAnnotation(id: string): void {
    if (!this.state.annotations.some((a) => a.id === id)) return;
    this.pushHistory();
    this.set((s) => {
      s.annotations = s.annotations.filter((a) => a.id !== id);
    });
  }

  clearAnnotations(): void {
    if (this.state.annotations.length === 0) return;
    this.pushHistory();
    this.set((s) => {
      s.annotations = [];
    });
  }

  // ---------------- 测量(临时数据,不进历史/持久化) ----------------

  addMeasure(record: MeasureRecord): void {
    this.set((s) => {
      s.measures.unshift(record);
      if (s.measures.length > 20) s.measures.length = 20;
    });
  }

  /** Viewer 重算后回写测量值(保持 Solid 响应式) */
  updateMeasureValue(id: string, value: number, detail: string): void {
    this.set((s) => {
      const m = s.measures.find((r) => r.id === id);
      if (m) {
        m.value = value;
        m.detail = detail;
      }
    });
  }

  clearMeasures(): void {
    this.set((s) => {
      s.measures = [];
    });
  }

  // ---------------- 模式 ----------------

  setMode(mode: ToolMode): void {
    this.set((s) => {
      s.mode = mode;
    });
  }

  // ---------------- 持久化 / 导入导出 ----------------

  toSavedDoc(): SavedDoc {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      planes: JSON.parse(JSON.stringify(this.state.planes)),
      parts: Object.fromEntries(this.state.parts.map((p) => [p.id, { visible: p.visible }])),
      annotations: JSON.parse(JSON.stringify(this.state.annotations)),
    };
  }

  /** 导入文档;返回导入的标注数量,失败抛异常 */
  loadSavedDoc(doc: SavedDoc): { annotationCount: number } {
    validateDoc(doc);
    this.pushHistory();
    this.set((s) => {
      for (const axis of AXES) {
        const incoming = doc.planes[axis];
        if (incoming) s.planes[axis] = { ...incoming };
      }
      for (const p of s.parts) {
        const incoming = doc.parts[p.id];
        if (incoming) p.visible = incoming.visible;
      }
      s.annotations = JSON.parse(JSON.stringify(doc.annotations));
    });
    return { annotationCount: doc.annotations.length };
  }

  hydrate(doc: SavedDoc): void {
    // 启动恢复不进历史栈
    validateDoc(doc);
    this.set((s) => {
      for (const axis of AXES) {
        const incoming = doc.planes[axis];
        if (incoming) s.planes[axis] = { ...incoming };
      }
      for (const p of s.parts) {
        const incoming = doc.parts[p.id];
        if (incoming) p.visible = incoming.visible;
      }
      s.annotations = JSON.parse(JSON.stringify(doc.annotations));
    });
  }
}

function validateDoc(doc: unknown): asserts doc is SavedDoc {
  if (!doc || typeof doc !== 'object') throw new Error('文件格式无效:不是 JSON 对象');
  const d = doc as Record<string, unknown>;
  if (d.version !== 1) throw new Error(`不支持的文档版本:${String(d.version)}`);
  if (!d.planes || typeof d.planes !== 'object') throw new Error('缺少 planes 字段');
  if (!Array.isArray(d.annotations)) throw new Error('缺少 annotations 字段');
}
