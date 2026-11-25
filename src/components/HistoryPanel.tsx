import { useState } from 'react';
import * as THREE from 'three';
import { editorStore } from '../state/editorStore';
import { useEditorSummary } from '../state/useEditor';
import { exportMesh, type ExportFormat } from '../geometry/exportModel';

/** 模块四：历史与导出（撤销/重做、操作栈浏览、模型文件导出分享） */
export function HistoryPanel() {
  const summary = useEditorSummary();
  const [exporting, setExporting] = useState(false);

  const doExport = async (format: ExportFormat) => {
    const geo = editorStore.getPresentGeometry();
    const organ = editorStore.getOrgan(summary.activeOrganId ?? '');
    if (!geo || !organ) return;
    setExporting(true);
    try {
      const tempMesh = new THREE.Mesh(geo, [
        new THREE.MeshStandardMaterial({ name: 'organ-body' }),
        new THREE.MeshStandardMaterial({ name: 'section-cap' }),
      ]);
      await exportMesh(tempMesh, format, `${organ.name}-clipped`);
    } catch (e) {
      alert(`导出失败：${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="panel">
        <h2>
          <span className="num">4</span>历史与导出
        </h2>
        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button
            className="primary"
            disabled={!summary.canUndo}
            onClick={() => editorStore.undo()}
            title="撤销（Ctrl+Z）"
          >
            ↶ 撤销
          </button>
          <button
            className="primary"
            disabled={!summary.canRedo}
            onClick={() => editorStore.redo()}
            title="重做（Ctrl+Y）"
          >
            ↷ 重做
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
          可撤销 {summary.undoCount} 步 · 可重做 {summary.redoCount} 步
          （每个器官的历史相互独立）
        </div>
        <div className="history-list">
          {summary.historyLabels.map((label, i) => (
            <div
              key={i}
              className={`history-entry ${i === summary.cursor ? 'current' : ''} ${
                i > summary.cursor ? 'future' : ''
              }`}
            >
              <span className="idx">{i}</span>
              <span>{label}</span>
            </div>
          ))}
          {summary.historyLabels.length === 0 && <div className="empty-tip">暂无操作记录</div>}
        </div>
      </div>

      <div className="panel">
        <h2>导出分享</h2>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.6 }}>
          导出当前器官裁剪后的网格，断面保留为独立材质分层。
        </div>
        <div className="btn-row">
          <button disabled={!summary.activeOrganId || exporting} onClick={() => void doExport('obj')}>
            OBJ
          </button>
          <button disabled={!summary.activeOrganId || exporting} onClick={() => void doExport('stl')}>
            STL
          </button>
          <button disabled={!summary.activeOrganId || exporting} onClick={() => void doExport('glb')}>
            GLB
          </button>
          <button disabled={!summary.activeOrganId || exporting} onClick={() => void doExport('gltf')}>
            GLTF
          </button>
        </div>
        {exporting && <div style={{ marginTop: 8, color: 'var(--accent)' }}>正在导出…</div>}
      </div>
    </>
  );
}
