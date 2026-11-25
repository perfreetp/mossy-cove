import { createEffect, createMemo, For, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { AxisName, ToolMode } from './types';
import { AppStore, createInitialPlanes } from './store';
import { exportDoc, importDoc, loadFromLocal, saveToLocal } from './persistence';
import { Viewer } from './three/viewer';
import './styles.css';

const AXIS_INFO: { axis: AxisName; name: string; plane: string; color: string }[] = [
  { axis: 'x', name: 'X 剖切', plane: 'YZ 面', color: '#4fc3f7' },
  { axis: 'y', name: 'Y 剖切', plane: 'XZ 面', color: '#81c784' },
  { axis: 'z', name: 'Z 剖切', plane: 'XY 面', color: '#ba68c8' },
];

const TOOLS: { mode: ToolMode; label: string; hint: string }[] = [
  { mode: 'navigate', label: '浏览', hint: '旋转/平移/缩放视图' },
  { mode: 'annotate', label: '标注', hint: '在截面轮廓上单击放置尺寸标注' },
  { mode: 'measure', label: '测量', hint: '在截面上单击量取榫头宽度' },
];

const PART_COLORS: Record<string, number> = {
  column: 0xb07a45,
  beam: 0xa06a38,
  wedge: 0x8a5a30,
};

export default function App() {
  let containerRef: HTMLDivElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let viewer: Viewer;
  const [toast, setToast] = createStore({ message: '', visible: false });
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // 与 joint.ts 程序几何的实际包围盒保持一致(含 0.4 余量)
  const bounds = [
    { min: -1.0, max: 4.0 },
    { min: -2.9, max: 2.9 },
    { min: -2.9, max: 2.9 },
  ];
  const store = new AppStore(
    [
      { id: 'column', name: '立柱 · 透榫眼', visible: true, color: PART_COLORS.column },
      { id: 'beam', name: '梁 · 榫头', visible: true, color: PART_COLORS.beam },
      { id: 'wedge', name: '木楔', visible: true, color: PART_COLORS.wedge },
    ],
    createInitialPlanes(bounds),
  );
  store.setBounds(bounds);

  const showToast = (message: string) => {
    setToast({ message, visible: true });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast('visible', false), 2600);
  };

  onMount(() => {
    viewer = new Viewer(containerRef!, store);
    viewer.setMeasureCallback((record) => {
      store.addMeasure(record);
      showToast(
        record.kind === 'tenon-width'
          ? `榫头宽度 ${(record.value * 1000).toFixed(1)} mm`
          : `榫眼深度 ${(record.value * 1000).toFixed(1)} mm`,
      );
    });

    // 启动恢复本地文档
    const local = loadFromLocal();
    if (local) {
      try {
        store.hydrate(local);
        viewer.syncPartVisibility();
        viewer.syncAnnotationViews(store.state.annotations);
        viewer.rebuildAllSections();
        showToast(`已恢复本地工作区(${local.annotations.length} 个标注)`);
      } catch (err) {
        console.warn(err);
      }
    }
  });

  // 自动保存(防抖)
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    JSON.stringify(store.state.planes);
    JSON.stringify(store.state.parts);
    JSON.stringify(store.state.annotations);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveToLocal(store.toSavedDoc()), 400);
  });

  // 标注记录变化 -> 同步三维视图
  createEffect(() => {
    const records = store.state.annotations;
    if (viewer) viewer.syncAnnotationViews(records);
  });

  const annotationCount = createMemo(() => store.state.annotations.length);

  const onImportFile = async (file: File) => {
    try {
      const doc = await importDoc(file);
      const result = store.loadSavedDoc(doc);
      viewer!.syncPartVisibility();
      viewer!.syncAnnotationViews(store.state.annotations);
      viewer!.rebuildAllSections();
      showToast(`导入成功:还原 ${result.annotationCount} 个标注与全部剖切面`);
    } catch (err) {
      showToast(`导入失败:${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  return (
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">榫</span>
          <div>
            <h1>榫卯节点剖切标注工具</h1>
            <p>BVH 实体剖切 · 轮廓吸附标注 · 可分享工作区</p>
          </div>
        </div>
        <div class="toolbar">
          <div class="tool-group">
            <For each={TOOLS}>
              {(tool) => (
                <button
                  class={`tool-btn ${store.state.mode === tool.mode ? 'active' : ''}`}
                  title={tool.hint}
                  onClick={() => store.setMode(tool.mode)}
                >
                  {tool.label}
                </button>
              )}
            </For>
          </div>
          <div class="tool-group">
            <button
              class="tool-btn"
              disabled={!store.state.canUndo}
              title="撤销 (Ctrl+Z)"
              onClick={() => {
                store.undo();
                viewer!.syncPartVisibility();
                viewer!.syncAnnotationViews(store.state.annotations);
                viewer!.rebuildAllSections();
              }}
            >
              撤销
            </button>
            <button
              class="tool-btn"
              disabled={!store.state.canRedo}
              title="重做 (Ctrl+Shift+Z)"
              onClick={() => {
                store.redo();
                viewer!.syncPartVisibility();
                viewer!.syncAnnotationViews(store.state.annotations);
                viewer!.rebuildAllSections();
              }}
            >
              重做
            </button>
          </div>
          <div class="tool-group">
            <button class="tool-btn" onClick={() => exportDoc(store.toSavedDoc())}>
              导出
            </button>
            <button class="tool-btn" onClick={() => fileInputRef?.click()}>
              导入
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) onImportFile(file);
                e.currentTarget.value = '';
              }}
            />
          </div>
        </div>
      </header>

      <main class="workspace">
        <aside class="sidebar">
          <section class="panel">
            <h2>剖切面</h2>
            <p class="panel-hint">拖动视口中彩色手柄或滑块,截面自动重算</p>
            <For each={AXIS_INFO}>
              {(info) => {
                const ps = () => store.state.planes[info.axis];
                return (
                  <div class="plane-card">
                    <div class="plane-head">
                      <span class="dot" style={{ background: info.color }} />
                      <strong>{info.name}</strong>
                      <span class="muted">{info.plane}</span>
                      <div class="spacer" />
                      <label class="switch" title="启用/停用剖切">
                        <input
                          type="checkbox"
                          checked={ps().enabled}
                          onChange={() => {
                            store.togglePlaneEnabled(info.axis);
                            viewer!.rebuildAllSections();
                          }}
                        />
                        <span />
                      </label>
                    </div>
                    <div class="slider-row">
                      <input
                        type="range"
                        min={bounds[AXIS_INFO.indexOf(info)].min}
                        max={bounds[AXIS_INFO.indexOf(info)].max}
                        step={0.005}
                        value={ps().offset}
                        onPointerDown={() => store.beginInteraction()}
                        onInput={(e) => {
                          store.setPlaneOffset(info.axis, parseFloat(e.currentTarget.value));
                          viewer!.rebuildAllSections();
                        }}
                      />
                      <span class="value">{(ps().offset * 1000).toFixed(0)} mm</span>
                    </div>
                    <button
                      class="text-btn"
                      onClick={() => {
                        store.togglePlaneVisible(info.axis);
                        viewer!.rebuildAllSections();
                      }}
                    >
                      {ps().visible ? '隐藏手柄' : '显示手柄'}
                    </button>
                  </div>
                );
              }}
            </For>
          </section>

          <section class="panel">
            <h2>节点构件</h2>
            <p class="panel-hint">隐藏构件后,剖切与标注仅在剩余构件上计算</p>
            <For each={store.state.parts}>
              {(part) => (
                <label class="part-row">
                  <input
                    type="checkbox"
                    checked={part.visible}
                    onChange={() => {
                      store.togglePart(part.id);
                      viewer!.syncPartVisibility();
                    }}
                  />
                  <span
                    class="swatch"
                    style={{ background: `#${part.color.toString(16).padStart(6, '0')}` }}
                  />
                  <span>{part.name}</span>
                </label>
              )}
            </For>
          </section>

          <section class="panel">
            <div class="panel-title-row">
              <h2>尺寸标注</h2>
              <span class="badge">{annotationCount()}</span>
            </div>
            <p class="panel-hint">标注模式下在轮廓附近单击放置,右键单击标注可删除;锚点随剖切自动重吸附</p>
            <button
              class="tool-btn block"
              disabled={annotationCount() === 0}
              onClick={() => {
                store.clearAnnotations();
                viewer!.syncAnnotationViews([]);
              }}
            >
              清空全部标注
            </button>
            <Show when={annotationCount() > 8}>
              <p class="perf-note">标注较多时,拖动采用节流重绘保持流畅</p>
            </Show>
          </section>

          <section class="panel">
            <h2>测量结果</h2>
            <p class="panel-hint">测量模式下在截面单击,数值随剖切位置实时变化</p>
            <div class="measure-list">
              <Show
                when={store.state.measures.length > 0}
                fallback={<p class="muted small">暂无测量记录</p>}
              >
                <For each={store.state.measures}>
                  {(m) => (
                    <div class="measure-row">
                      <span class={`tag ${m.kind}`}>
                        {m.kind === 'tenon-width' ? '榫宽' : '榫深'}
                      </span>
                      <strong>{(m.value * 1000).toFixed(1)} mm</strong>
                      <span class="muted small">{m.detail}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
            <Show when={store.state.measures.length > 0}>
              <button class="text-btn" onClick={() => store.clearMeasures()}>
                清除测量
              </button>
            </Show>
          </section>
        </aside>

        <div class="viewport" ref={containerRef}>
          <div class="viewport-hud">
            <For each={TOOLS.filter((t) => t.mode === store.state.mode)}>
              {(t) => <span>{t.hint}</span>}
            </For>
          </div>
        </div>
      </main>

      <div class={`toast ${toast.visible ? 'show' : ''}`}>{toast.message}</div>
    </div>
  );
}
