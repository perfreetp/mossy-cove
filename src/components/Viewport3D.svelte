<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Vector3 } from 'three';
  import { store, jsonToBox3 } from '../store.svelte';
  import { ThreeSceneManager } from '../lib/three-manager';
  import { PlanMapBridge } from '../lib/bridge.svelte';
  import { toastBus } from '../lib/toast.svelte';
  import ClipPanel from './ClipPanel.svelte';
  import ViewportOverlay from './ViewportOverlay.svelte';

  let container: HTMLDivElement;
  let manager: ThreeSceneManager | null = null;
  let managerReady = $state(false);
  let loadToken = 0;

  // 标记/路径与三维对象的同步（store 变化 -> 三维）
  let markerSnapshot = $state('');
  let pathSnapshot = $state('');
  let clipSnapshot = $state('');
  onMount(() => {
    manager = new ThreeSceneManager(container);
    managerReady = true;

    manager.onProgress = (p) => {
      store.cloudProgress = p;
    };

    manager.onCameraChange = (pos, dir) => {
      PlanMapBridge.updateCamera(pos, dir);
    };

    manager.onMarkerMoved = (id, pos) => {
      store.updateMarkerPosition(id, { x: pos.x, y: pos.y, z: pos.z });
    };

    manager.onPathPointMoved = (id, pos) => {
      store.updatePathPoint(id, { x: pos.x, y: pos.y, z: pos.z });
    };

    PlanMapBridge.attachThree(manager);

    // 三维 -> 平面图：相机位置每帧更新由 bridge 转发
    // 平面图 -> 三维：定位请求
    PlanMapBridge.onLocate = async (x, z) => {
      if (!manager) return;
      const box = manager.clipBox ?? manager.cloudBox;
      if (!box) {
        toastBus.show('请先加载点云', 'info');
        return;
      }
      // 目标点取点击 XZ、高度为地面以上 1.2m（人眼高度），相机从斜上方看过去
      const target = new Vector3(x, box.min.y + 1.2, z);
      await manager.flyTo(target);
    };
  });

  // 点云加载/切换
  $effect(() => {
    const rec = store.cloudRecord;
    // managerReady 是响应式依赖：manager 创建后会重新执行本 effect
    if (!managerReady || !manager) return;
    const token = ++loadToken;
    if (!rec) {
      manager.clearCloud();
      store.cloudProgress = 0;
      return;
    }
    store.cloudLoading = true;
    store.cloudError = null;
    store.cloudProgress = 0;
    manager
      .loadLocalCloud(rec.key)
      .then(() => {
        if (token !== loadToken) return;
        store.cloudLoading = false;
        store.cloudProgress = 1;
        toastBus.success(`点云「${rec.name}」加载完成`);
      })
      .catch((err) => {
        if (token !== loadToken) return;
        store.cloudLoading = false;
        store.cloudError = String(err?.message ?? err);
        console.error('[点云加载失败]', err);
        toastBus.error(`点云加载失败：${store.cloudError}`);
      });
  });

  // 裁剪盒同步（同时订阅点云就绪，首次加载即把完整包围盒推给平面图）
  let mapBoundsTick = $state(0);
  onMount(() => PlanMapBridge.onCloudReady(() => mapBoundsTick++));

  $effect(() => {
    if (!managerReady) return;
    // 依赖点云就绪信号、点云记录、裁剪盒，任一变化都重推包围盒到平面图
    void mapBoundsTick;
    void store.cloudRecord;
    const json = JSON.stringify(store.clipBox ?? null);
    clipSnapshot = json;
    manager?.setClipBox(jsonToBox3(store.clipBox));
    PlanMapBridge.setBounds(manager?.clipBox ?? manager?.cloudBox ?? null);
  });

  // 标记同步
  $effect(() => {
    if (!managerReady) return;
    const json = JSON.stringify(store.markers);
    if (json === markerSnapshot) return;
    markerSnapshot = json;
    if (!manager) return;
    const liveIds = manager.markerIds;
    const nextIds = new Set(store.markers.map((m) => m.id));
    for (const id of liveIds) {
      if (!nextIds.has(id)) manager.removeMarker(id);
    }
    for (const m of store.markers) {
      if (!liveIds.has(m.id)) manager.addMarker(m);
      else manager.updateMarker(m);
    }
    PlanMapBridge.setMarkers(store.markers);
  });

  // 路径同步
  $effect(() => {
    if (!managerReady) return;
    const json = JSON.stringify(store.paths);
    if (json === pathSnapshot) return;
    pathSnapshot = json;
    const path = store.activePath;
    manager?.syncPath(path);
    PlanMapBridge.setPathPoints(path?.points ?? []);
  });

  // 交互模式同步到三维管理器（放置/记录时点击穿透标记对象）
  $effect(() => {
    if (!managerReady || !manager) return;
    manager.placeMode = store.placeMode;
    manager.recordMode = store.recordMode;
  });

  // 三维视口点击：放置标记 / 记录路径点
  function onViewportClick(e: MouseEvent) {
    if (!manager || !store.cloudRecord) return;
    // 点在标记/路径点上时属于拖拽交互，不触发放置
    if (manager.pointerDownOnObject) return;
    const point = manager.pickPlacementPoint(e.clientX, e.clientY);
    if (!point) return;
    if (store.placeMode) {
      const marker = store.addMarker(store.activeMarkerType, { x: point.x, y: point.y, z: point.z });
      toastBus.success(`已放置证据标记 #${marker.seq}`);
    } else if (store.recordMode) {
      store.addPathPoint({ x: point.x, y: point.y, z: point.z });
      toastBus.info('已记录路径关键点');
    }
  }

  function onDoubleClick(e: MouseEvent) {
    if (!manager) return;
    const point = manager.pickPlacementPoint(e.clientX, e.clientY);
    if (point) manager.flyTo(point, { duration: 0.8 });
  }

  onDestroy(() => {
    manager?.dispose();
    manager = null;
  });
</script>

<div class="viewport">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
  <div
    class="canvas-host"
    bind:this={container}
    role="application"
    aria-label="三维点云视口"
    tabindex="-1"
    onclick={onViewportClick}
    ondblclick={onDoubleClick}
  ></div>
  <ViewportOverlay />
  <ClipPanel />
</div>

<style>
.viewport {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
}
.canvas-host {
  width: 100%;
  height: 100%;
}
.canvas-host :global(canvas) {
  display: block;
  cursor: crosshair;
}
</style>
