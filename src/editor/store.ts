import { createStore, produce, reconcile, unwrap } from 'solid-js/store';
import { cloneDocument, createDefaultDocument } from './model';
import type { ProjectDocument } from './types';

const HISTORY_LIMIT = 120;

export function createEditorStore() {
  const [doc, setDoc] = createStore<ProjectDocument>(createDefaultDocument());
  const [history, setHistory] = createStore<{
    past: ProjectDocument[];
    future: ProjectDocument[];
  }>({ past: [], future: [] });

  let pendingSnapshot: ProjectDocument | null = null;

  function snapshot(): ProjectDocument {
    return cloneDocument(unwrap(doc));
  }

  function beginHistory(): void {
    pendingSnapshot = snapshot();
  }

  function endHistory(): void {
    pendingSnapshot = null;
  }

  function transact(fn: (draft: ProjectDocument) => void): void {
    if (pendingSnapshot) {
      const before = pendingSnapshot;
      pendingSnapshot = null;
      setHistory('past', (past) => [...past.slice(-(HISTORY_LIMIT - 1)), before]);
      setHistory('future', []);
    }
    setDoc(produce(fn));
  }

  function commit(fn: (draft: ProjectDocument) => void): void {
    setHistory('past', (past) => [...past.slice(-(HISTORY_LIMIT - 1)), snapshot()]);
    setHistory('future', []);
    pendingSnapshot = null;
    setDoc(produce(fn));
  }

  function undo(): ProjectDocument | null {
    if (history.past.length === 0) return null;
    pendingSnapshot = null;
    const previous = history.past[history.past.length - 1];
    setHistory('past', (past) => past.slice(0, -1));
    setHistory('future', (future) => [...future, snapshot()]);
    const restored = cloneDocument(previous);
    setDoc(reconcile(restored));
    return restored;
  }

  function redo(): ProjectDocument | null {
    if (history.future.length === 0) return null;
    pendingSnapshot = null;
    const next = history.future[history.future.length - 1];
    setHistory('future', (future) => future.slice(0, -1));
    setHistory('past', (past) => [...past, snapshot()]);
    const restored = cloneDocument(next);
    setDoc(reconcile(restored));
    return restored;
  }

  function replaceDocument(next: ProjectDocument): void {
    pendingSnapshot = null;
    setHistory({ past: [], future: [] });
    setDoc(reconcile(cloneDocument(next)));
  }

  return {
    doc,
    history,
    beginHistory,
    endHistory,
    transact,
    commit,
    undo,
    redo,
    replaceDocument,
  };
}

export type EditorStore = ReturnType<typeof createEditorStore>;
