<script lang="ts">
  import { appState, clearMeasurements } from '../lib/app-state.svelte';

  interface ViewportHandle {
    clearMarks: () => void;
  }
  let { viewport }: { viewport: ViewportHandle } = $props();

  function setMode(mode: 'off' | 'distance' | 'area') {
    appState.measureMode = appState.measureMode === mode ? 'off' : mode;
  }
</script>

<div class="card">
  <h2>截面测量</h2>
  <div class="row">
    <button
      class="grow" class:toggled={appState.measureMode === 'distance'}
      onclick={() => setMode('distance')}
    >两点距离</button>
    <button
      class="grow" class:toggled={appState.measureMode === 'area'}
      onclick={() => setMode('area')}
    >轮廓面积</button>
  </div>
  <p class="muted" style="font-size:11px; margin:6px 0 10px; line-height:1.5">
    {#if appState.measureMode === 'distance'}
      在截面上依次点选两个点,自动给出空间直线距离。
    {:else if appState.measureMode === 'area'}
      点选任一闭合轮廓(外轮廓或孔),给出其包围面积。
    {:else}
      先启用剖切平面生成截面,再选择测量方式。
    {/if}
  </p>

  {#if appState.measurements.length}
    <div class="row">
      <button class="grow danger" onclick={() => { clearMeasurements(); viewport.clearMarks(); }}>清空测量</button>
    </div>
    {#each appState.measurements as m (m.id)}
      <div class="measure-item">
        <div style="display:flex; justify-content:space-between">
          <strong>{m.kind === 'distance' ? '距离测量' : (m.label.includes('孔') ? '孔面积' : '轮廓面积')}</strong>
          <span class="muted">{m.plane.toUpperCase()} 平面</span>
        </div>
        {#if m.kind === 'distance'}
          <div class="mono" style="margin-top:4px">d = {m.distance?.toFixed(5)}</div>
        {:else}
          <div class="mono" style="margin-top:4px">A = {m.area?.toFixed(5)}</div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
