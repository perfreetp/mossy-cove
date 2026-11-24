// 骨架状态存储：快照式撤销/重做，所有离散操作均先存快照再修改
import type {
  BoneInstance,
  ProjectData,
  Side,
  Vec3Tuple,
} from '../types';
import { deepClone, makeBoneId, mirrorEuler, clampRotation } from '../lib/math3d';
import { findMirrorPartner } from '../lib/mirror';
import { templateByKey } from '../lib/catalog';

export type TransformMode = 'rotate' | 'root';

interface HistoryEntry {
  label: string;
  state: ProjectData;
}

export interface StoreState {
  version: number;
  project: ProjectData;
  selectedId: string | null;
  /** 顶到关节极限的骨骼 id → 命中的轴，用于高亮 */
  limitHits: Map<string, Array<'x' | 'y' | 'z'>>;
  transformMode: TransformMode;
  mirrorSync: boolean;
  canUndo: boolean;
  canRedo: boolean;
  lastLabel: string | null;
}

const HISTORY_LIMIT = 100;

export function emptyProject(): ProjectData {
  return {
    version: 1,
    bones: [],
    rootTransform: { pos: [0, 1.2, 0], rot: [0, 0, 0] },
    settings: {
      groundSnap: false,
      clip: { enabled: false, pos: [0, 0, 0], normal: [1, 0, 0] },
    },
  };
}

function nextBoneId(bones: BoneInstance[], baseId: string, side: Side): string {
  let max = 0;
  for (const b of bones) {
    if (b.templateBaseId === baseId && b.side === side) {
      max = Math.max(max, parseInt(b.id.split('#')[1] ?? '0', 10));
    }
  }
  return makeBoneId(baseId, side, max + 1);
}

type Listener = () => void;

export class SkeletonStore {
  private project: ProjectData = emptyProject();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<Listener>();
  private stateCache: StoreState | null = null;

  private selectedId: string | null = null;
  private limitHits = new Map<string, Array<'x' | 'y' | 'z'>>();
  private transformMode: TransformMode = 'rotate';
  private mirrorSync = true;
  private lastLabel: string | null = null;

  /** 交互开始时的状态（拖动等连续操作） */
  private interactionCheckpoint: ProjectData | null = null;

