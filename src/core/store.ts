import { HISTORY_LIMIT } from './config';
import type { ProjectState } from './types';

export type ChangeReason =
  | 'init'
  | 'preview' // 连续手势中的实时更新（拖滑块 / 擦除拖动），不入历史
  | 'commit' // 一次手势结束并写入历史
  | 'history' // 撤销 / 重做
  | 'import';

export interface StoreEvent {
  reason: ChangeReason;
  label?: string;
}

interface HistoryEntry {
  label: string;
  before: ProjectState;
  after: ProjectState;
}

type Listener = (e: StoreEvent) => void;

function cloneState(s: ProjectState): ProjectState {
  return structuredClone(s);
}

/**
 * 单一可观察状态源。所有“离散动作”通过 run() 产生一条历史；
 * 滑块拖动 / 擦除笔画这类连续手势用 begin/update/commit 合并成一条。
 * 历史条目保存完整工程快照，因此撤销重做对任何操作都成立。
 */
export class EditorStore {
  state: ProjectState;
  private listeners = new Set<Listener>();
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  private gestureBefore: ProjectState | null = null;
  private gestureDirty = false;

  constructor(initial: ProjectState) {
    this.state = initial;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason: ChangeReason, label?: string): void {
    const e: StoreEvent = { reason, label };
    this.listeners.forEach((fn) => fn(e));
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.past[this.past.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.future[this.future.length - 1]?.label;
  }

  get historySize(): number {
    return this.past.length;
  }

  /** 执行一个离散变更并记录历史 */
  run(label: string, mutator: (draft: ProjectState) => void): void {
    const before = cloneState(this.state);
    mutator(this.state);
    const after = cloneState(this.state);
    this.pushEntry({ label, before, after });
    this.future = [];
    this.emit('commit', label);
  }

  /** 连续手势开始：记录手势前快照 */
  beginGesture(): void {
    if (this.gestureBefore) return;
    this.gestureBefore = cloneState(this.state);
    this.gestureDirty = false;
  }

  /** 手势进行中：直接改状态并刷新视图，不写历史 */
  updateGesture(mutator: (draft: ProjectState) => void): void {
    if (!this.gestureBefore) this.gestureBefore = cloneState(this.state);
    mutator(this.state);
    this.gestureDirty = true;
    this.emit('preview');
  }

  /** 手势结束：整个连续过程合并为一条历史 */
  commitGesture(label: string): void {
    if (this.gestureBefore && this.gestureDirty) {
      const entry: HistoryEntry = {
        label,
        before: this.gestureBefore,
        after: cloneState(this.state),
      };
      this.pushEntry(entry);
      this.future = [];
      this.emit('commit', label);
    }
    this.gestureBefore = null;
    this.gestureDirty = false;
  }

  /** 取消手势并恢复手势前状态 */
  cancelGesture(): void {
    if (this.gestureBefore) {
      this.state = cloneState(this.gestureBefore);
      this.emit('history');
    }
    this.gestureBefore = null;
    this.gestureDirty = false;
  }

  private pushEntry(entry: HistoryEntry): void {
    this.past.push(entry);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
  }

  undo(): void {
    const entry = this.past.pop();
    if (!entry) return;
    this.state = cloneState(entry.before);
    this.future.push(entry);
    this.emit('history', entry.label);
  }

  redo(): void {
    const entry = this.future.pop();
    if (!entry) return;
    this.state = cloneState(entry.after);
    this.past.push(entry);
    this.emit('history', entry.label);
  }

  /** 导入工程：整体替换并清空历史 */
  loadImported(next: ProjectState): void {
    this.state = next;
    this.past = [];
    this.future = [];
    this.gestureBefore = null;
    this.emit('import');
  }
}
