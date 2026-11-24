<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { BoneViewer } from '../three/BoneViewer';
import {
  handleViewerPick,
  handleViewerSelect,
  loadProjectData,
  scheduleSave,
  setViewer,
} from '../controller';
import { loadLocalProject } from '../lib/storage';
import { getManifold } from '../lib/manifold';
import { store } from '../store';

const host = ref<HTMLDivElement | null>(null);
let viewer: BoneViewer | null = null;

onMounted(async () => {
  if (!host.value) return;
  viewer = new BoneViewer(host.value, {
    onSelect: handleViewerSelect,
    onPick: handleViewerPick,
    onTransformEnd: () => scheduleSave(250),
  });
  setViewer(viewer);

  try {
    const manifold = await getManifold();
    store.manifoldReady = Boolean(manifold.Manifold);
  } catch (error) {
    console.warn('Manifold WASM 预加载失败', error);
    store.manifoldReady = false;
  }

  const local = await loadLocalProject();
  if (local && Array.isArray(local.fragments) && local.fragments.length) {
    try {
      await loadProjectData(local);
    } catch (error) {
      console.error('本地项目恢复失败', error);
    }
  }
});

onBeforeUnmount(() => {
  viewer?.dispose();
  setViewer(null);
  viewer = null;
});
</script>

<template>
  <div ref="host" class="viewport-host" aria-label="骨骼碎片三维视图"></div>
</template>
