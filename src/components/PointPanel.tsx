import { useStore } from '../store';
import type { BallisticPoint, Vec3 } from '../types';

const TYPE_LABEL: Record<BallisticPoint['type'], string> = {
  entry: '射入点',
  exit: '射出点',
  constraint: '约束点',
};

export default function PointPanel(): JSX.Element {
  const snapshot = useStore((s) => s.snapshot);
  const engine = useStore((s) => s.engine);
  if (!snapshot) return <section className="panel" />;

  const { points, selection } = snapshot;
  const selected = points.find((p) => p.id === selection.id && selection.kind === 'point') ?? null;

  const update = (id: string, patch: Partial<Pick<BallisticPoint, 'position' | 'direction' | 'label'>>) =>
    engine?.updatePoint(id, patch);

  return (
    <section className="panel">
      <h2>弹道点位标注</h2>
      <p className="hint">顶部选择点类型工具后，在视口中点击地面或物体表面放置。每个点带方向箭头，选中后用旋转 Gizmo 调整。</p>

      <div className="point-list">
        {points.length === 0 && <div className="empty">暂无标注点</div>}
        {points.map((p) => (
          <div
            key={p.id}
            className={`list-item point-item type-${p.type} ${selected?.id === p.id ? 'selected' : ''}`}
          >
            <button
              className="item-main"
              onClick={() => engine?.selectObject({ kind: 'point', id: p.id })}
              title="在场景中选中"
            >
              <span className={`dot dot-${p.type}`} />
              <span className="item-label">{p.label}</span>
            </button>
            <button className="mini-btn" onClick={() => engine?.removePoint(p.id)} title="删除该点">
              ✕
            </button>
          </div>
        ))}
      </div>

      {selected && (
        <div className="inspector">
          <h3>{TYPE_LABEL[selected.type]}属性</h3>
          <label className="field">
            <span>名称</span>
            <input
              value={selected.label}
              onChange={(e) => update(selected.id, { label: e.target.value })}
            />
          </label>

          <VecEditor
            title="位置 (x, y, z)"
            value={selected.position}
            step={0.1}
            onChange={(position) => update(selected.id, { position })}
          />

          <VecEditor
            title="方向向量（自动归一化）"
            value={selected.direction}
            step={0.05}
            onChange={(direction) => update(selected.id, { direction })}
          />

          <div className="dir-presets">
            <span className="field-title">方向预设</span>
            <div className="preset-row">
              {([
                ['+X', [1, 0, 0]],
                ['-X', [-1, 0, 0]],
                ['+Y', [0, 1, 0]],
                ['-Y', [0, -1, 0]],
                ['+Z', [0, 0, 1]],
                ['-Z', [0, 0, -1]],
              ] as [string, Vec3][]).map(([label, dir]) => (
                <button key={label} className="mini-btn" onClick={() => update(selected.id, { direction: dir })}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {(selected.type === 'entry' || selected.type === 'exit') && (
            <button className="tool-btn small wide" onClick={() => engine?.alignEntryToExit(selected.id)}>
              方向对准另一端点
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function VecEditor({
  title,
  value,
  step,
  onChange,
}: {
  title: string;
  value: Vec3;
  step: number;
  onChange: (v: Vec3) => void;
}): JSX.Element {
  return (
    <div className="vec-editor">
      <span className="field-title">{title}</span>
      <div className="vec-row">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <label key={axis} className="vec-input">
            <span>{axis.toUpperCase()}</span>
            <input
              type="number"
              step={step}
              value={round(value[i])}
              onChange={(e) => {
                const next: Vec3 = [value[0], value[1], value[2]];
                next[i] = Number(e.target.value);
                onChange(next);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
