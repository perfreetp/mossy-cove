<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Vector3 } from 'three';
  import { store } from '../store.svelte';
  import { PlanMapManager } from '../lib/plan-map-manager';
  import { PlanMapBridge } from '../lib/bridge.svelte';
  import { toastBus } from '../lib/toast.svelte';

  let canvas = $state<HTMLCanvasElement>();
  let manager: PlanMapManager | null = null;
  let collapsed = $state(false);

  onMount(() => {
    if (!canvas) return;
    manager = new PlanMapManager(canvas, {
      onLocate: (x, z) => PlanMapBridge.onLocate?.(x, z),
      onMarkerClick: (id) => {
        const m = store.markers.find((x2) => x2.id === id);
        if (m) {
          PlanMapBridge.threeManager?.focusMarker(id);
          toastBus.info(`定位到标记 #${m.seq}`);
        }
      },
      onMarkerDrag: (id, x, z) => {
        const m = store.markers.find((x2) => x2.id === id);
        if (!m) return;
        // 平面图拖动只改 XZ，保持原高度
        store.updateMarkerPosition(id, { x, y: m.position.y, z });
      },
      onPathPointClick: (id) => {
        const path = store.activePath;
        const kp = path?.points.find((p) => p.id === id);
        if (kp) {
          PlanMapBridge.threeManager?.flyTo(new Vector3(kp.position.x, kp.position.y, kp.position.z), {
            duration: 0.8
          });
        }
      },
      onPathPointDrag: (id, x, z) => {
        const path = store.activePath;
        const kp = path?.points.find((p) => p.id === id);
        if (!kp) return;
        store.updatePathPoint(id, { x, y: kp.position.y, z });
      }
    });
    PlanMapBridge.attachMap(manager);

    const ro = new ResizeObserver(() => {
      manager?.resize();
      manager?.draw();
    });
    if (canvas) ro.observe(canvas);
    return () => ro.disconnect();
  });

  onDestroy(() => {
    manager?.dispose();
    PlanMapBridge.detach();
  });
</script>

<div class="map-panel panel" class:collapsed>
  <div class="map-header">
    <h3>现场俯视平面图</h3>
    <div class="map-tools">
      <button class="ghost small" onclick={() => manager?.fitView()} title="重置视图">⛶ 适配</button>
      <button class="ghost small" onclick={() => (collapsed = !collapsed)}>
        {collapsed ? '展开' : '收起'}
      </button>
    </div>
  </div>
  {#if !collapsed}
    <div class="canvas-wrap">
      <canvas bind:this={canvas}></canvas>
      <div class="hint">
        单击空白处三维定位 · 滚轮缩放 · Shift+拖动平移 · 拖动标记/路径点改位
      </div>
      <div class="legend">
        <span><i class="cam"></i>相机位置/朝向</span>
        <span><i class="mk"></i>证据标记投影</span>
        <span><i class="pp"></i>路径关键点</span>
      </div>
    </div>
  {/if}
</div>

<style>
.map-panel {
  position: absolute;
  left: 14px;
  bottom: 14px;
  width: 380px;
  z-index: 20;
  overflow: hidden;
}
.map-panel.collapsed {
  width: 170px;
}
.map-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 4px;
}
.map-header h3 {
  margin: 0;
}
.map-tools {
  display: flex;
  gap: 6px;
}
.small {
  padding: 3px 8px;
  font-size: 11px;
}
.canvas-wrap {
  position: relative;
  padding: 0 10px 10px;
}
canvas {
  width: 100%;
  height: 300px;
  border-radius: 8px;
  border: 1px solid var(--line);
  display: block;
  touch-action: none;
}
.hint {
  margin-top: 6px;
  color: var(--text-500);
  font-size: 11px;
  line-height: 1.5;
}
.legend {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-300);
  flex-wrap: wrap;
}
.legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: -1px;
}
.cam {
  background: #38bdf8;
}
.mk {
  background: #e23b3b;
}
.pp {
  background: #f59e0b;
  border-radius: 2px !important;
}
</style>
