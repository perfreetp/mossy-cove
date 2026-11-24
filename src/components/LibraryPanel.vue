<script setup lang="ts">
import { computed, ref } from 'vue'
import { BUILDING_DEFS, CATEGORY_META } from '../data/library'
import { libraryDrag } from '../state/drag'
import type { BuildingCategory } from '../types'

const filter = ref<BuildingCategory | 'all'>('all')
const query = ref('')

const categories: Array<{ key: BuildingCategory | 'all'; label: string }> = [
  { key: 'all', label: '全部 30' },
  { key: 'residential', label: CATEGORY_META.residential.label },
  { key: 'tower', label: CATEGORY_META.tower.label },
  { key: 'warehouse', label: CATEGORY_META.warehouse.label }
]

const defs = computed(() => {
  const q = query.value.trim().toLowerCase()
  return BUILDING_DEFS.filter((def) => {
    if (filter.value !== 'all' && def.category !== filter.value) return false
    if (!q) return true
    return def.name.toLowerCase().includes(q) || def.tierName.toLowerCase().includes(q)
  })
})

function onDragStart(event: DragEvent, defId: string) {
  libraryDrag.defId = defId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('application/x-building-def', defId)
    event.dataTransfer.setData('text/plain', defId)
  }
}

function onDragEnd() {
  libraryDrag.defId = null
}
</script>

<template>
  <section class="panel library-panel" aria-label="建筑库">
    <header class="panel-header">
      <div>
        <h2>建筑库</h2>
        <p>30 种固定档位体块 · 拖入场景</p>
      </div>
      <span class="badge">{{ BUILDING_DEFS.length }}</span>
    </header>

    <div class="library-controls">
      <input v-model="query" class="text-input" type="search" placeholder="搜索名称或档位，如 T6" />
      <div class="segmented">
        <button
          v-for="item in categories"
          :key="item.key"
          type="button"
          :class="{ active: filter === item.key }"
          @click="filter = item.key"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div class="library-list">
      <article
        v-for="def in defs"
        :key="def.defId"
        class="building-card"
        draggable="true"
        @dragstart="onDragStart($event, def.defId)"
        @dragend="onDragEnd"
      >
        <div class="thumb" :class="`thumb-${def.category}`" :style="{ '--cube': def.color }">
          <span class="cube" :data-category="def.category"></span>
          <span class="tier">{{ def.tierName }}</span>
        </div>
        <div class="card-body">
          <strong :title="def.name">{{ def.name }}</strong>
          <small>{{ CATEGORY_META[def.category].label }} · {{ def.width }}×{{ def.depth }}×{{ def.height }}</small>
          <div class="dim-row">
            <span>面宽 {{ def.width }}</span>
            <span>进深 {{ def.depth }}</span>
            <span>高 {{ def.height }}</span>
          </div>
        </div>
        <span class="drag-hint">⠿</span>
      </article>
      <p v-if="!defs.length" class="empty-inline">没有匹配的建筑档位。</p>
    </div>
  </section>
</template>
