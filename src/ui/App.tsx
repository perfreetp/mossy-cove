import { useCallback, useEffect, useRef, useState } from 'react';
import { BoneLibrary } from './BoneLibrary';
import { PosePanel } from './PosePanel';
import { TopBar } from './TopBar';
import { SceneManager } from '../three/SceneManager';
import { skeletonStore } from '../store/skeletonStore';
import { buildDemoSkeleton } from '../lib/demoSkeleton';

let toastSeq = 0;

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const showToast = useCallback((text: string) => {
    toastSeq += 1;
    setToast({ id: toastSeq, text });
  }, []);

  // 初始化 three.js 场景
  useEffect(() => {
    if (!containerRef.current) return;
    const mgr = new SceneManager(containerRef.current);
    sceneRef.current = mgr;

    const unsub = skeletonStore.subscribe(() => mgr.syncFromStore());

    const onGroundSnap = (ev: Event) => {
      const detail = (ev as CustomEvent<{ on: boolean }>).detail;
      if (detail.on) {
        const snapped = mgr.computeGroundSnapped();
        skeletonStore.setGroundSnap(true, snapped);
        showToast('足部已贴合地形');
      } else {
        skeletonStore.setGroundSnap(false);
      }
      mgr.syncFromStore();
    };
    window.addEventListener('psr:ground-snap', onGroundSnap);

    return () => {
      window.removeEventListener('psr:ground-snap', onGroundSnap);
      unsub();
      mgr.dispose();
      sceneRef.current = null;
    };
  }, [showToast]);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // 键盘快捷键：撤销/重做/删除
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        const label = skeletonStore.undo();
        if (label) showToast(`撤销：${label}`);
      } else if (
        (mod && e.key.toLowerCase() === 'y') ||
        (mod && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        const label = skeletonStore.redo();
        if (label) showToast(`重做：${label}`);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = skeletonStore.getSnapshot().selectedId;
        if (id) {
          skeletonStore.removeBone(id);
          showToast('已删除骨骼（含子级）');
        }
      } else if (e.key === 'Escape') {
        skeletonStore.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showToast]);

  // ---------- DnD ----------

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-bone-template')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const key = e.dataTransfer.getData('application/x-bone-template');
    if (!key || !sceneRef.current) return;
    e.preventDefault();
    const result = sceneRef.current.handleDrop(key, e.clientX, e.clientY);
    showToast(result.snapped ? '已吸附到最近关节插槽' : '已放置（未找到兼容插槽，作为根骨骼）');
  };

  // ---------- 顶栏动作 ----------

  const handleExport = () => {
    const blob = new Blob([skeletonStore.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skeleton-pose-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已导出骨骼层级与姿态数据');
  };

  const handleImport = (file: File) => {
    file.text().then((text) => {
      try {
        skeletonStore.importJSON(text);
        sceneRef.current?.syncFromStore();
        showToast(`导入成功：${JSON.parse(text).bones.length} 块骨骼`);
      } catch (err) {
        showToast(`导入失败：${(err as Error).message}`);
      }
    });
  };

  const handleLoadDemo = () => {
    const demo = buildDemoSkeleton();
    skeletonStore.loadProject(demo);
    sceneRef.current?.syncFromStore();
    showToast(`演示骨架已载入：${demo.bones.length} 块骨骼`);
  };

  const handleMirror = () => {
    const mgr = sceneRef.current;
    if (!mgr) return;
    const ok = mgr.mirrorSelected();
    mgr.syncFromStore();
    showToast(ok ? '镜像子树已生成' : '中线骨骼无法镜像，请选择单侧骨骼');
  };

  const handleDelete = () => {
    const id = skeletonStore.getSnapshot().selectedId;
    if (id) {
      skeletonStore.removeBone(id);
      showToast('已删除骨骼（含子级）');
    }
  };

  return (
    <div className="app">
      <TopBar
        onExport={handleExport}
        onImport={handleImport}
        onLoadDemo={handleLoadDemo}
        onMirror={handleMirror}
        onDelete={handleDelete}
      />
      <BoneLibrary />
      <div
        className="viewport"
        ref={containerRef}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div className="hint">
          <b>操作提示</b><br />
          · 从左侧骨骼库拖入骨骼，自动吸附最近兼容插槽并建立父子层级<br />
          · 点击骨骼选中，拖动手柄的红/绿/蓝轴绕关节旋转；顶到活动角会停在极限并红色高亮<br />
          · 脊柱任一关节旋转，下游骨骼通过层级自动跟随<br />
          · 空白处拖动旋转视角，滚轮缩放；Delete 删除，Ctrl+Z / Ctrl+Y 撤销重做
        </div>
        {toast && <div key={toast.id} className="toast">{toast.text}</div>}
      </div>
      <PosePanel />
    </div>
  );
}
