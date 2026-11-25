import { useEffect, useRef, useState } from 'react';
import { SceneManager } from '../three/SceneManager';
import type { KnifeState } from '../three/KnifePlane';
import type { InteractionMode } from '../types';
import { useEditorSummary } from '../state/useEditor';

export interface ViewportHandle {
  scene: SceneManager | null;
}

interface Props {
  mode: InteractionMode;
  onSceneReady: (scene: SceneManager) => void;
}

const MODE_HINTS: Record<InteractionMode, string> = {
  orbit: '观察模式：<b>左键旋转</b> · 右键平移 · 滚轮缩放',
  'knife-translate': '平面刀平移：在刀面上<b>按住拖动</b>，断面实时重算',
  'knife-rotate': '自由旋转：<b>按住拖动</b>调整刀面法向（一档自由旋转）',
  'manual-fill': '手动补洞：沿高亮边界环<b>依次点击吸附</b>，至少 3 点后提交',
  'cap-vertex': '顶点微调：拖动青色调整点；点断面空白处可新增调整点',
};

export function Viewport({ mode, onSceneReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const [knifeState, setKnifeState] = useState<KnifeState | null>(null);
  const [pickCount, setPickCount] = useState(0);
  const summary = useEditorSummary();

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new SceneManager(containerRef.current);
    sceneRef.current = scene;
    const unsubKnife = scene.setKnifeStateListener((s) =>
      setKnifeState({ ...s, normal: s.normal.clone(), center: s.center.clone() }),
    );
    scene.setManualPicksListener((c) => setPickCount(c));
    onSceneReady(scene);
    return () => {
      unsubKnife();
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);

  const fmt = (v: number) => v.toFixed(3);

  return (
    <div className="center-stage" ref={containerRef}>
      {knifeState && (mode === 'knife-translate' || mode === 'knife-rotate') && (
        <div className="knife-readout">
          <div className="row">
            <span>刀位预设</span>
            <span className="v">{knifeState.preset}</span>
          </div>
          <div className="row">
            <span>法向 n</span>
            <span className="v">
              ({fmt(knifeState.normal.x)}, {fmt(knifeState.normal.y)}, {fmt(knifeState.normal.z)})
            </span>
          </div>
          <div className="row">
            <span>中心 d</span>
            <span className="v">
              ({fmt(knifeState.center.x)}, {fmt(knifeState.center.y)}, {fmt(knifeState.center.z)})
            </span>
          </div>
          <div className="row">
            <span>偏移</span>
            <span className="v">{fmt(knifeState.offset)}</span>
          </div>
          {summary.previewActive && (
            <div className="row" style={{ marginTop: 6 }}>
              <span style={{ color: 'var(--accent-2)' }}>● 实时预览中（未入栈）</span>
            </div>
          )}
        </div>
      )}
      {mode === 'manual-fill' && (
        <div className="knife-readout">
          <div className="row">
            <span>已吸附点</span>
            <span className="v">{pickCount}</span>
          </div>
        </div>
      )}
      <div className="mode-hint" dangerouslySetInnerHTML={{ __html: MODE_HINTS[mode] }} />
    </div>
  );
}
