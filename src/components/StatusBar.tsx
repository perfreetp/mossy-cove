import { useStore } from '../store';

export default function StatusBar(): JSX.Element {
  const snapshot = useStore((s) => s.snapshot);
  const saved = useStore((s) => s.saved);
  const busy = useStore((s) => s.busy);
  if (!snapshot) return <footer className="status-bar" />;
  const { status } = snapshot;

  const fpsClass = status.fps >= 50 ? 'good' : status.fps >= 30 ? 'warn' : 'bad';

  return (
    <footer className="status-bar">
      <span className={`fps ${fpsClass}`}>{status.fps} FPS</span>
      <span>障碍物 {status.obstacleCount}</span>
      <span>标注点 {status.pointCount}</span>
      <span>遮挡重算 {status.lastOcclusionMs} ms</span>
      <span className={`save-state ${saved ? 'saved' : 'saving'}`}>
        {busy ? '处理中…' : saved ? '已保存到本地浏览器' : '保存中…'}
      </span>
      <span className="spacer" />
      <span className="tech">Babylon.js · TypeScript · 数据仅存于本机 IndexedDB</span>
    </footer>
  );
}
