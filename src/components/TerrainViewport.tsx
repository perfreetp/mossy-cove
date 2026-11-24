import { useEffect, useRef } from 'react';
import { SandboxEngine } from '../terrain/SandboxEngine';
import type { ProjectData } from '../terrain/types';

export function TerrainViewport({ initial, onReady }: {
  initial: ProjectData | null;
  onReady: (engine: SandboxEngine | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef(initial);

  useEffect(() => {
    if (!hostRef.current) return;
    const engine = new SandboxEngine(hostRef.current, initialRef.current);
    onReady(engine);
    return () => {
      engine.dispose();
      onReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="viewport-card">
      <div ref={hostRef} className="viewport-host" />
      <div className="viewport-title">
        <span className="panel__index">03</span>
        <span className="status-dot" />
        <div>
          <strong>3D 地形视图</strong>
          <small>左键雕刻/放置 · 右键旋转 · 滚轮缩放 · 中键平移</small>
        </div>
      </div>
      <div className="viewport-axis" aria-hidden>
        <span className="axis-x">X</span>
        <span className="axis-y">Y</span>
        <span className="axis-z">Z</span>
      </div>
    </main>
  );
}
