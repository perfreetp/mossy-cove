import { useRef, useState } from 'react';
import { loadModelFile } from '../geometry/loadModel';
import { editorStore } from '../state/editorStore';
import { useEditorSummary } from '../state/useEditor';

/** 模块一：模型导入区（拖拽/选择导入 + 器官列表切换，历史各自独立） */
export function ModelPanel() {
  const summary = useEditorSummary();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const { name, geometry } = await loadModelFile(file);
        editorStore.addOrgan(name, geometry);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <div className="panel">
        <h2>
          <span className="num">1</span>模型导入
        </h2>
        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFiles(e.dataTransfer.files);
          }}
        >
          <div className="big">🫀</div>
          {busy ? '正在解析模型…' : '点击或拖拽导入器官模型'}
          <div style={{ marginTop: 6, fontSize: 11 }}>支持 OBJ / STL / GLTF / GLB</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".obj,.stl,.gltf,.glb"
          multiple
          onChange={(e) => void handleFiles(e.target.files)}
        />
        {error && (
          <div style={{ color: 'var(--danger)', marginTop: 8, fontSize: 11 }}>{error}</div>
        )}
      </div>

      <div className="panel">
        <h2>器官列表</h2>
        {summary.organs.length === 0 && <div className="empty-tip">尚未导入器官</div>}
        {summary.organs.map((o) => (
          <div
            key={o.id}
            className={`organ-item ${o.id === summary.activeOrganId ? 'active' : ''}`}
            onClick={() => editorStore.setActiveOrgan(o.id)}
          >
            <div className="name">
              <span title={o.name}>{o.name}</span>
              <button
                className="remove danger"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`移除器官「${o.name}」？其裁剪历史将一并删除。`)) {
                    editorStore.removeOrgan(o.id);
                  }
                }}
              >
                删除
              </button>
            </div>
            <div className="meta">
              {Math.round(o.triangleCount).toLocaleString()} 面 · {o.vertexCount.toLocaleString()} 顶点
              {o.id === summary.activeOrganId && <span className="pill" style={{ marginLeft: 6 }}>当前</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
