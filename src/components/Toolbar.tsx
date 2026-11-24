import { useRef } from 'react';
import { useStore } from '../store';
import type { GizmoMode, ToolMode } from '../types';

const TOOLS: { mode: ToolMode; label: string; hint: string }[] = [
  { mode: 'select', label: '选择/编辑', hint: '点选场景对象，用 Gizmo 拖动或旋转' },
  { mode: 'add-entry', label: '射入点', hint: '在场景中点击标注射入点（带方向）' },
  { mode: 'add-exit', label: '射出点', hint: '在场景中点击标注射出点（带方向）' },
  { mode: 'add-constraint', label: '约束点', hint: '添加中间约束点，自动加入全部候选弹道' },
  { mode: 'add-box', label: '长方体障碍', hint: '点击地面放置长方体障碍物' },
];

const GIZMOS: { mode: GizmoMode; label: string }[] = [
  { mode: 'position', label: '移动' },
  { mode: 'rotation', label: '旋转' },
  { mode: 'none', label: '关闭' },
];

export default function Toolbar(): JSX.Element {
  const toolMode = useStore((s) => s.toolMode);
  const setToolMode = useStore((s) => s.setToolMode);
  const gizmoMode = useStore((s) => s.gizmoMode);
  const setGizmoMode = useStore((s) => s.setGizmoMode);
  const exportProject = useStore((s) => s.exportProject);
  const importProject = useStore((s) => s.importProject);
  const importModel = useStore((s) => s.importModel);
  const resetProject = useStore((s) => s.resetProject);
  const restore = useStore((s) => s.restore);
  const busy = useStore((s) => s.busy);
  const toast = useStore((s) => s.toast);

  const projectInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">◎</span>
        <span className="brand-name">弹道轨迹三维重建</span>
      </div>

      <div className="tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.mode}
            className={`tool-btn ${toolMode === t.mode ? 'active' : ''}`}
            title={t.hint}
            onClick={() => setToolMode(t.mode)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tool-group">
        <span className="group-label">Gizmo</span>
        {GIZMOS.map((g) => (
          <button
            key={g.mode}
            className={`tool-btn small ${gizmoMode === g.mode ? 'active' : ''}`}
            onClick={() => setGizmoMode(g.mode)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="tool-group">
        <button className="tool-btn" onClick={() => modelInput.current?.click()} disabled={busy}>
          导入空间模型
        </button>
        <button className="tool-btn" onClick={() => projectInput.current?.click()} disabled={busy}>
          导入项目
        </button>
        <button className="tool-btn primary" onClick={exportProject}>
          导出文件
        </button>
        <button className="tool-btn" onClick={restore}>
          恢复草稿
        </button>
        <button className="tool-btn danger" onClick={resetProject}>
          清空
        </button>
      </div>

      <input
        ref={projectInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importProject(f);
          e.target.value = '';
        }}
      />
      <input
        ref={modelInput}
        type="file"
        accept=".glb,.gltf,model/gltf-binary"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importModel(f);
          e.target.value = '';
        }}
      />
      {toast && <div className="toast">{toast}</div>}
    </header>
  );
}
