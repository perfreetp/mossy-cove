import { useStore } from '../store';
import type { Trajectory } from '../types';

const BEND_LABELS = ['1 近直线', '2 弱弯', '3 标准', '4 强弯', '5 大弯'];

export default function TrajectoryPanel(): JSX.Element {
  const snapshot = useStore((s) => s.snapshot);
  const engine = useStore((s) => s.engine);
  if (!snapshot) return <section className="panel" />;

  const { trajectories, activeTrajectoryId, points } = snapshot;
  const active = trajectories.find((t) => t.id === activeTrajectoryId) ?? null;
  const hasEntry = points.some((p) => p.type === 'entry');
  const hasExit = points.some((p) => p.type === 'exit');

  return (
    <section className="panel">
      <h2>轨迹拟合与遮挡检查</h2>

      <div className="panel-actions">
        <button
          className="tool-btn small primary"
          disabled={!hasEntry || !hasExit}
          title={!hasEntry || !hasExit ? '需要先标注射入点与射出点' : '基于当前点位生成一条候选弹道'}
          onClick={() => engine?.createTrajectory()}
        >
          + 生成候选弹道
        </button>
      </div>
      {(!hasEntry || !hasExit) && (
        <p className="hint warn">请先在场景中标注射入点和射出点，再拟合弹道。</p>
      )}

      <div className="traj-list">
        {trajectories.length === 0 && <div className="empty">暂无候选弹道</div>}
        {trajectories.map((t, idx) => (
          <TrajRow key={t.id} traj={t} index={idx} active={t.id === activeTrajectoryId} />
        ))}
      </div>

      {active && <TrajInspector traj={active} />}
    </section>
  );
}

function TrajRow({ traj, index, active }: { traj: Trajectory; index: number; active: boolean }): JSX.Element {
  const engine = useStore((s) => s.engine);
  return (
    <div className={`list-item traj-item ${active ? 'selected' : ''}`}>
      <button
        className="item-main"
        onClick={() => engine?.selectTrajectory(traj.id)}
        title="选中对比，其余弹道淡出"
      >
        <span className="color-chip" style={{ background: traj.color }} />
        <span className="item-label">{traj.name}</span>
        <span className="item-sub">
          {traj.pointIds.length} 点 · 档位 {traj.bendLevel} · {traj.occlusions.length} 段遮挡
        </span>
      </button>
      <button
        className="mini-btn"
        title={traj.visible ? '隐藏' : '显示'}
        onClick={() => engine?.setTrajectoryVisible(traj.id, !traj.visible)}
      >
        {traj.visible ? '👁' : '—'}
      </button>
      <button className="mini-btn" onClick={() => engine?.removeTrajectory(traj.id)} title="删除">
        ✕
      </button>
      <span className="idx-badge">{index + 1}</span>
    </div>
  );
}

function TrajInspector({ traj }: { traj: Trajectory }): JSX.Element {
  const engine = useStore((s) => s.engine);
  return (
    <div className="inspector">
      <h3>拟合参数 — {traj.name}</h3>

      <div className="field">
        <span>弯曲强度档位：{BEND_LABELS[traj.bendLevel - 1]}</span>
        <div className="bend-row">
          {[1, 2, 3, 4, 5].map((lv) => (
            <button
              key={lv}
              className={`bend-btn ${traj.bendLevel === lv ? 'active' : ''}`}
              onClick={() => engine?.setBendLevel(traj.id, lv)}
            >
              {lv}
            </button>
          ))}
        </div>
      </div>

      <label className="switch-field">
        <input
          type="checkbox"
          checked={traj.snap}
          onChange={(e) => engine?.setSnap(traj.id, e.target.checked)}
        />
        <span>
          吸附约束点（硬通过）
          <small>{traj.snap ? '曲线精确穿过全部约束点' : '约束点为软约束，曲线向弦线松弛'}</small>
        </span>
      </label>

      <div className="stats-grid">
        <div className="stat">
          <b>{traj.samples.length}</b>
          <span>采样点</span>
        </div>
        <div className="stat">
          <b>{traj.occlusions.length}</b>
          <span>遮挡段</span>
        </div>
        <div className="stat">
          <b>{traj.pointIds.length}</b>
          <span>约束点位</span>
        </div>
      </div>

      <h3>遮挡判定结果</h3>
      {traj.occlusions.length === 0 ? (
        <div className="empty ok">该弹道与场景障碍物无相交</div>
      ) : (
        <div className="occl-list">
          {traj.occlusions.map((seg, i) => (
            <div key={i} className="occl-item">
              <div className="occl-head">
                <span className="occl-name">{seg.obstacleName}</span>
                <span className="occl-range">
                  t {seg.tStart.toFixed(3)} → {seg.tEnd.toFixed(3)}
                </span>
              </div>
              <div className="occl-pos">
                入射 ({seg.enterPosition.map((n) => n.toFixed(2)).join(', ')})
              </div>
              <div className="occl-pos">
                穿出 ({seg.exitPosition.map((n) => n.toFixed(2)).join(', ')})
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="hint">导出文件将包含各点位坐标方向、曲线 {traj.samples.length} 个采样点及以上遮挡判定结果。</p>
    </div>
  );
}
