<script lang="ts">
  import { Vector3 } from 'three';
  import type { TourPath } from '../types';
  import { store } from '../store.svelte';
  import { PlanMapBridge } from '../lib/bridge.svelte';
  import { toastBus } from '../lib/toast.svelte';
  import EvidenceTab from './EvidenceTab.svelte';
  import PathSelector from './PathSelector.svelte';

  let { onCollapse }: { onCollapse: () => void } = $props();
  let tab = $state<'evidence' | 'path'>('evidence');

  const path = $derived(store.activePath);

  async function play() {
    const m = PlanMapBridge.threeManager;
    if (!m || !path || path.points.length < 2) {
      toastBus.show('至少需要 2 个关键点才能漫游', 'info');
      return;
    }
    store.touring = true;
    toastBus.info('开始沿路径漫游，相机自动朝向路径前方');
    try {
      await m.playTour(path as TourPath);
      toastBus.success('漫游结束');
    } finally {
      store.touring = false;
    }
  }

  function stop() {
    PlanMapBridge.threeManager?.stopTour();
    store.touring = false;
  }

  function flyToPoint(id: string) {
    const kp = path?.points.find((p) => p.id === id);
    if (!kp) return;
    PlanMapBridge.threeManager?.flyTo(
      new Vector3(kp.position.x, kp.position.y, kp.position.z),
      { duration: 0.7 }
    );
  }
</script>

<aside class="side panel">
  <div class="side-head">
    <div class="tabs">
      <button class={tab === 'evidence' ? 'active' : ''} onclick={() => (tab = 'evidence')}>
        证据标记（{store.markers.length}）
      </button>
      <button class={tab === 'path' ? 'active' : ''} onclick={() => (tab = 'path')}>
        漫游路径
      </button>
    </div>
    <button class="ghost" onclick={onCollapse} title="收起侧栏">✕</button>
  </div>

  {#if tab === 'evidence'}
    <EvidenceTab />
  {:else}
    <div class="path-tab">
      <PathSelector />
      {#if path}
        <div class="section">
          <div class="row">
            <span class="label">巡航速度</span>
            <input
              type="range"
              min="0.5"
              max="20"
              step="0.5"
              value={path.speed}
              oninput={(e) => store.setPathSpeed(Number((e.currentTarget as HTMLInputElement).value))}
            />
            <span class="muted">{path.speed} 单位/秒</span>
          </div>
          <div class="row">
            <button class="primary" onclick={play} disabled={store.touring || path.points.length < 2}>
              ▶ 开始漫游
            </button>
            <button class="danger" onclick={stop} disabled={!store.touring}>■ 停止</button>
            <button onclick={() => store.undoPath()} disabled={!store.pathCanUndo}>↶</button>
            <button onclick={() => store.redoPath()} disabled={!store.pathCanRedo}>↷</button>
          </div>
          <p class="muted tip">
            关键点 {path.points.length} 个。可在三维或平面图中拖动调整位置，也可在下方列表删除。
          </p>
        </div>
        <div class="kp-list">
          {#each path.points as kp, i (kp.id)}
            <div class="kp-item">
              <span class="kp-index">{i + 1}</span>
              <div class="kp-coords">
                X {kp.position.x.toFixed(2)} · Y {kp.position.y.toFixed(2)} · Z {kp.position.z.toFixed(2)}
              </div>
              <button class="ghost small" onclick={() => flyToPoint(kp.id)}>定位</button>
              <button class="ghost danger small" onclick={() => store.removePathPoint(kp.id)}>删</button>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty">
          尚无路径。开启「记录走位」后在三维视口点击，或用下方按钮在当前视角目标处添加关键点。
        </div>
      {/if}
    </div>
  {/if}
</aside>

<style>
.side {
  width: 340px;
  height: 100%;
  border-radius: 0;
  border-right: none;
  border-top: none;
  border-bottom: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  gap: 8px;
  border-bottom: 1px solid var(--line);
}
.tabs {
  display: flex;
  gap: 6px;
  flex: 1;
}
.tabs button {
  flex: 1;
}
.path-tab {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.tip {
  font-size: 11px;
  margin: 8px 0 0;
  line-height: 1.5;
}
.kp-list {
  overflow-y: auto;
  flex: 1;
  padding: 6px 10px 12px;
}
.kp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid var(--line);
  border-radius: 7px;
  margin-bottom: 6px;
  background: var(--bg-800);
}
.kp-index {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--warn);
  color: #1f2937;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  font-size: 11px;
}
.kp-coords {
  flex: 1;
  font-size: 11px;
  color: var(--text-300);
  font-variant-numeric: tabular-nums;
}
.small {
  padding: 3px 8px;
  font-size: 11px;
}
.empty {
  padding: 24px 16px;
  color: var(--text-500);
  line-height: 1.7;
  font-size: 12px;
}
</style>
