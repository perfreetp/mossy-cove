<script lang="ts">
  import { store } from '../store.svelte';
  import { EVIDENCE_LIST, EVIDENCE_META } from '../lib/evidence';
  import { PlanMapBridge } from '../lib/bridge.svelte';

  function togglePlaceMode() {
    store.placeMode = !store.placeMode;
    if (store.placeMode) store.recordMode = false;
  }

  function toggleRecordMode() {
    store.recordMode = !store.recordMode;
    if (store.recordMode) store.placeMode = false;
  }

  function topView() {
    PlanMapBridge.threeManager?.setTopView();
  }

  function frameAll() {
    const m = PlanMapBridge.threeManager;
    const box = m?.clipBox ?? m?.cloudBox;
    if (box) m?.frameBox(box);
  }
</script>

<div class="overlay">
  <div class="mode-group">
    <button class={store.placeMode ? 'active' : ''} onclick={togglePlaceMode} title="在三维中点击点云表面放置证据标记">
      📌 放置证据 {store.placeMode ? '（点云取点中…）' : ''}
    </button>
    <button class={store.recordMode ? 'active' : ''} onclick={toggleRecordMode} title="沿走位依次点击记录路径关键点">
      🧭 记录走位 {store.recordMode ? '（记录中…）' : ''}
    </button>
  </div>

  {#if store.placeMode}
    <div class="type-picker panel">
      <div class="tp-title">证据类型</div>
      <div class="tp-grid">
        {#each EVIDENCE_LIST as meta (meta.type)}
          <button
            class={store.activeMarkerType === meta.type ? 'active tp-btn' : 'tp-btn'}
            style={`--c:${meta.color}`}
            onclick={() => (store.activeMarkerType = meta.type)}
          >
            <span class="swatch" style={`background:${meta.color}`}>{meta.icon}</span>
            {meta.label}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="view-group">
    <button onclick={topView} title="俯视视角，与平面图方向一致">俯视角</button>
    <button onclick={frameAll}>框选全景</button>
  </div>
</div>

{#snippet markerColor(type: keyof typeof EVIDENCE_META)}
  {EVIDENCE_META[type].color}
{/snippet}

<style>
.overlay {
  position: absolute;
  left: 14px;
  top: 14px;
  z-index: 15;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}
.overlay button,
.type-picker {
  pointer-events: auto;
}
.mode-group,
.view-group {
  display: flex;
  gap: 8px;
}
.type-picker {
  padding: 10px;
  width: 250px;
}
.tp-title {
  color: var(--text-300);
  margin-bottom: 8px;
  font-size: 11px;
}
.tp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.tp-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  border-color: var(--line);
}
.tp-btn.active {
  border-color: var(--c);
  box-shadow: inset 0 0 0 1px var(--c);
}
.swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #fff;
  flex: none;
}
</style>
