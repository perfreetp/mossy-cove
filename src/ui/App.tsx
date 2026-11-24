import { createEffect, onCleanup, onMount } from 'solid-js';
import {
  state,
  pathResults,
  select,
  setTransformMode,
  addIce,
  addLight,
  undo,
  redo,
  canUndo,
  canRedo,
  deleteSelection,
  updateIce,
  updateLight,
  applyGroupTransform,
  groupMembers,
  groupCentroid,
  beginHistory,
} from '../state/store';
import { SceneManager } from '../three/SceneManager';
import { Sidebar } from './Panels';

export default function App() {
  let viewport!: HTMLDivElement;

  onMount(() => {
    const mgr = new SceneManager(viewport, {
      onSelect: (sel) => select(sel),
      onDragStart: () => beginHistory(),
      onIceTransform: (id, position, rotationY) => updateIce(id, { position, rotationY }),
      onLightMove: (id, position) => updateLight(id, { position }),
      onGroupTransform: (updates) => applyGroupTransform(updates),
      getGroupState: (groupId) => {
        const members = groupMembers(groupId);
        if (!members.length) return null;
        return {
          centroid: groupCentroid(groupId),
          members: members.map((m) => ({
            id: m.id,
            position: [...m.position] as [number, number, number],
            azimuth: m.azimuth,
          })),
        };
      },
    });

    // 文档 → 场景网格
    createEffect(() => mgr.syncDoc(state.doc));
    // 选择 / 手柄模式
    createEffect(() => mgr.syncSelection(state.selection, state.transformMode));
    // 透射路径与光斑(任何冰体/灯变化都会重算)
    createEffect(() => mgr.syncPaths(pathResults()));

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelection();
      } else if (e.key === 'Escape') {
        select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  return (
    <div class="app">
      <header class="toolbar">
        <span class="app-title">冰灯透射布光布置器</span>
        <div class="tool-group">
          <button onClick={() => addIce('wall')}>+ 冰墙</button>
          <button onClick={() => addIce('column')}>+ 冰柱</button>
          <button onClick={() => addIce('brick')}>+ 冰砖</button>
          <button onClick={() => addLight()}>+ 灯</button>
        </div>
        <div class="tool-group">
          <button
            classList={{ active: state.transformMode === 'translate' }}
            onClick={() => setTransformMode('translate')}
          >
            平移
          </button>
          <button
            classList={{ active: state.transformMode === 'rotate' }}
            onClick={() => setTransformMode('rotate')}
          >
            旋转
          </button>
        </div>
        <div class="tool-group">
          <button disabled={!canUndo()} onClick={() => undo()}>
            撤销
          </button>
          <button disabled={!canRedo()} onClick={() => redo()}>
            重做
          </button>
          <button class="danger" disabled={!state.selection} onClick={() => deleteSelection()}>
            删除选中
          </button>
        </div>
        <span class="hint toolbar-hint">左键拖动旋转视角 · 滚轮缩放 · 点击选中 · Ctrl+Z 撤销</span>
      </header>
      <div class="main">
        <div class="viewport" ref={viewport} />
        <Sidebar />
      </div>
    </div>
  );
}
