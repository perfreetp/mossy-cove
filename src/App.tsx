import { useMemo, useState } from 'react';
import { BrushPanel } from './components/BrushPanel';
import { ExportPanel } from './components/ExportPanel';
import { SectionPanel } from './components/SectionPanel';
import { TerrainViewport } from './components/TerrainViewport';
import { SandboxEngine } from './terrain/SandboxEngine';
import { loadStoredProject } from './terrain/project';
import { useEngineState } from './terrain/useEngineState';

function TopBarActions({ engine }: { engine: SandboxEngine }) {
  const state = useEngineState(engine);
  return (
    <>
      <button className="top-button" onClick={() => engine.undo()} disabled={!state.canUndo} title="撤销">
        <span>↶</span> 撤销
      </button>
      <button className="top-button" onClick={() => engine.redo()} disabled={!state.canRedo} title="重做">
        <span>↷</span> 重做
      </button>
      <button className="top-button top-button--icon" onClick={() => engine.resetCamera()} title="复位镜头">
        ⌖
      </button>
    </>
  );
}

function TopBar({ engine }: { engine: SandboxEngine | null }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand__mark">▲</div>
        <div>
          <h1>微缩沙盘地形雕刻工具</h1>
          <p>TypeScript · React · Three.js · 本地存储 / JSON 分享</p>
        </div>
      </div>
      <div className="topbar__actions">
        {engine ? <TopBarActions engine={engine} /> : <span className="loading-text">初始化 WebGL…</span>}
      </div>
    </header>
  );
}

export default function App() {
  const initial = useMemo(() => loadStoredProject(), []);
  const [engine, setEngine] = useState<SandboxEngine | null>(null);

  return (
    <div className="app">
      <TopBar engine={engine} />
      <div className="workspace">
        <aside className="sidebar sidebar--left">
          {engine ? <BrushPanel engine={engine} /> : <div className="panel panel--loading">正在载入笔刷面板…</div>}
        </aside>

        <TerrainViewport initial={initial} onReady={setEngine} />

        <aside className="sidebar sidebar--right">
          {engine ? (
            <>
              <SectionPanel engine={engine} />
              <ExportPanel engine={engine} />
            </>
          ) : (
            <div className="panel panel--loading">正在载入剖切与导出…</div>
          )}
        </aside>
      </div>
    </div>
  );
}
