import { useEffect, useRef } from 'react';
import { BallisticEngine, emptyProject } from './engine/BallisticEngine';
import { loadProject } from './lib/storage';
import { useStore } from './store';
import Toolbar from './components/Toolbar';
import PointPanel from './components/PointPanel';
import ObstaclePanel from './components/ObstaclePanel';
import TrajectoryPanel from './components/TrajectoryPanel';
import StatusBar from './components/StatusBar';

export default function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setEngine = useStore((s) => s.setEngine);

  useEffect(() => {
    if (!canvasRef.current) return;
    let engine: BallisticEngine | null = null;
    let disposed = false;
    loadProject()
      .then((saved) => {
        if (disposed) return;
        engine = new BallisticEngine(canvasRef.current!, saved ?? emptyProject());
        setEngine(engine);
        if (import.meta.env.DEV) {
          (window as unknown as { __btr?: unknown }).__btr = {
            engine,
            storeExport: () => useStore.getState().exportProject(),
          };
        }
      })
      .catch(() => {
        if (disposed) return;
        engine = new BallisticEngine(canvasRef.current!, emptyProject());
        setEngine(engine);
      });
    return () => {
      disposed = true;
      engine?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <aside className="side-panel">
          <PointPanel />
          <ObstaclePanel />
        </aside>
        <main className="viewport">
          <canvas ref={canvasRef} className="babylon-canvas" />
        </main>
        <aside className="side-panel side-panel-right">
          <TrajectoryPanel />
        </aside>
      </div>
      <StatusBar />
    </div>
  );
}
