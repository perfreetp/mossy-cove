/** 通用命令式撤销/重做栈。 */

export interface UndoableAction {
  label: string;
  undo(): void;
  redo(): void;
  /** 合并同类连续操作（如笔刷一次笔画只保留一条记录，由外部按笔画整体提交，暂不使用合并） */
  mergeable?: boolean;
}

export class HistoryStack {
  private undoStack: UndoableAction[] = [];
  private redoStack: UndoableAction[] = [];
  private limit: number;
  onChange: (() => void) | null = null;

  constructor(limit = 80) {
    this.limit = limit;
  }

  push(action: UndoableAction): void {
    action.redo();
    this.undoStack.push(action);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange?.();
  }

  /** 直接入栈一条已经发生的操作（redo 不再执行），用于拖拽/笔画结束时提交。 */
  commit(action: UndoableAction): void {
    this.undoStack.push(action);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange?.();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const action = this.undoStack.pop();
    if (!action) return;
    action.undo();
    this.redoStack.push(action);
    this.onChange?.();
  }

  redo(): void {
    const action = this.redoStack.pop();
    if (!action) return;
    action.redo();
    this.undoStack.push(action);
    this.onChange?.();
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange?.();
  }

  get lastLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }
}
