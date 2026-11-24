<script>
  import { onMount } from 'svelte';
  import { SceneController } from '../lib/SceneController.js';
  import {
    disposeBuildingAssets,
    initManifold,
    splitBuildingIntoFloors
  } from '../lib/geometry.js';
  import {
    commitCurrent,
    cutFloorIds,
    doc,
    geometryStatus,
    preview,
    selectFloor,
    setTransformMode,
    ui
  } from '../lib/store.js';
  import { showToast } from '../lib/feedback.js';

  let { registerFrame = () => {} } = $props();

  let container = null;
  let controller = null;
  let manifoldApi = null;
  let assets = null;
  let lastAssetKey = '';
  let lastBuildingId = '';
  let unsubDoc = null;
  let unsubUi = null;

  function applyDocument(next) {
    if (!controller || !manifoldApi || !next) return;

    const assetKey = `${next.buildingId}:${next.floorCount}`;
    if (assetKey !== lastAssetKey) {
      const oldAssets = assets;
      const built = splitBuildingIntoFloors(
        manifoldApi,
        next.buildingId,
        next.floorCount
      );

      assets = built;
      lastAssetKey = assetKey;
      controller.setFloorAssets(assets);

      if (next.buildingId !== lastBuildingId) {
        controller.frameAssets(assets);
      }
      lastBuildingId = next.buildingId;

      if (oldAssets) {
        // Controller has already removed the old meshes and GPU resources.
        disposeBuildingAssets(oldAssets);
      }
    }

    controller.syncDoc(next);
  }

  onMount(() => {
    let disposed = false;

    try {
      controller = new SceneController(container, {
        onSelectFloor: (id) => selectFloor(id),
        onTransformPreview: (id, transform) => {
          preview((draft) => {
            const floor = draft.floors.find((item) => item.id === id);
            if (floor) Object.assign(floor, transform);
          });
        },
        onTransformEnd: (id, transform) => {
          preview((draft) => {
            const floor = draft.floors.find((item) => item.id === id);
            if (floor) Object.assign(floor, transform);
          });
          const floor = $doc.floors.find((item) => item.id === id);
          commitCurrent('单层变换', floor ? floor.name : '');
        },
        onSectionPreview: (patch) => {
          preview((draft) => Object.assign(draft.section, patch));
        },
        onSectionEnd: () => {
          commitCurrent(
            '移动剖切面',
            `d = ${Number($doc.section.distance).toFixed(2)}`
          );
        },
        onCutChange: (ids) => {
          cutFloorIds.set(ids);
        }
      });

      registerFrame(() => controller?.frameAssets(assets));

      unsubDoc = doc.subscribe(applyDocument);
      unsubUi = ui.subscribe((value) => {
        controller?.setSelection(value.selectedFloorId, value.transformMode);
      });

      (async () => {
        try {
          manifoldApi = await initManifold();
          if (disposed) return;
          geometryStatus.set({ ready: true, message: 'Manifold WASM 已就绪' });
          applyDocument($doc);
        } catch (error) {
          console.error(error);
          geometryStatus.set({
            ready: false,
            message: `Manifold 初始化失败：${error?.message || error}`
          });
          showToast('三维几何引擎初始化失败，请刷新或检查 WASM 资源', 'error');
        }
      })();
    } catch (error) {
      console.error(error);
      geometryStatus.set({
        ready: false,
        message: `Three.js 场景初始化失败：${error?.message || error}`
      });
    }

    return () => {
      disposed = true;
      unsubDoc?.();
      unsubUi?.();
      disposeBuildingAssets(assets);
      controller?.dispose();
      controller = null;
    };
  });
</script>

<div class="scene-panel">
  <div class="scene-container" bind:this={container}></div>

  <div class="scene-overlay-top">
    <div class="scene-card scene-status">
      <span class="status-dot" class:loading={!$geometryStatus.ready}></span>
      <div>
        <div>{$geometryStatus.ready ? '沙盘实时同步中' : '几何引擎加载中'}</div>
        <div class="scene-hint">左键旋转 · 滚轮缩放 · 右键平移 · 点击楼层选择</div>
      </div>
    </div>

    <div class="scene-card mode-toolbar" aria-label="变换模式">
      <button
        class="btn btn-small"
        class:btn-active={$ui.transformMode === 'translate'}
        onclick={() => setTransformMode('translate')}
      >
        平移 W
      </button>
      <button
        class="btn btn-small"
        class:btn-active={$ui.transformMode === 'rotate'}
        onclick={() => setTransformMode('rotate')}
      >
        旋转 E
      </button>
      <button
        class="btn btn-small"
        class:btn-active={$ui.transformMode === 'scale'}
        onclick={() => setTransformMode('scale')}
      >
        缩放 R
      </button>
    </div>
  </div>

  <div class="scene-overlay-bottom">
    <div class="scene-card legend">
      <span class="legend-item">
        <span class="legend-swatch" style="background:#93c5fd;"></span>
        独立楼层实体
      </span>
      <span class="legend-item">
        <span class="legend-swatch" style="background:#ff8a1f;"></span>
        薄实体封口截面
      </span>
      <span class="legend-item">
        <span class="legend-swatch" style="background:#0284c7;"></span>
        剖切面 / 拖拽手柄
      </span>
    </div>
  </div>

  {#if !$geometryStatus.ready}
    <div class="loading-overlay">
      <div class="loading-box">
        <div class="spinner"></div>
        <div class="loading-title">正在启动 Manifold 几何内核</div>
        <div class="loading-message">{$geometryStatus.message}</div>
      </div>
    </div>
  {/if}
</div>
