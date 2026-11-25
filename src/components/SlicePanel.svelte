<script lang="ts">
  import { appState, runBatchSlice } from '../lib/app-state.svelte';
  import { drawSection, sectionToPng, downloadDataUrl, downloadBlob, contoursToJson, contoursToTxt } from '../lib/section-draw';
  import type { SectionResult } from '../lib/types';

  let thumbCanvases = $state<HTMLCanvasElement[]>([]);
  let previewCanvas = $state<HTMLCanvasElement | undefined>(undefined);

  // 缩略图渲染:结果或选中项变化时重画
  $effect(() => {
    const results = appState.batchResults;
    if (!results.length) return;
    queueMicrotask(() => {
      results.forEach((r, i) => {
        const c = thumbCanvases[i];
        if (c) drawThumb(c, r);
      });
      drawPreview();
    });
  });

  $effect(() => {
    appState.batchIndex;
    if (appState.batchResults.length) queueMicrotask(drawPreview);
  });

  function drawThumb(c: HTMLCanvasElement, r: SectionResult) {
    const state = appState.planes[appState.slice.axis];
    drawSection(c, r, {
      width: 160, height: 160,
      fillColor: state.fillColor, lineColor: state.lineColor, holeFillColor: '#10141b'
    });
  }

  function drawPreview() {
    const r = appState.batchResults[appState.batchIndex];
    if (!previewCanvas || !r) return;
    const state = appState.planes[appState.slice.axis];
    drawSection(previewCanvas, r, {
      width: 560, height: 420,
      fillColor: state.fillColor, lineColor: state.lineColor, holeFillColor: '#10141b',
      showGrid: true,
      title: `切片 ${appState.batchIndex + 1} / ${appState.batchResults.length}`
    });
  }

  function selectSlice(i: number) {
    appState.batchIndex = i;
  }
  function page(d: number) {
    const n = appState.batchResults.length;
    appState.batchIndex = Math.min(n - 1, Math.max(0, appState.batchIndex + d));
  }

  function exportPng() {
    const r = current();
    if (!r) return;
    const state = appState.planes[appState.slice.axis];
    const url = sectionToPng(r, state.fillColor, state.lineColor, 1024);
    downloadDataUrl(url, `section-${appState.slice.axis}-${appState.batchIndex + 1}.png`);
  }
  function exportJson() {
    const r = current();
    if (!r) return;
    downloadBlob(
      contoursToJson(r, `${appState.slice.axis}-${appState.batchIndex + 1}`),
      `section-${appState.slice.axis}-${appState.batchIndex + 1}.json`,
      'application/json'
    );
  }
  function exportTxt() {
    const r = current();
    if (!r) return;
    downloadBlob(
      contoursToTxt(r, `${appState.slice.axis}-${appState.batchIndex + 1}`),
      `section-${appState.slice.axis}-${appState.batchIndex + 1}.txt`,
      'text/plain'
    );
  }
  function exportAllJson() {
    const all = appState.batchResults.map((r, i) => ({
      index: i,
      point: r.point, normal: r.normal, totalArea: r.totalArea,
      contours: r.contours.map(c => ({
        isHole: c.isHole, area: c.area, points2d: c.points2d, points3d: c.points3d
      }))
    }));
    downloadBlob(JSON.stringify({ axis: appState.slice.axis, slices: all }, null, 2),
      `sections-${appState.slice.axis}-all.json`, 'application/json');
  }

  function current(): SectionResult | null {
    return appState.batchResults[appState.batchIndex] ?? null;
  }
</script>

<div class="card">
  <h2>切片序列</h2>
  <div class="row">
    <span class="muted" style="min-width:56px">方向</span>
    <select bind:value={appState.slice.axis} class="grow">
      <option value="x">X 平面法向</option>
      <option value="y">Y 平面法向</option>
      <option value="z">Z 平面法向</option>
    </select>
  </div>
  <div class="row">
    <span class="muted" style="min-width:56px">数量</span>
    <input class="grow" type="number" min="2" max="40" bind:value={appState.slice.count} />
    <span class="muted">张(2–40)</span>
  </div>
  <div class="row">
    <span class="muted" style="min-width:56px">范围</span>
    <input type="number" step="0.05" min="-1" max="1" bind:value={appState.slice.startOffset} style="width:70px" />
    <span class="muted">→</span>
    <input type="number" step="0.05" min="-1" max="1" bind:value={appState.slice.endOffset} style="width:70px" />
    <span class="muted">归一化</span>
  </div>
  <div class="row">
    <button class="grow primary" onclick={() => void runBatchSlice()} disabled={!appState.modelInfo || appState.batchBusy}>
      {appState.batchBusy ? '计算中…' : `生成 ${appState.slice.count} 张序列截面`}
    </button>
  </div>
  {#if appState.batchResults.length}
    <div class="muted" style="font-size:11px">
      共 {appState.batchResults.length} 张 · 总耗时 {appState.batchElapsedMs.toFixed(0)}ms
    </div>
  {/if}
</div>

{#if appState.batchResults.length}
  <div class="card">
    <h2>截面浏览({appState.batchIndex + 1}/{appState.batchResults.length})</h2>
    <div class="preview-canvas-wrap">
      <canvas bind:this={previewCanvas}></canvas>
    </div>
    <div class="pager" style="margin-top:8px">
      <button onclick={() => page(-1)} disabled={appState.batchIndex === 0}>‹ 上一张</button>
      <span class="pos muted mono">{appState.batchIndex + 1} / {appState.batchResults.length}</span>
      <button onclick={() => page(1)} disabled={appState.batchIndex === appState.batchResults.length - 1}>下一张 ›</button>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="grow" onclick={exportPng}>导出图片</button>
      <button class="grow" onclick={exportJson}>坐标 JSON</button>
      <button class="grow" onclick={exportTxt}>坐标 TXT</button>
    </div>
    <div class="row">
      <button class="grow" onclick={exportAllJson}>整组坐标导出</button>
    </div>
  </div>

  <div class="card">
    <h2>全部缩略图</h2>
    <div class="slice-grid">
      {#each appState.batchResults as r, i (r.id)}
        <button
          type="button"
          class="slice-cell {i === appState.batchIndex ? 'active' : ''}"
          onclick={() => selectSlice(i)}
        >
          <canvas bind:this={thumbCanvases[i]}></canvas>
          <div class="cap">#{i + 1} · A={r.totalArea.toFixed(3)}</div>
        </button>
      {/each}
    </div>
  </div>
{/if}
