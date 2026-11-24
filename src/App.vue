<script setup lang="ts">
import ExportPanel from './components/ExportPanel.vue'
import LibraryPanel from './components/LibraryPanel.vue'
import SceneViewport from './components/SceneViewport.vue'
import StreetPanel from './components/StreetPanel.vue'
import { BUILDING_DEFS } from './data/library'
import { historyState, redo, store, undo } from './state/store'

const BUILDING_DEFS_COUNT = BUILDING_DEFS.length
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">▦</span>
        <div>
          <h1>微缩沙盘建筑群布置工具</h1>
          <p>Vue 3 · TypeScript · Babylon.js · 本地浏览器存储</p>
        </div>
      </div>

      <div class="top-stats">
        <span><b>{{ BUILDING_DEFS_COUNT }}</b> 种体块</span>
        <span><b>{{ store.buildings.length }}</b> 栋建筑</span>
        <span><b>{{ store.streets.length }}</b> 条街道</span>
      </div>

      <div class="history-actions">
        <button class="btn" type="button" :disabled="!historyState.canUndo" :title="historyState.undoLabel ? `撤销：${historyState.undoLabel}` : '撤销'" @click="undo">
          ↶ 撤销
        </button>
        <button class="btn" type="button" :disabled="!historyState.canRedo" :title="historyState.redoLabel ? `重做：${historyState.redoLabel}` : '重做'" @click="redo">
          ↷ 重做
        </button>
      </div>
    </header>

    <main class="workspace">
      <LibraryPanel />
      <SceneViewport />
      <aside class="right-column">
        <StreetPanel />
        <ExportPanel />
      </aside>
    </main>
  </div>
</template>