  // ---------- 订阅 ----------

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): StoreState => {
    if (!this.stateCache) {
      this.stateCache = {
        version: 0,
        project: this.project,
        selectedId: this.selectedId,
        limitHits: this.limitHits,
        transformMode: this.transformMode,
        mirrorSync: this.mirrorSync,
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0,
        lastLabel: this.lastLabel,
      };
    }
    return this.stateCache;
  };

  private notify() {
    this.stateCache = null;
    this.listeners.forEach((fn) => fn());
  }

  // ---------- 历史 ----------

  /** 离散操作：先压入当前状态快照，再用 mutator 产生新状态 */
  run(label: string, mutator: (draft: ProjectData) => ProjectData | void): ProjectData {
    this.undoStack.push({ label, state: deepClone(this.project) });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    const draft = deepClone(this.project);
    const result = mutator(draft);
    this.project = result ?? draft;
    this.lastLabel = label;
    this.selectedId = this.ensureSelection(this.selectedId);
    this.notify();
    return this.project;
  }

  /** 连续交互开始（拖拽手柄/裁切平面）：记录检查点，期间用 applyLive 更新 */
  beginInteraction() {
    this.interactionCheckpoint = deepClone(this.project);
  }

  applyLive(mutator: (draft: ProjectData) => ProjectData | void) {
    const draft = deepClone(this.project);
    const result = mutator(draft);
    this.project = result ?? draft;
    this.notify();
  }

  /** 交互结束并入账；label 为 null 表示丢弃（恢复检查点） */
  endInteraction(label: string | null) {
    if (!this.interactionCheckpoint) return;
    if (label === null) {
      this.project = this.interactionCheckpoint;
    } else {
      this.undoStack.push({ label, state: this.interactionCheckpoint });
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
      this.lastLabel = label;
    }
    this.interactionCheckpoint = null;
    this.selectedId = this.ensureSelection(this.selectedId);
    this.notify();
  }

  undo(): string | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ label: entry.label, state: deepClone(this.project) });
    this.project = entry.state;
    this.selectedId = this.ensureSelection(this.selectedId);
    this.limitHits = new Map();
    this.lastLabel = `撤销：${entry.label}`;
    this.notify();
    return entry.label;
  }

  redo(): string | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ label: entry.label, state: deepClone(this.project) });
    this.project = entry.state;
    this.selectedId = this.ensureSelection(this.selectedId);
    this.limitHits = new Map();
    this.lastLabel = `重做：${entry.label}`;
    this.notify();
    return entry.label;
  }

  private ensureSelection(id: string | null): string | null {
    if (id && this.project.bones.some((b) => b.id === id)) return id;
    return null;
  }

  // ---------- 选择 / 高亮 / 模式（临时态，不入历史） ----------

  select(id: string | null) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    if (!id) this.limitHits = new Map();
    this.notify();
  }

  setLimitHits(hits: Map<string, Array<'x' | 'y' | 'z'>>) {
    this.limitHits = hits;
    this.notify();
  }

  setTransformMode(mode: TransformMode) {
    this.transformMode = mode;
    this.notify();
  }

  setMirrorSync(on: boolean) {
    this.mirrorSync = on;
    this.notify();
  }

  // ---------- 骨骼操作 ----------

  /** 拖入骨骼：吸附到指定插槽；parentId 为 null 时成为根级骨骼 */
  addBone(args: {
    templateBaseId: string;
    side: Side;
    parentId: string | null;
    parentSlotId: string | null;
    rotation?: Vec3Tuple;
    localPos?: Vec3Tuple;
    label?: string;
  }): BoneInstance {
    let created!: BoneInstance;
    this.run(args.label ?? '拖入骨骼', (draft) => {
      const id = nextBoneId(draft.bones, args.templateBaseId, args.side);
      created = {
        id,
        templateBaseId: args.templateBaseId,
        side: args.side,
        parentId: args.parentId,
        parentSlotId: args.parentSlotId,
        localPos: args.localPos ? [...args.localPos] : [0, 0, 0],
        rotation: args.rotation ? [...args.rotation] : [0, 0, 0],
      };
      draft.bones.push(created);
    });
    this.select(created.id);
    return created;
  }

  /** 删除骨骼（级联删除全部后代） */
  removeBone(id: string) {
    this.run('删除骨骼', (draft) => {
      const remove = new Set<string>([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const b of draft.bones) {
          if (b.parentId && remove.has(b.parentId) && !remove.has(b.id)) {
            remove.add(b.id);
            changed = true;
          }
        }
      }
      draft.bones = draft.bones.filter((b) => !remove.has(b.id));
    });
    if (this.selectedId === id) this.select(null);
  }

  /** 姿态面板直接输入角度（离散，入历史；经关节极限钳制；镜像同步开启时连带对侧） */
  setBoneRotation(id: string, rotation: Vec3Tuple, label = '关节角度输入') {
    let hits: Array<'x' | 'y' | 'z'> = [];
    this.run(label, (draft) => {
      const b = draft.bones.find((x) => x.id === id);
      if (!b) return;
      // 与手柄拖动走同一套钳制，超范围输入停在极限
      const tpl = templateByKey(`${b.templateBaseId}:${b.side}`);
      const result = clampRotation(rotation, tpl.limits);
      b.rotation = result.value;
      hits = (['x', 'y', 'z'] as const).filter((a) => result.hit[a]);
      if (this.mirrorSync) {
        const partner = findMirrorPartner(draft, id);
        if (partner) {
          const p = draft.bones.find((x) => x.id === partner.id);
          if (p) p.rotation = mirrorEuler(result.value);
        }
      }
    });
    this.limitHits = hits.length ? new Map([[id, hits]]) : new Map();
    this.notify();
  }

  /** 实时拖动中的旋转写入（不入历史，由 begin/endInteraction 包裹） */
  applyLiveRotation(id: string, rotation: Vec3Tuple) {
    this.applyLive((draft) => {
      const b = draft.bones.find((x) => x.id === id);
      if (!b) return;
      b.rotation = [...rotation];
      if (this.mirrorSync) {
        const partner = findMirrorPartner(draft, id);
        if (partner) {
          const p = draft.bones.find((x) => x.id === partner.id);
          if (p) p.rotation = mirrorEuler(rotation);
        }
      }
    });
  }

  /** 实时拖动整具骨架根节点 */
  applyLiveRoot(transform: { pos: Vec3Tuple; rot: Vec3Tuple }) {
    this.applyLive((draft) => {
      draft.rootTransform.pos = [...transform.pos];
      draft.rootTransform.rot = [...transform.rot];
    });
  }

  /** 实时拖动裁切平面 */
  applyLiveClip(clip: ProjectData['settings']['clip']) {
    this.applyLive((draft) => {
      draft.settings.clip = {
        enabled: clip.enabled,
        pos: [...clip.pos],
        normal: [...clip.normal],
      };
    });
  }

  setGroundSnap(on: boolean, snapped?: ProjectData) {
    this.run(on ? '开启地面吸附' : '关闭地面吸附', (draft) => {
      draft.settings.groundSnap = on;
      if (on && snapped) {
        // 采用场景层计算好的贴地结果
        draft.bones = snapped.bones.map((b) => ({
          ...b,
          localPos: [...b.localPos] as Vec3Tuple,
          rotation: [...b.rotation] as Vec3Tuple,
        }));
      }
    });
  }

  setClipEnabled(on: boolean) {
    this.run(on ? '开启剖面模式' : '关闭剖面模式', (draft) => {
      draft.settings.clip.enabled = on;
    });
  }

  /** 镜像复制（newBones 由 mirrorSubtree 计算） */
  addMirroredBones(newBones: BoneInstance[], selectId: string | null) {
    this.run('镜像复制', (draft) => {
      draft.bones.push(...newBones.map((b) => ({ ...b })));
    });
    if (selectId) this.select(selectId);
  }

  // ---------- 导入 / 导出 ----------

  exportJSON(): string {
    return JSON.stringify(this.project, null, 2);
  }

  importJSON(json: string) {
    const parsed = JSON.parse(json) as ProjectData;
    if (parsed.version !== 1 || !Array.isArray(parsed.bones)) {
      throw new Error('文件格式不兼容：缺少 version 或 bones 字段');
    }
    this.run('导入骨架', () => parsed);
    this.select(null);
  }

  /** 载入演示骨架（重置历史，不入账） */
  loadProject(project: ProjectData) {
    this.project = deepClone(project);
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.limitHits = new Map();
    this.lastLabel = null;
    this.notify();
  }

  getProject(): ProjectData {
    return this.project;
  }
}

// 模块级单例
export const skeletonStore = new SkeletonStore();
