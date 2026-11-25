import { useEffect, useMemo, useState } from 'react';
import type { SceneManager } from '../three/SceneManager';
import { editorStore } from '../state/editorStore';
import { useEditorSummary } from '../state/useEditor';
import { measureLoops, type SectionMeasurement } from '../geometry/measure';

interface Props {
  scene: SceneManager | null;
  mode: string;
}

/** 模块三：断面编辑面板（环选择、测量、补洞、平移与顶点级微调） */
export function SectionPanel({ scene, mode }: Props) {
  const summary = useEditorSummary();
  const [selected, setSelected] = useState(0);
  const [nudge, setNudge] = useState(0.02);

  const measurements: SectionMeasurement[] = useMemo(() => {
    const geo = editorStore.getPresentGeometry();
    const loops = editorStore.getPresentLoops();
    if (!geo || loops.length === 0) return [];
    return measureLoops(geo, loops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.version, summary.activeOrganId, summary.loopCount]);

  // 环数变化（裁剪/撤销/切换器官）后钳制选择索引，并同步场景高亮
  useEffect(() => {
    if (measurements.length === 0) return;
    const clamped = Math.min(selected, measurements.length - 1);
    if (clamped !== selected) setSelected(clamped);
    scene?.selectLoop(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurements.length, summary.activeOrganId]);

  const hasLoops = measurements.length > 0;
  const current = measurements[Math.min(selected, Math.max(0, measurements.length - 1))];

  const selectLoop = (i: number) => {
    setSelected(i);
    scene?.selectLoop(i);
  };

  const applyNudge = (sign: number) => {
    if (!current) return;
    const loop = editorStore.getPresentLoops()[Math.min(selected, summary.loopCount - 1)];
    if (!loop) return;
    editorStore.translateCap(loop.indices[0], loop.plane.normal.clone().multiplyScalar(sign * nudge));
  };

  return (
    <div className="panel">
      <h2>
        <span className="num">3</span>断面编辑
      </h2>

      <div className="caption" style={{ color: 'var(--text-dim)', marginBottom: 6 }}>
        断面边界环（自动提取 · 闭合高亮）
      </div>
      {!hasLoops && <div className="empty-tip">当前没有开口断面环<br />先用平面刀裁剪模型</div>}
      <div className="btn-row" style={{ marginBottom: 10 }}>
        {measurements.map((m, i) => (
          <button
            key={i}
            className={`loop-chip ${i === selected ? 'active' : ''}`}
            onClick={() => selectLoop(i)}
            style={{ flex: '0 0 auto' }}
          >
            环 {i + 1} · {m.vertexCount} 点
          </button>
        ))}
      </div>

      {current && (
        <>
          <div className="stat-grid" style={{ marginBottom: 10 }}>
            <div className="stat">
              <div className="k">断面周长</div>
              <div className="v">{current.perimeter.toFixed(4)}</div>
            </div>
            <div className="stat">
              <div className="k">断面面积</div>
              <div className="v">{current.area.toFixed(4)}</div>
            </div>
            <div className="stat">
              <div className="k">边界顶点</div>
              <div className="v">{current.vertexCount}</div>
            </div>
            <div className="stat">
              <div className="k">法向 n</div>
              <div className="v" style={{ fontSize: 11 }}>
                {current.normal.x.toFixed(2)},{current.normal.y.toFixed(2)},{current.normal.z.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="caption" style={{ color: 'var(--text-dim)', marginBottom: 6 }}>补洞（生成封闭断面）</div>
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <button
              className="accent"
              onClick={() => scene?.autoFill()}
              title="对全部未封闭环一键补洞"
            >
              一键自动补洞
            </button>
          </div>
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <button
              onClick={() => scene?.undoManualPick()}
              disabled={mode !== 'manual-fill'}
            >
              撤销吸附点
            </button>
            <button
              className="primary"
              onClick={() => scene?.commitManualFill()}
              disabled={mode !== 'manual-fill'}
            >
              提交手动补洞
            </button>
          </div>

          <div className="caption" style={{ color: 'var(--text-dim)', marginBottom: 6 }}>
            断面平移微调（沿法向，步长 {nudge.toFixed(3)}）
          </div>
          <label className="field">
            <input
              type="range"
              min={0.002}
              max={0.2}
              step={0.002}
              value={nudge}
              onChange={(e) => setNudge(parseFloat(e.target.value))}
            />
          </label>
          <div className="btn-row">
            <button onClick={() => applyNudge(-1)}>沿 −n 平移</button>
            <button onClick={() => applyNudge(1)}>沿 +n 平移</button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            顶点级微调：切换到「顶点微调」模式后，拖动断面上的青色点；
            点击断面空白区域可追加调整点。所有微调均进入操作栈。
          </div>
        </>
      )}
    </div>
  );
}
