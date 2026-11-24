<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SelectionPanel from './SelectionPanel.vue'
import { BUILDING_DEF_MAP } from '../data/library'
import { libraryDrag } from '../state/drag'
import {
  addBuildingFromDefId,
  cancelStreetDrawing,
  clearSelection,
  deleteSelected,
  finishStreetDrawing,
  redo,
  rotateSelectedBy,
  store,
  undo
} from '../state/store'
import { SceneManager } from '../scene/SceneManager'
import { degToRad, resolvePlacement } from '../utils/geometry'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const marqueeRef = ref<HTMLDivElement | null>(null)
const sceneManager = ref<SceneManager | null>(null)
const orbitMode = ref(false)

onMounted(() => {
  if (!canvasRef.value) return
  sceneManager.value = new SceneManager(canvasRef.value, marqueeRef.value)
  sceneManager.value.syncAll()

  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  sceneManager.value?.dispose()
  sceneManager.value = null
})

watch(
  () => store.revision,
  () => sceneManager.value?.syncAll()
)

watch(
  () => [...store.selectedIds],
  () => sceneManager.value?.syncSelection(),
  { deep: true }
)

watch(
  () => store.settings.showGrid,
  (value) => sceneManager.value?.setGridVisible(value)
)

watch(
  () => libraryDrag.defId,
  (defId) => sceneManager.value?.setGhost(defId)
)

function onKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return

  const mod = event.ctrlKey || event.metaKey
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if (mod && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redo()
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelected()
    return
  }
  if (event.key === 'Escape') {
    if (store.drawingStreet) cancelStreetDrawing()
    else clearSelection()
    return
  }
  if (event.key.toLowerCase() === 'r' && !mod) {
    event.preventDefault()
    rotateSelectedBy(event.shiftKey ? -degToRad(15) : degToRad(15))
  }
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  const defId = libraryDrag.defId
  if (!defId || !sceneManager.value) return
  sceneManager.value.setGhost(defId)
  sceneManager.value.updateGhostFromClient(event.clientX, event.clientY)
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const manager = sceneManager.value
  if (!manager) return

  const defId =
    libraryDrag.defId ||
    event.dataTransfer?.getData('application/x-building-def') ||
    event.dataTransfer?.getData('text/plain')
  const def = defId ? BUILDING_DEF_MAP.get(defId) : null
  const point = manager.groundPointFromClient(event.clientX, event.clientY)
  if (!def || !point) return

  const pose = resolvePlacement(
    point,
    { width: def.width, depth: def.depth, rotation: 0 },
    store.buildings,
    store.streets,
    store.settings.snapThreshold,
    store.settings.gridSize
  )

  addBuildingFromDefId(def.defId, pose.x, pose.z, pose.rotation, {
    streetId: pose.streetId ?? null,
    streetSide: pose.streetSide ?? null,
    streetU: pose.streetU ?? null
  })
  manager.setGhost(null)
  libraryDrag.defId = null
}

function onCanvasDoubleClick() {
  if (store.drawingStreet) finishStreetDrawing()
}

function toggleOrbit() {
  orbitMode.value = !orbitMode.value
  sceneManager.value?.setOrbitMode(orbitMode.value)
}

function setView(view: 'top' | 'perspective' | 'reset') {
  sceneManager.value?.setView(view)
}

const countStatus = () => {
  const n = store.buildings.length
  if (n < 60) return { text: `${n} 栋 · 建议 60–120`, className: 'count-warn' }
  if (n <= 120) return { text: `${n} 栋 · 流畅目标区间`, className: 'count-good' }
  return { text: `${n} 栋 · 已超过 120`, className: 'count-warn' }
}
</script>

<template>
  <section class="panel scene-panel" aria-label="场景">
    <div class="scene-topbar">
      <div class="scene-title">
        <h2>场景</h2>
        <span class="count-pill" :class="countStatus().className">{{ countStatus().text }}</span>
      </div>
      <div class="scene-tools">
        <label class="threshold-control" title="墙贴齐和街道吸附的世界单位阈值">
          吸附阈值
          <input v-model.number="store.settings.snapThreshold" type="range" min="0.4" max="5" step="0.1" />
          <b>{{ store.settings.snapThreshold.toFixed(1) }}</b>
        </label>
        <label class="check-control">
          <input v-model="store.settings.showGrid" type="checkbox" />
          网格
        </label>
        <button class="btn small" :class="{ primary: orbitMode }" type="button" @click="toggleOrbit">
          {{ orbitMode ? '视角模式：左键旋转' : '选择模式' }}
        </button>
        <button class="btn small ghost" type="button" @click="setView('top')">顶视</button>
        <button class="btn small ghost" type="button" @click="setView('perspective')">透视</button>
        <button class="btn small ghost" type="button" @click="setView('reset')">复位</button>
      </div>
    </div>

    <div
      class="canvas-host"
      @dragover="onDragOver"
      @drop="onDrop"
      @dblclick="onCanvasDoubleClick"
    >
      <canvas ref="canvasRef" class="scene-canvas" @contextmenu.prevent></canvas>
      <div ref="marqueeRef" class="marquee-rect"></div>

      <SelectionPanel />

      <div class="scene-hint">
        <template v-if="store.drawingStreet">单击加折点 · 双击完成 · Esc 取消</template>
        <template v-else-if="orbitMode">左键旋转视角 · 滚轮缩放 · 右键平移</template>
        <template v-else>拖入库建筑 · 左键拖动 · 空白处框选 · R/Shift+R 旋转 · 右键平移 · 中键旋转</template>
      </div>
    </div>
  </section>
</template>
