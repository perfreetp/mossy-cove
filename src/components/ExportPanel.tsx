import { useRef, useState } from 'react';
import type { SandboxEngine } from '../terrain/SandboxEngine';
import { parseProjectData } from '../terrain/project';
import { useEngineState } from '../terrain/useEngineState';
import { Panel } from './controls';

export function ExportPanel({ engine }: { engine: SandboxEngine }) {
  const state = useEngineState(engine);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const exportJson = () => {
    const project = engine.serializeProject();
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    anchor.href = url;
    anchor.download = `${state.name || 'micro-sandbox'}-${stamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage({ kind: 'ok', text: `已导出高度场与 ${project.buildings.length} 栋建筑。` });
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const project = parseProjectData(text);
      engine.importProject(project);
      setMessage({ kind: 'ok', text: `导入成功：${project.resolution} 格高度场，${project.buildings.length} 栋建筑。` });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '导入失败' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const savedLabel = state.savedAt ? new Date(state.savedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '尚未保存';

  return (
    <Panel index="04" title="导出 / 导入" icon="⇩" className="export-panel">
      <label className="name-row">
        <span>沙盘名称</span>
        <input value={state.name} onChange={(e) => engine.setName(e.target.value)} placeholder="输入沙盘名称" />
      </label>

      <div className="storage-status" data-status={state.saveStatus}>
        <span className="status-dot" />
        <div>
          <strong>
            {state.saveStatus === 'saving' && '正在写入浏览器…'}
            {state.saveStatus === 'saved' && '已自动保存到 localStorage'}
            {state.saveStatus === 'error' && '浏览器存储失败，请导出 JSON'}
            {state.saveStatus === 'idle' && '本地自动存档已启用'}
          </strong>
          <small>{savedLabel} · 刷新页面可恢复</small>
        </div>
        <button className="icon-button" title="立即保存" onClick={() => engine.saveNow()}>↻</button>
      </div>

      <div className="export-summary">
        <div><strong>{state.resolution}</strong><span>每边格数</span></div>
        <div><strong>{state.stats.vertices.toLocaleString()}</strong><span>顶点</span></div>
        <div><strong>{state.buildingCount}</strong><span>建筑</span></div>
      </div>

      <button className="button button--primary button--block" onClick={exportJson}>
        导出分享 JSON
      </button>
      <button className="button button--block" onClick={() => fileRef.current?.click()}>
        重新导入 JSON
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => void importFile(e.target.files?.[0])}
      />

      {message && <p className={`form-message form-message--${message.kind}`}>{message.text}</p>}

      <div className="json-fields">
        <p>JSON 包含：</p>
        <code>resolution · heightField[{(state.resolution + 1) ** 2}] · buildings[{state.buildingCount}] · water · strata · sections</code>
      </div>

      <div className="danger-zone">
        {!confirmReset ? (
          <button className="button button--danger-ghost button--block" onClick={() => setConfirmReset(true)}>
            重置为示例地形
          </button>
        ) : (
          <div className="confirm-row">
            <span>撤销栈也会清空，确定？</span>
            <div>
              <button className="button button--danger" onClick={() => { engine.resetSampleTerrain(); setConfirmReset(false); }}>
                确定重置
              </button>
              <button className="button button--ghost" onClick={() => setConfirmReset(false)}>取消</button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
