<script lang="ts">
  import { store } from '../store.svelte';
  import { estimateStorage } from '../lib/db';
  import { PlanMapBridge } from '../lib/bridge.svelte';

  let usage = $state('—');
  let quota = $state('—');
  let pointCount = $state('—');
  // 直接读 $state 字段建立响应式，避免类 getter 的依赖追踪在模板中失效
  const keyPointCount = $derived.by(() => {
    const id = store.activePathId;
    const list = store.paths;
    const p = list.find((x) => x.id === id) ?? list[0];
    return p ? p.points.length : 0;
  });

  async function refresh() {
    const est = await estimateStorage();
    if (est) {
      usage = `${(est.usage / 1024 / 1024).toFixed(1)} MB`;
      quota = `${(est.quota / 1024 / 1024).toFixed(0)} MB`;
    }
    const pco = PlanMapBridge.threeManager?.clouds?.[0] as
      | { pcoGeometry?: { numPoints?: number } }
      | undefined;
    if (pco?.pcoGeometry?.numPoints) pointCount = pco.pcoGeometry.numPoints.toLocaleString();
  }
  refresh();
  setInterval(refresh, 3000);
</script>

<footer class="status-bar">
  <div class="item">
    <span class="k">点云：</span>
    {store.cloudRecord ? store.cloudRecord.name : '未加载'}
  </div>
  {#if store.cloudLoading}
    <div class="item">加载中 {Math.round(store.cloudProgress * 100)}%</div>
  {/if}
  {#if store.cloudError}
    <div class="item error">错误：{store.cloudError}</div>
  {/if}
  <div class="item"><span class="k">点规模：</span>{pointCount}</div>
  <div class="item"><span class="k">裁剪：</span>{store.clipBox ? '已启用' : '未启用'}</div>
  <div class="item"><span class="k">标记：</span>{store.markers.length}</div>
  <div class="item"><span class="k">关键点：</span>{keyPointCount}</div>
  {#if store.touring}<div class="item touring">● 漫游中</div>{/if}
  <div class="spacer"></div>
  <div class="item muted">本地存储 {usage} / 配额 {quota}</div>
</footer>

<style>
.status-bar {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 5px 16px;
  background: #0d1729;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--text-300);
  overflow: hidden;
  white-space: nowrap;
}
.item {
  display: flex;
  align-items: center;
}
.k {
  color: var(--text-500);
}
.error {
  color: var(--danger);
}
.touring {
  color: var(--warn);
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.muted {
  color: var(--text-500);
}
</style>
