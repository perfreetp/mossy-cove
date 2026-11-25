import { useCallback, useEffect, useState } from 'react';
import { ModelPanel } from './components/ModelPanel';
import { ClipPanel } from './components/ClipPanel';
import { SectionPanel } from './components/SectionPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { Viewport } from './components/Viewport';
import type { SceneManager } from './three/SceneManager';
import type { InteractionMode } from './types';
import { editorStore } from './state/editorStore';

export default function App() {
  const [scene, setScene] = useState<SceneManager | null>(null);
  const [mode, setMode] = useState<InteractionMode>('orbit');

  const handleSceneReady = useCallback((s: SceneManager) => setScene(s), []);

  // 全局快捷键：Ctrl+Z 撤销 / Ctrl+Y 或 Ctrl+Shift+Z 重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        editorStore.undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        editorStore.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>器官网格裁剪编辑工具</h1>
        <span className="sub">术前规划 · 平面布尔裁剪 · 断面轮廓提取与补洞 · three.js + three-mesh-bvh</span>
      </header>

      <aside className="left-rail">
        <ModelPanel />
      </aside>

      <Viewport mode={mode} onSceneReady={handleSceneReady} />

      <aside className="right-rail">
        <ClipPanel scene={scene} mode={mode} setMode={setMode} />
        <SectionPanel scene={scene} mode={mode} />
        <HistoryPanel />
      </aside>
    </div>
  );
}
