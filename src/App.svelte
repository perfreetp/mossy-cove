<script lang="ts">
  import Viewport3D from './components/Viewport3D.svelte';
  import ImportPanel from './components/ImportPanel.svelte';
  import PlaneControlCard from './components/PlaneControlCard.svelte';
  import SlicePanel from './components/SlicePanel.svelte';
  import MeasurePanel from './components/MeasurePanel.svelte';
  import SchemePanel from './components/SchemePanel.svelte';
  import { appState, refreshAllSections } from './lib/app-state.svelte';
  import { sectionToPng, downloadDataUrl, contoursToJson, contoursToTxt, downloadBlob } from './lib/section-draw';
  import type { AxisName } from './lib/types';

  let viewport: Viewport3D;

  function toggleLock() {
    appState.angleLock = !appState.angleLock;
  }

  function exportView() {
    const url = viewport.snapshot();
    if (url) downloadDataUrl(url, `fossil-view-${Date.now()}.png`);
  }

  function exportCurrentSection(axis: AxisName, kind: 'png' | 'json' | 'txt') {
    const r = appState.liveSections[axis];
    if (!r) return;
    const state = appState.planes[axis];
    if (kind === 'png') {
      downloadDataUrl(sectionToPng(r, state.fillColor, state.lineColor), `section-${axis}.png`);
    } else if (kind === 'json') {
      downloadBlob(contoursToJson(r, axis), `section-${axis}.json`, 'application/json');
    } else {
      downloadBlob(contoursToTxt(r, axis), `section-${axis}.txt`, 'text/plain');
    }
  }
</script>

<div class="app-shell">
  <header class="topbar">
    <h1>化石内部结构剖面查看工具</h1>
    <span class="status-chip {appState.modelInfo ? 'on' : ''}">
      {appState.modelInfo ? '实体已就绪' : '未加载模型'}
    </span>
    <span class="spacer"></span>

    <span style="display:flex; align-items:center; gap:6px; cursor:pointer">
      <input type="checkbox" checked={appState.angleLock} onchange={toggleLock} id="angle-lock" />
      <label for="angle-lock" style="cursor:pointer">角度锁定({appState.snapDegrees}°吸附)</label>
    </span>
    <input
      type="number" min="5" max="90" step="5" style="width:64px"
      bind:value={appState.snapDegrees} title="吸附步长(度)"
    />

    <button onclick={() => viewport.fitView()} disabled={!appState.modelInfo}>适配视图</button>
    <button onclick={exportView} disabled={!appState.modelInfo}>导出3D截图</button>
  </header>

  <aside class="left-panel">
    <ImportPanel />

    <div class="card">
      <h2>剖切平面</h2>
      <PlaneControlCard axis="x" label="X 平面(YZ)" />
      <PlaneControlCard axis="y" label="Y 平面(XZ)" />
      <PlaneControlCard axis="z" label="Z 平面(XY)" />
      <div class="row" style="margin-top:6px">
        <button class="grow" onclick={refreshAllSections} disabled={!appState.modelInfo}>重算全部截面</button>
      </div>
      <div class="muted mono" style="font-size:11px; margin-top:6px">
        上次交互计算耗时 {appState.lastComputeMs.toFixed(1)} ms
      </div>
    </div>

    <div class="card">
      <h2>当前截面导出</h2>
      {#each ['x', 'y', 'z'] as axis}
        <div class="row">
          <span class="muted" style="min-width:48px">{axis.toUpperCase()}</span>
          <button class="grow" disabled={!appState.liveSections[axis as AxisName]}
            onclick={() => exportCurrentSection(axis as AxisName, 'png')}>图片</button>
          <button class="grow" disabled={!appState.liveSections[axis as AxisName]}
            onclick={() => exportCurrentSection(axis as AxisName, 'json')}>JSON</button>
          <button class="grow" disabled={!appState.liveSections[axis as AxisName]}
            onclick={() => exportCurrentSection(axis as AxisName, 'txt')}>TXT</button>
        </div>
      {/each}
    </div>

    <SchemePanel />
  </aside>

  <main class="center-area">
    <Viewport3D bind:this={viewport} />
  </main>

  <aside class="right-panel">
    <MeasurePanel {viewport} />
    <SlicePanel />
  </aside>
</div>
