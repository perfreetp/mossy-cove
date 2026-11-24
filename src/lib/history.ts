import type { DesignState } from './types';
import { deepClone } from './geometry';

interface Snapshot {
  label: string;
  state: DesignState;
}

const CAPACITY = 100;

/** 通用撤销/重做栈，覆盖节点增删、断连重连与管径调整等操作 */
export class HistoryStack {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];

  canUndo = false;
  canRedo = false;

  private refresh(): void {
    this.canUndo = this.past.length > 0;
    this.canRedo = this.future.length > 0;
  }

  /** 在变更发生前压入当前状态 */
  push(label: string, current: DesignState): void {
    this.past.push({ label, state: deepClone(current) });
    if (this.past.length > CAPACITY) this.past.shift();
    this.future = [];
    this.refresh();
  }

  /** 撤销：把当前状态移入 redo 栈，返回上一个快照 */
  undo(current: DesignState): { label: string; state: DesignState } | null {
    const snap = this.past.pop();
    if (!snap) return null;
    this.future.push({ label: snap.label, state: deepClone(current) });
    this.refresh();
    return { label: snap.label, state: snap.state };
  }

  redo(current: DesignState): { label: string; state: DesignState } | null {
    const snap = this.future.pop();
    if (!snap) return null;
    this.past.push({ label: snap.label, state: deepClone(current) });
    this.refresh();
    return { label: snap.label, state: snap.state };
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.refresh();
  }

  lastLabel(): string | null {
    return this.past.length > 0 ? this.past[this.past.length - 1].label : null;
  }
}
