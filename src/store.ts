// 全局 UI 状态：引擎快照同步、工具模式、自动保存、文件导入导出
import { create } from 'zustand';
import type { BallisticEngine, EngineSnapshot } from './engine/BallisticEngine';
import { emptyProject } from './engine/BallisticEngine';
import type { GizmoMode, ModelAsset, ToolMode } from './types';
import { loadProject, saveProject } from './lib/storage';
import { readProjectFile, rekeyProject, exportProjectFile } from './lib/io';
import { uid } from './lib/math';

interface AppState {
  snapshot: EngineSnapshot | null;
  toolMode: ToolMode;
  gizmoMode: GizmoMode;
  saved: boolean;
  busy: boolean;
  toast: string | null;
  engine: BallisticEngine | null;

  setEngine: (e: BallisticEngine) => void;
  setSnapshot: (s: EngineSnapshot) => void;
  setToolMode: (m: ToolMode) => void;
  setGizmoMode: (m: GizmoMode) => void;
  showToast: (msg: string) => void;

  exportProject: () => void;
  importProject: (file: File) => Promise<void>;
  resetProject: () => void;
  importModel: (file: File) => Promise<void>;
  restore: () => Promise<void>;
}

let saveTimer: number | null = null;
let toastTimer: number | null = null;

function scheduleSave(engine: BallisticEngine | null): void {
  if (!engine) return;
  useStore.setState({ saved: false });
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveProject(engine.getProjectData())
      .then(() => useStore.setState({ saved: true }))
      .catch(() => useStore.getState().showToast('自动保存失败（IndexedDB 不可用？）'));
  }, 800);
}

export const useStore = create<AppState>((set, get) => ({
  snapshot: null,
  toolMode: 'select',
  gizmoMode: 'position',
  saved: true,
  busy: false,
  toast: null,
  engine: null,

  setEngine: (e) => {
    set({ engine: e });
    e.subscribe((s) => {
      set({ snapshot: s });
      scheduleSave(e);
    });
  },

  setSnapshot: (s) => set({ snapshot: s }),

  setToolMode: (m) => {
    const { engine } = get();
    engine?.setToolMode(m);
    set({ toolMode: m });
  },

  setGizmoMode: (m) => {
    const { engine } = get();
    engine?.setGizmoMode(m);
    set({ gizmoMode: m });
  },

  showToast: (msg) => {
    set({ toast: msg });
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => set({ toast: null }), 3200);
  },

  exportProject: () => {
    const { engine } = get();
    if (!engine) return;
    try {
      exportProjectFile(engine.getProjectData());
      get().showToast('项目文件已导出');
    } catch (e) {
      get().showToast(`导出失败：${(e as Error).message}`);
    }
  },

  importProject: async (file) => {
    const { engine, showToast } = get();
    if (!engine) return;
    set({ busy: true });
    try {
      const raw = await readProjectFile(file);
      const project = rekeyProject(raw);
      project.name = raw.name;
      engine.loadProject(project);
      await saveProject(engine.getProjectData());
      set({ saved: true });
      showToast(`已导入项目「${project.name}」`);
    } catch (e) {
      showToast(`导入失败：${(e as Error).message}`);
    } finally {
      set({ busy: false });
    }
  },

  resetProject: () => {
    const { engine } = get();
    if (!engine) return;
    if (!window.confirm('确定清空当前场景？此操作会覆盖本地草稿。')) return;
    engine.reset();
    saveProject(engine.getProjectData()).catch(() => undefined);
    get().showToast('场景已重置');
  },

  importModel: async (file) => {
    const { engine, showToast } = get();
    if (!engine) return;
    set({ busy: true });
    try {
      const dataUrl = await readAsDataURL(file);
      const asset: ModelAsset = {
        id: uid('ast'),
        name: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        dataUrl,
        halfExtents: [1, 1, 1],
      };
      await engine.addModel(asset);
      showToast(`模型「${asset.name}」已加入场景`);
    } catch (e) {
      showToast(`模型导入失败：${(e as Error).message}`);
    } finally {
      set({ busy: false });
    }
  },

  restore: async () => {
    const { engine, showToast } = get();
    if (!engine) return;
    const saved = await loadProject();
    if (saved && (saved.points.length > 0 || saved.obstacles.length > 0)) {
      engine.loadProject(saved);
      set({ saved: true });
      showToast('已恢复本地自动保存的场景');
    } else {
      showToast('本地没有可恢复的草稿');
    }
  },
}));

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('读取失败'));
    r.readAsDataURL(file);
  });
}

export { emptyProject };
