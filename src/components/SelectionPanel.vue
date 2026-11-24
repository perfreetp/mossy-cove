<script setup lang="ts">
import { computed, ref } from 'vue'
import { ROOF_LABELS } from '../data/library'
import {
  alignSelected,
  clearSelection,
  deleteSelected,
  distributeSelected,
  duplicateSelected,
  getSelectedBuildings,
  runCommand,
  setSelectedRoof,
  setSelectedRotation,
  store,
  unifySelectedOrientation
} from '../state/store'
import type { RoofStyle } from '../types'
import { degToRad, radToDeg, snapRotationToStep } from '../utils/geometry'

const selected = computed(() => getSelectedBuildings())
const single = computed(() => (selected.value.length === 1 ? selected.value[0] : null))
const orientation = ref(0)

const roofs: RoofStyle[] = ['flat', 'gable', 'hip']

function rotate(direction: 1 | -1) {
  const current = single.value ? snapRotationToStep(single.value.rotation) : 0
  setSelectedRotation(current + direction * degToRad(15), direction > 0 ? '顺时针旋转 15°' : '逆时针旋转 15°')
}

function onOrientationInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) setSelectedRotation(snapRotationToStep(degToRad(value)), '设置朝向')
}

function applyUnifyAngle() {
  unifySelectedOrientation(degToRad(orientation.value))
}

function detachFromStreet() {
  runCommand('解除街道绑定', () => {
    const ids = new Set(store.selectedIds)
    for (const b of store.buildings) {
      if (ids.has(b.id)) {
        b.streetId = null
        b.streetSide = null
        b.streetU = null
      }
    }
  })
}
</script>

<template>
  <aside v-if="selected.length" class="selection-panel" aria-label="选中建筑操作">
    <header>
      <strong>{{ selected.length === 1 ? single?.name : `已框选 ${selected.length} 个建筑` }}</strong>
      <button class="icon-btn" type="button" title="取消选择" @click="clearSelection">×</button>
    </header>

    <div v-if="single" class="single-meta">
      <label class="field inline-field">
        <span>X</span>
        <input :value="single.x.toFixed(1)" class="text-input" type="number" step="0.5" disabled />
      </label>
      <label class="field inline-field">
        <span>Z</span>
        <input :value="single.z.toFixed(1)" class="text-input" type="number" step="0.5" disabled />
      </label>
      <label class="field inline-field">
        <span>朝向°</span>
        <input
          class="text-input"
          type="number"
          step="15"
          :value="Math.round(radToDeg(single.rotation) / 15) * 15"
          @change="onOrientationInput"
        />
      </label>
    </div>

    <div class="button-row">
      <button class="btn small" type="button" @click="rotate(-1)">↺ 15°</button>
      <button class="btn small" type="button" @click="rotate(1)">15° ↻</button>
      <button class="btn small" type="button" @click="duplicateSelected">复制</button>
      <button class="btn small danger" type="button" @click="deleteSelected">删除</button>
    </div>

    <section v-if="selected.length >= 2" class="batch-section">
      <h3>对齐</h3>
      <div class="button-grid six">
        <button class="btn small" type="button" @click="alignSelected('x', 'min')">左齐</button>
        <button class="btn small" type="button" @click="alignSelected('x', 'center')">水平居中</button>
        <button class="btn small" type="button" @click="alignSelected('x', 'max')">右齐</button>
        <button class="btn small" type="button" @click="alignSelected('z', 'min')">上齐</button>
        <button class="btn small" type="button" @click="alignSelected('z', 'center')">纵深居中</button>
        <button class="btn small" type="button" @click="alignSelected('z', 'max')">下齐</button>
      </div>

      <h3>等距分布</h3>
      <div class="button-row">
        <button class="btn small" type="button" :disabled="selected.length < 3" @click="distributeSelected('x')">横向等距</button>
        <button class="btn small" type="button" :disabled="selected.length < 3" @click="distributeSelected('z')">纵向等距</button>
      </div>

      <h3>统一朝向</h3>
      <div class="orientation-row">
        <input v-model.number="orientation" type="range" min="0" max="345" step="15" />
        <output>{{ orientation }}°</output>
        <button class="btn small primary" type="button" @click="applyUnifyAngle">应用</button>
      </div>
      <button class="btn small wide" type="button" @click="unifySelectedOrientation()">对齐首个选中朝向</button>
    </section>

    <section class="roof-section">
      <h3>替换屋顶样式</h3>
      <div class="roof-grid">
        <button
          v-for="roof in roofs"
          :key="roof"
          type="button"
          class="roof-card"
          :class="{ active: single ? single.roof === roof : false }"
          @click="setSelectedRoof(roof)"
        >
          <span class="roof-icon" :data-roof="roof"></span>
          {{ ROOF_LABELS[roof] }}
        </button>
      </div>
    </section>

    <button v-if="selected.some((b) => b.streetId)" class="btn small ghost wide" type="button" @click="detachFromStreet">
      解除街道绑定（避免折线重排覆盖手动位置）
    </button>
  </aside>
</template>
