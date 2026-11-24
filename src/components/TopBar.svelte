<script lang="ts">
  import type { ModuleId } from '../lib/types';
  import { store } from '../lib/store.svelte';
  import { RISER_LIMIT } from '../lib/types';

  let {
    modules
  }: { modules: Array<{ id: ModuleId; label: string; icon: string }> } = $props();

  let thresholdDraft = $state(store.imbalanceThreshold);
  $effect(() => {
    thresholdDraft = store.imbalanceThreshold;
  });

  function commitThreshold() {
    store.imbalanceThreshold = clampNum(thresholdDraft, 0.02, 1);
  }

  function clampNum(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
  }
</script>

<header class="topbar">
  <div class="brand">
    浇冒口工艺设计台
    <small>Gating & Riser Designer</small>
  </div>

  <nav class="module-tabs">
    {#each modules as mod (mod.id)}
      <button
        class={store.module === mod.id ? 'active' : ''}
        onclick={() => store.setModule(mod.id)}
      >
        <span style="margin-right:5px">{mod.icon}</span>{mod.label}
      </button>
    {/each}
  </nav>

  <div class="row grow" style="justify-content:flex-end; gap:18px">
    <label class="checkline" style="margin:0" title="拖动节点时自动对齐到邻近浇道端点">
      <input
        type="checkbox"
        bind:checked={store.snapEnabled}
      />
      吸附
    </label>

    <label class="row" style="margin:0; gap:8px" title="分叉比例偏离均衡超过该值时节点变红">
      <span class="muted">失衡阈值</span>
      <input
        type="number"
        min="0.02"
        max="1"
        step="0.01"
        style="width:74px"
        bind:value={thresholdDraft}
        onchange={commitThreshold}
      />
      <span class="muted">{Math.round(store.imbalanceThreshold * 100)}%</span>
    </label>

    <span class="tag" class:l1={true}>冒口 {store.risers.length}/{RISER_LIMIT}</span>

    <div class="row">
      <button disabled={!store.canUndo} onclick={() => store.undo()} title="撤销 (Ctrl+Z)">↶ 撤销</button>
      <button disabled={!store.canRedo} onclick={() => store.redo()} title="重做 (Ctrl+Y)">↷ 重做</button>
    </div>
  </div>
</header>
