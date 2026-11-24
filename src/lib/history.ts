/**
 * 通用撤销/重做栈。
 * 快照为深拷贝后的纯 JSON 状态，回滚即整体替换。
 * 标记与路径各持一个实例，裁剪范围也单独记录。
 */
export class HistoryStack<T> {
  private past: T[] = [];
  private future: T[] = [];
  private capacity: number;

  constructor(capacity = 100) {
    this.capacity = capacity;
  }

  /** 在执行一次变更前压入当前状态快照 */
  push(snapshot: T): void {
    this.past.push(snapshot);
    if (this.past.length > this.capacity) this.past.shift();
    this.future = [];
  }

  /**
   * 撤销：把 current 推入 future，返回上一个快照。
   * 无可撤销时返回 null。
   */
  undo(current: T): { snapshot: T; current: T } | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return { snapshot: prev, current };
  }

  redo(current: T): { snapshot: T; current: T } | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return { snapshot: next, current };
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  get depth(): number {
    return this.past.length;
  }
}

/**
 * 结构化深拷贝（工程状态全部是 JSON 兼容数据）。
 *
 * 不用 structuredClone：Svelte 5 的 $state 会把数组/对象包成响应式 proxy，
 * structuredClone 遇到这类代理会抛 DataCloneError。JSON 往返得到的是
 * 脱离响应式的纯快照，正好满足历史栈「冻结当时状态」的需求。
 */
export function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
