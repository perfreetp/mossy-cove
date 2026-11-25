<script lang="ts">
  import { appState, requestInteractiveSection, planeOffset, setPlaneOffset } from '../lib/app-state.svelte';
  import type { AxisName } from '../lib/types';

  let { axis, label }: { axis: AxisName; label: string } = $props();

  const colorMap = { x: '#ff5a5f', y: '#4cc38a', z: '#4d96ff' };

  function toggleEnabled() {
    const p = appState.planes[axis];
    p.enabled = !p.enabled;
    void requestInteractiveSection(axis);
  }
  function toggleHidden() {
    const p = appState.planes[axis];
    p.hidden = !p.hidden;
    void requestInteractiveSection(axis);
  }
  function onOffset(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    setPlaneOffset(axis, v);
  }
  function resetOffset() {
    setPlaneOffset(axis, 0);
  }
</script>

<div class="plane-block">
  <div class="plane-head">
    <span class="dot" style="background:{colorMap[axis]}; width:10px; height:10px; border-radius:50%; display:inline-block"></span>
    <span class="name">{label}</span>
    <span class="spacer"></span>
    <span class="status-chip {appState.planes[axis].enabled ? 'on' : ''}">
      {appState.planes[axis].enabled ? '启用' : '关闭'}
    </span>
  </div>

  <div class="row">
    <label for={`en-${axis}`}>剖切</label>
    <div class="switch">
      <input type="checkbox" checked={appState.planes[axis].enabled} onchange={toggleEnabled} id={`en-${axis}`} />
      <button type="button" class="track" onclick={toggleEnabled} aria-label="切换剖切启用"></button>
    </div>
    <label for={`hd-${axis}`} style="min-width:auto">隐藏截面</label>
    <div class="switch">
      <input type="checkbox" checked={appState.planes[axis].hidden} onchange={toggleHidden} id={`hd-${axis}`} />
      <button type="button" class="track" onclick={toggleHidden} aria-label="切换截面隐藏"></button>
    </div>
  </div>

  <div class="row">
    <label for={`off-${axis}`}>法向偏移</label>
    <input
      id={`off-${axis}`}
      class="grow" type="range" min="-1" max="1" step="0.005"
      value={planeOffset(axis)} oninput={onOffset}
      disabled={!appState.planes[axis].enabled}
    />
    <button style="padding:3px 8px" onclick={resetOffset} title="回到模型中心">居中</button>
  </div>

  <div class="row">
    <span class="muted" style="min-width:56px">法向量</span>
    <span class="mono muted grow">
      [{appState.planes[axis].normal.map(v => v.toFixed(2)).join(', ')}]
    </span>
  </div>

  <div class="row">
    <span class="muted" style="min-width:56px">填充色</span>
    <input type="color" bind:value={appState.planes[axis].fillColor} aria-label="填充颜色" />
    <span class="muted" style="min-width:auto">线色</span>
    <input type="color" bind:value={appState.planes[axis].lineColor} aria-label="轮廓线颜色" />
  </div>

  {#if appState.liveSections[axis]}
    {@const s = appState.liveSections[axis]!}
    <div class="row mono muted" style="font-size:11px">
      轮廓 {s.contours.length} · 面积 {s.totalArea.toFixed(4)} · 耗时 {s.elapsedMs.toFixed(1)}ms
    </div>
  {/if}
</div>
