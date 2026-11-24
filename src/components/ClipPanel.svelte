<script lang="ts">
  import { onMount } from 'svelte';
  import { Box3, Vector3 } from 'three';
  import { store, jsonToBox3 } from '../store.svelte';
  import { PlanMapBridge } from '../lib/bridge.svelte';
  import { toastBus } from '../lib/toast.svelte';

  // 本地草稿：输入过程中不立刻写历史，点“应用”才产生一条撤销记录
  let draft = $state<{ min: Vector3; max: Vector3 } | null>(null);
  let open = $state(false);
  let cloudTick = $state(0);

  onMount(() => PlanMapBridge.onCloudReady(() => cloudTick++));

  $effect(() => {
    // 响应式依赖：裁剪盒、点云记录、点云就绪信号
    void store.clipBox;
    void store.cloudRecord;
    void cloudTick;
    const box = jsonToBox3(store.clipBox);
    if (box) {
      draft = { min: box.min.clone(), max: box.max.clone() };
      return;
    }
    const existing = PlanMapBridge.threeManager?.cloudBox;
    draft = existing ? { min: existing.min.clone(), max: existing.max.clone() } : null;
  });

  function applyClip() {
    if (!draft) return;
    const b = new Box3(draft.min.clone(), draft.max.clone());
    if (b.isEmpty()) {
      toastBus.error('裁剪范围无效：min 必须小于 max');
      return;
    }
    store.setClipBox(b);
    toastBus.success('已应用包围盒裁剪，无关区域已剔除');
  }

  function resetClip() {
    store.setClipBox(null);
    toastBus.info('已取消裁剪');
  }

  /** 按比例收紧/扩张裁剪盒（每轴） */
  function shrink(factor: number) {
    const src = jsonToBox3(store.clipBox) ?? PlanMapBridge.threeManager?.cloudBox;
    if (!src) return;
    const center = src.getCenter(new Vector3());
    const size = src.getSize(new Vector3()).multiplyScalar(factor / 2);
    const b = new Box3(center.clone().sub(size), center.clone().add(size));
    draft = { min: b.min, max: b.max };
    store.setClipBox(b);
  }

  const axes = ['x', 'y', 'z'] as const;
</script>

<div class="clip-panel panel">
  <div class="clip-head" role="button" tabindex="0" onclick={() => (open = !open)} onkeydown={(e) => e.key === 'Enter' && (open = !open)}>
    <h3>✂ 包围盒裁剪 {#if store.clipBox}<span class="on">已裁剪</span>{/if}</h3>
    <span class="chev">{open ? '▾' : '▸'}</span>
  </div>
  {#if open}
    {#if !store.cloudRecord}
      <div class="muted pad">加载点云后可设置裁剪范围</div>
    {:else if draft}
      <div class="pad">
        <div class="grid3">
          <span></span><span class="axis">X</span><span class="axis">Y</span><span class="axis">Z</span>
          <span class="lbl">最小</span>
          {#each axes as ax}
            <input
              class="num-input"
              type="number"
              step="0.1"
              bind:value={draft.min[ax]}
            />
          {/each}
          <span class="lbl">最大</span>
          {#each axes as ax}
            <input
              class="num-input"
              type="number"
              step="0.1"
              bind:value={draft.max[ax]}
            />
          {/each}
        </div>
        <div class="row btns">
          <button class="primary" onclick={applyClip}>应用裁剪</button>
          <button onclick={() => shrink(0.5)} title="以中心为基准收窄一半">收窄50%</button>
          <button onclick={() => shrink(2)}>扩大2倍</button>
          <button class="danger" onclick={resetClip} disabled={!store.clipBox}>重置</button>
        </div>
        <div class="row undo-row">
          <button onclick={() => store.undoClip()} disabled={!store.clipCanUndo}>↶ 撤销</button>
          <button onclick={() => store.redoClip()} disabled={!store.clipCanRedo}>↷ 重做</button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
.clip-panel {
  position: absolute;
  right: 14px;
  top: 14px;
  width: 330px;
  z-index: 20;
}
.clip-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 12px;
  cursor: pointer;
  user-select: none;
}
.clip-head h3 {
  margin: 0;
}
.on {
  color: var(--ok);
  font-size: 11px;
  margin-left: 6px;
}
.chev {
  color: var(--text-500);
}
.pad {
  padding: 0 12px 12px;
}
.muted.pad {
  padding: 0 12px 12px;
}
.grid3 {
  display: grid;
  grid-template-columns: 40px repeat(3, 1fr);
  gap: 6px;
  align-items: center;
}
.axis {
  text-align: center;
  color: var(--accent);
  font-weight: 600;
}
.lbl {
  color: var(--text-300);
}
.btns {
  margin-top: 10px;
}
.undo-row {
  margin-top: 6px;
}
</style>
