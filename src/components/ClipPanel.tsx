import { useEffect, useState } from 'react';
import type { SceneManager } from '../three/SceneManager';
import type { AxisPreset, InteractionMode } from '../types';
import { useEditorSummary } from '../state/useEditor';

interface Props {
  scene: SceneManager | null;
  mode: InteractionMode;
  setMode: (m: InteractionMode) => void;
}

const MODES: { key: InteractionMode; label: string }[] = [
  { key: 'orbit', label: '观察' },
  { key: 'knife-translate', label: '刀平移' },
  { key: 'knife-rotate', label: '自由旋转' },
  { key: 'manual-fill', label: '手动补洞' },
  { key: 'cap-vertex', label: '顶点微调' },
];

const PRESETS: { key: AxisPreset; label: string }[] = [
  { key: 'X', label: 'X 轴刀位' },
  { key: 'Y', label: 'Y 轴刀位' },
  { key: 'Z', label: 'Z 轴刀位' },
  { key: 'FREE', label: '自由档' },
];

/** 模块二：裁剪工作区控制（轴向预设、刀位交互、提交/取消） */
export function ClipPanel({ scene, mode, setMode }: Props) {
  const summary = useEditorSummary();
  const hasModel = !!summary.activeOrganId;
  const [offset, setOffset] = useState(0);
  const knifeActive = mode === 'knife-translate' || mode === 'knife-rotate';

  // 订阅场景刀位变化（视图内拖动/预设/翻转都会回传），保持滑块与刀位同步
  useEffect(() => {
    if (!scene) return;
    return scene.setKnifeStateListener((s) => setOffset(s.offset));
  }, [scene]);

  return (
    <div className="panel">
      <h2>
        <span className="num">2</span>裁剪工作区
      </h2>

      <div className="caption" style={{ color: 'var(--text-dim)', marginBottom: 6 }}>交互模式</div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        {MODES.map((m) => (
          <button
            key={m.key}
            className={mode === m.key ? 'active' : ''}
            onClick={() => setMode(m.key)}
            disabled={!hasModel}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="caption" style={{ color: 'var(--text-dim)', marginBottom: 6 }}>轴向预设刀位</div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => scene?.applyPreset(p.key)}
            disabled={!hasModel || !knifeActive}
            title={p.key === 'FREE' ? '保留当前法向，进入自由旋转档' : `法向对齐 ${p.key} 轴并居中`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="field">
        <span className="caption">
          <span>刀位偏移（沿法向微调）</span>
          <span>{offset.toFixed(3)}</span>
        </span>
        <input
          type="range"
          min={-1.5}
          max={1.5}
          step={0.005}
          value={offset}
          disabled={!hasModel || !knifeActive}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setOffset(v);
            scene?.setKnifeOffset(v);
          }}
        />
      </label>

      <div className="btn-row" style={{ marginBottom: 8 }}>
        <button onClick={() => scene?.flipKnife()} disabled={!hasModel || !knifeActive}>
          翻转法向
        </button>
        <button onClick={() => scene?.frameView()} disabled={!hasModel}>
          复位视角
        </button>
      </div>

      <div className="section-gap" />

      <div className="btn-row">
        <button
          className="primary"
          disabled={!hasModel || !knifeActive}
          onClick={() => scene?.commitClip()}
        >
          提交裁剪入栈
        </button>
        <button
          className="danger"
          disabled={!summary.previewActive}
          onClick={() => scene?.cancelPreview()}
        >
          取消预览
        </button>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
        拖动平面刀时断面实时重算但<b style={{ color: 'var(--accent-2)' }}>不写历史</b>；
        点击「提交裁剪入栈」后才生成可撤销/重做的记录。
      </div>
    </div>
  );
}
