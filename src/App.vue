<script setup lang="ts">
import { onMounted } from 'vue'
import TopBar from './components/TopBar.vue'
import Viewport from './components/Viewport.vue'
import LoadPanel from './components/LoadPanel.vue'
import DrawPanel from './components/DrawPanel.vue'
import MeasurePanel from './components/MeasurePanel.vue'
import SectionPanel from './components/SectionPanel.vue'
import LesionPanel from './components/LesionPanel.vue'
import ToastHost from './components/ToastHost.vue'
import { initializeEngine, restoreProject, setActiveTab, state } from './state/controller'
import type { ModuleTab } from './lib/types'

const tabs: Array<{ key: ModuleTab; icon: string; label: string }> = [
  { key: 'load', icon: '🧩', label: '载入' },
  { key: 'draw', icon: '✏️', label: '勾画' },
  { key: 'measure', icon: '📏', label: '测量' },
  { key: 'section', icon: '🪚', label: '剖面' },
]

onMounted(async () => {
  await initializeEngine()
  await restoreProject()
})
</script>

<template>
  <div class="app-shell">
    <TopBar />

    <div class="workspace">
      <nav class="module-rail" aria-label="功能模块">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="rail-btn"
          :class="{ active: state.activeTab === tab.key }"
          @click="setActiveTab(tab.key)"
        >
          <span class="rail-icon">{{ tab.icon }}</span>
          <span class="rail-label">{{ tab.label }}</span>
        </button>
        <div class="rail-foot">Three.js<br />Manifold-3D<br />Vue 3 + TS</div>
      </nav>

      <main class="control-panel">
        <LoadPanel v-if="state.activeTab === 'load'" />
        <DrawPanel v-else-if="state.activeTab === 'draw'" />
        <MeasurePanel v-else-if="state.activeTab === 'measure'" />
        <SectionPanel v-else-if="state.activeTab === 'section'" />
      </main>

      <Viewport />

      <aside class="right-panel">
        <LesionPanel />
      </aside>
    </div>

    <ToastHost />
  </div>
</template>
