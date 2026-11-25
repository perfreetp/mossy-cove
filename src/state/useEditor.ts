import { useSyncExternalStore } from 'react';
import { editorStore, type StoreSummary } from './editorStore';

/** React 订阅：只在 store 版本号变化时重渲染组件 */
export function useEditorSummary(): StoreSummary {
  return useSyncExternalStore(
    editorStore.subscribe,
    () => editorStore.getSummary(),
  );
}
