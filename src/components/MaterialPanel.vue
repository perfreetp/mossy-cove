<script setup lang="ts">
import { computed } from 'vue'
import { getModel } from '../data/booths'
import { MATERIALS, getMaterial } from '../data/materials'
import { assignMaterial, studio } from '../services/store'

const model = computed(() => getModel(studio.modelId))
const selectedFace = computed(() => model.value.faces.find((f) => f.id === studio.selectedFaceId) ?? null)
const selectedMaterial = computed(() => getMaterial(studio.doc.assignments[studio.selectedFaceId ?? '']))

const groupedMaterials = computed(() => {
  const groups = new Map<string, typeof MATERIALS>()
  for (const material of MATERIALS) {
    const list = groups.get(material.category) ?? []
    list.push(material)
    groups.set(material.category, list)
  }
  return [...groups.entries()]
})

function applyToSameGroup() {
  if (!selectedFace.value) return
  const materialId = studio.doc.assignments[selectedFace.value.id]
  model.value.faces
    .filter((face) => face.group === selectedFace.value?.group)
    .forEach((face) => assignMaterial(materialId, face.id))
}

function applyToSameKind() {
  if (!selectedFace.value) return
  const materialId = studio.doc.assignments[selectedFace.value.id]
  model.value.faces
    .filter((face) => face.kind === selectedFace.value?.kind)
    .forEach((face) => assignMaterial(materialId, face.id))
}
</script>

<template>
  <div class="panel-stack">
    <div class="panel-intro">
      <h3>第二步 · 材质配色</h3>
      <p>点击展开图或三维视图中的面，再从材质库指派。两处视图会同步改色与高亮。</p>
    </div>

    <div v-if="selectedFace" class="selected-face-card">
      <div class="selected-swatch" :style="{ background: `linear-gradient(135deg, ${selectedMaterial.color}, ${selectedMaterial.color2})` }"></div>
      <div class="min-w-0">
        <p class="eyebrow">当前选中</p>
        <h4>{{ selectedFace.name }}</h4>
        <p>{{ selectedFace.group }} · {{ Math.round(selectedFace.width) }}×{{ Math.round(selectedFace.height) }}cm</p>
        <strong>{{ selectedMaterial.name }}</strong>
      </div>
    </div>
    <div v-else class="notice-box">请先选择一个展台表面。</div>

    <div class="button-row">
      <button type="button" class="secondary-btn" :disabled="!selectedFace" @click="applyToSameGroup">应用到同组</button>
      <button type="button" class="secondary-btn" :disabled="!selectedFace" @click="applyToSameKind">应用到同类面</button>
    </div>

    <div v-for="[category, materials] in groupedMaterials" :key="category" class="material-group">
      <h5>{{ category }}</h5>
      <div class="material-grid">
        <button
          v-for="material in materials"
          :key="material.id"
          type="button"
          class="material-swatch"
          :class="{ active: studio.doc.assignments[studio.selectedFaceId ?? ''] === material.id }"
          :disabled="!selectedFace"
          :title="material.name"
          @click="assignMaterial(material.id)"
        >
          <span class="swatch-chip" :style="{ background: `linear-gradient(135deg, ${material.color} 0%, ${material.color2} 100%)` }"></span>
          <span>{{ material.name }}</span>
        </button>
      </div>
    </div>

    <div class="face-list-card">
      <div class="card-title-row">
        <h5>全部表面（{{ model.faces.length }}）</h5>
        <span>点击联动定位</span>
      </div>
      <div class="face-list">
        <button
          v-for="face in model.faces"
          :key="face.id"
          type="button"
          class="face-row"
          :class="{ active: studio.selectedFaceId === face.id }"
          @click="studio.selectedFaceId = face.id"
          @mouseenter="studio.hoveredFaceId = face.id"
          @mouseleave="studio.hoveredFaceId = null"
        >
          <span class="face-dot" :style="{ background: getMaterial(studio.doc.assignments[face.id]).color }"></span>
          <span class="face-row-name">{{ face.name }}</span>
          <span class="face-row-group">{{ face.group }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
