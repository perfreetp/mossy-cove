<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { FossilViewer } from '../lib/fossil-viewer';
  import { appState, requestInteractiveSection, refreshAllSections, addMeasurement, dismissLoadError } from '../lib/app-state.svelte';
  import type { AxisName } from '../lib/types';
  import type { Vec3 } from '../lib/math';

  let container: HTMLDivElement;
  let viewer: FossilViewer | null = null;
  let lastModelInfo: unknown = null;
  /** 每个平面已渲染的截面 id,避免未变化时重建几何 */
  const renderedSectionId = new Map<AxisName, number | null>();
  const AXES: AxisName[] = ['x', 'y', 'z'];

  onMount(() => {
    viewer = new FossilViewer(container, appState.planes, {
      onPlaneDrag: (axis: AxisName) => {
        // 拖动中按帧请求;调度器内部做同平面合并与过时丢弃
        void requestInteractiveSection(axis);
      },
      onMeasure: (m) => addMeasurement(m),
      onHover: (hint) => { appState.hoverHint = hint; }
    });
    viewer.angleLock = appState.angleLock;
    viewer.snapDegrees = appState.snapDegrees;
  });

  // 仅在"换了一个模型"时重建 three 几何
  $effect(() => {
    const info = appState.modelInfo;
    const mesh = appState.lastMesh;
    if (!viewer || !info || !mesh || info === lastModelInfo) return;
    lastModelInfo = info;
    viewer.setModel(
      new Float32Array(mesh.vertices),
      new Uint32Array(mesh.indices),
      info.bounds
    );
    viewer.syncPlanes(appState.planes);
    refreshAllSections();
  });

  // 平面开关/隐藏/颜色/位姿变化 → 同步 Gizmo、裁剪与可见性(不重建截面几何)
  $effect(() => {
    if (!viewer) return;
    const planes = appState.planes;
    // 显式订阅各平面字段
    for (const axis of AXES) {
      const p = planes[axis];
      void p.point; void p.normal; void p.enabled; void p.hidden;
      void p.fillColor; void p.lineColor;
    }
    viewer.syncPlanes(planes);
    for (const axis of AXES) {
      const p = planes[axis];
      viewer.setSectionVisible(axis, p.enabled && !p.hidden);
      viewer.updateSectionStyle?.(axis, p.fillColor, p.lineColor);
    }
  });

  // 截面计算结果变化 → 仅重建 id 变化的那个平面,拖动单平面不影响其他平面
  $effect(() => {
    if (!viewer) return;
    for (const axis of AXES) {
      const r = appState.liveSections[axis];
      const id = r ? r.id : null;
      if (renderedSectionId.get(axis) !== id) {
        renderedSectionId.set(axis, id);
        viewer.updateSection(axis, r);
      }
      viewer.setSectionVisible(axis, appState.planes[axis].enabled && !appState.planes[axis].hidden);
    }
  });

  $effect(() => {
    if (!viewer) return;
    viewer.angleLock = appState.angleLock;
    viewer.snapDegrees = appState.snapDegrees;
  });

  $effect(() => {
    viewer?.setMeasureMode(appState.measureMode);
  });

  onDestroy(() => viewer?.dispose());

  export function snapshot() {
    return viewer?.snapshot() ?? '';
  }
  export function fitView() {
    viewer?.fitView();
  }
  export function clearMarks() {
    viewer?.clearMeasurements();
  }
</script>

<div class="viewport" bind:this={container}>
  {#if appState.loading}
    <div class="loading-mask">
      <div class="spinner"></div>
      <div class="muted">正在解析模型并构建实体几何…</div>
    </div>
  {/if}
  {#if appState.loadError}
    <button type="button" class="toast" onclick={dismissLoadError}>{appState.loadError}(点击关闭)</button>
  {/if}
  <div class="hint-overlay">
    {appState.hoverHint || '拖动平面手柄平移 · 拖动圆环旋转 · 左键空白旋转视角 · 滚轮缩放 · 右键平移'}
  </div>
</div>

<style>
  .viewport { width: 100%; height: 100%; position: relative; }
  .viewport :global(canvas) { display: block; }
</style>
