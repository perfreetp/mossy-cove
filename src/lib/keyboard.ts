import { store } from '../store.svelte';

/**
 * 全局键盘快捷键。
 * - Ctrl/Cmd+Z：撤销标记；加 Shift 重做标记
 * - Ctrl/Cmd+Alt+Z：撤销路径；加 Shift 重做路径
 * - Ctrl/Cmd+B：撤销裁剪
 * 输入控件聚焦时不拦截，避免影响文本编辑。
 */
export function bindKeyboardShortcuts(): () => void {
  function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (isTypingTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    const key = e.key.toLowerCase();
    if (e.altKey && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redoPath();
      else store.undoPath();
      return;
    }
    if (key === 'z' && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) store.redoMarker();
      else store.undoMarker();
      return;
    }
    if (key === 'b') {
      e.preventDefault();
      store.undoClip();
    }
  }

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
