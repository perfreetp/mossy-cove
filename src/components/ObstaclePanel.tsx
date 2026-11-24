import { useStore } from '../store';

export default function ObstaclePanel(): JSX.Element {
  const snapshot = useStore((s) => s.snapshot);
  const engine = useStore((s) => s.engine);
  if (!snapshot) return <section className="panel" />;

  const { obstacles, selection } = snapshot;
  const selected =
    obstacles.find((o) => o.id === selection.id && selection.kind === 'obstacle') ?? null;

  return (
    <section className="panel">
      <h2>场景与障碍物</h2>
      <p className="hint">放置长方体或导入 GLB 空间模型。拖动/旋转障碍物时，弹道遮挡关系在视口中实时重判，相交段红色高亮。</p>

      <div className="panel-actions">
        <button className="tool-btn small" onClick={() => engine?.addBox()}>
          + 长方体
        </button>
        <button
          className="tool-btn small"
          title="性能压测：一次加入 200 个长方体"
          onClick={() => engine?.addStressBoxes(200)}
        >
          压测 +200
        </button>
      </div>

      <div className="obstacle-list">
        {obstacles.length === 0 && <div className="empty">场景中暂无障碍物</div>}
        {obstacles.map((o) => (
          <div
            key={o.id}
            className={`list-item ${selected?.id === o.id ? 'selected' : ''}`}
          >
            <button className="item-main" onClick={() => engine?.selectObject({ kind: 'obstacle', id: o.id })}>
              <span className="ob-icon">{o.kind === 'box' ? '▣' : '◇'}</span>
              <span className="item-label">{o.name}</span>
              <span className="item-sub">
                {o.halfExtents[0].toFixed(1)}×{o.halfExtents[1].toFixed(1)}×{o.halfExtents[2].toFixed(1)}
              </span>
            </button>
            <button
              className="mini-btn"
              title={o.visible ? '隐藏' : '显示'}
              onClick={() => engine?.updateObstacle(o.id, { visible: !o.visible })}
            >
              {o.visible ? '👁' : '—'}
            </button>
            <button className="mini-btn" onClick={() => engine?.removeObstacle(o.id)} title="删除">
              ✕
            </button>
          </div>
        ))}
      </div>

      {selected && (
        <div className="inspector">
          <h3>障碍物属性</h3>
          <label className="field">
            <span>名称</span>
            <input
              value={selected.name}
              onChange={(e) => engine?.updateObstacle(selected.id, { name: e.target.value })}
            />
          </label>
          <div className="vec-editor">
            <span className="field-title">位置</span>
            <div className="vec-row">
              {(['x', 'y', 'z'] as const).map((axis, i) => (
                <label key={axis} className="vec-input">
                  <span>{axis.toUpperCase()}</span>
                  <input
                    type="number"
                    step={0.1}
                    value={Math.round(selected.position[i] * 1000) / 1000}
                    onChange={(e) => {
                      const next = [...selected.position] as [number, number, number];
                      next[i] = Number(e.target.value);
                      engine?.updateObstacle(selected.id, { position: next });
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="vec-editor">
            <span className="field-title">旋转（弧度）</span>
            <div className="vec-row">
              {(['x', 'y', 'z'] as const).map((axis, i) => (
                <label key={axis} className="vec-input">
                  <span>{axis.toUpperCase()}</span>
                  <input
                    type="number"
                    step={0.05}
                    value={Math.round(selected.rotation[i] * 1000) / 1000}
                    onChange={(e) => {
                      const next = [...selected.rotation] as [number, number, number];
                      next[i] = Number(e.target.value);
                      engine?.updateObstacle(selected.id, { rotation: next });
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
          {selected.kind === 'box' && (
            <label className="field">
              <span>颜色</span>
              <input
                type="color"
                value={selected.color}
                onChange={(e) => engine?.updateObstacle(selected.id, { color: e.target.value })}
              />
            </label>
          )}
        </div>
      )}
    </section>
  );
}
