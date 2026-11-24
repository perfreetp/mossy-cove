<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Viewer } from '../three/Viewer'
import {
  addDraftPoint,
  handleViewerSectionDrag,
  handleViewerSectionPosition,
  loadOrganFile,
  loadSampleOrgan,
  registerViewer,
  state,
} from '../state/controller'

const host = ref<HTMLDivElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
let viewer: Viewer | null = null

onMounted(() => {
  if (!host.value) return
  viewer = new Viewer(host.value, {
    onSurfacePick: (position, normal) => addDraftPoint(position, normal),
    onSectionPositionChange: (position) => handleViewerSectionPosition(position),
    onSectionDragStateChange: (dragging) => handleViewerSectionDrag(dragging),
  })
  registerViewer(viewer)
})

onBeforeUnmount(() => {
  viewer?.dispose()
  viewer = null
})

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await loadOrganFile(file)
  input.value = ''
}

function frame() {
  viewer?.frameOrgan()
}
</script>

<template>
  <section class="viewport">
    <div ref="host" class="viewport-host" style="position:absolute;inset:0;"></div>

    <input ref="fileInput" class="hidden-input" type="file" accept=".stl,.obj,.ply,.glb,.gltf" @change="onFile" />

    <div v-if="state.organ.status === 'ready'" class="viewport-actions">
      <button class="icon-btn" title="复位视角" @click="frame">⌖</button>
    </div>

    <div class="viewport-overlay">
      <div v-if="state.engineStatus === 'loading'" class="viewport-chip">⏳ {{ state.engineMessage }}</div>
      <div v-else-if="state.engineStatus === 'error'" class="viewport-chip" style="border-color: rgba(251,113,133,.5); color: #fecdd3;">
        ⚠️ {{ state.engineMessage }}
      </div>

      <div v-if="state.drawMode" class="viewport-chip">
        <strong>勾画模式</strong>：在器官表面点击放置控制点；至少 3 点后闭合并拉伸。拖动空白处可旋转视角。
        已放置 <strong>{{ state.draftPoints.length }}</strong> 点。
      </div>

      <div v-else-if="state.section.enabled" class="viewport-chip">
        <strong>剖面模式</strong>：拖动青色切割平面或边缘圆球。
        器官截面积：<strong>{{ state.section.organAreaMm2 === null ? '计算中…' : state.section.organAreaMm2.toFixed(1) }}</strong> mm²
      </div>

      <div v-else-if="state.organ.status === 'ready'" class="viewport-chip">
        左键旋转 · 右键平移 · 滚轮缩放。器官当前为半透明显示，病灶使用独立材质。
      </div>
    </div>

    <div v-if="state.organ.status !== 'ready'" class="empty-view">
      <div class="empty-card">
        <div class="cube">🧠</div>
        <h2>载入 CT / MRI 重建网格</h2>
        <p>
          支持 STL、OBJ、PLY、GLB 和 glTF。所有模型、标注、布尔结果与剖面位置均保存在当前浏览器，
          可导出单个 JSON 项目文件分享并重新导入。
        </p>
        <div class="btn-row" style="justify-content:center;">
          <button class="btn primary" @click="fileInput?.click()">选择网格文件</button>
          <button class="btn success" @click="loadSampleOrgan">使用示例器官</button>
        </div>
      </div>
    </div>

    <div v-if="state.organ.status === 'ready' && !state.drawMode" class="bottom-hud">
      <span class="hint">{{ state.organ.name }}</span>
      <span class="badge info">{{ state.organ.faceCount.toLocaleString() }} 面</span>
      <span v-if="state.section.enabled" class="badge" :class="state.section.dragging ? 'warning' : 'success'">
        {{ state.section.dragging ? '正在拖动剖面' : '剖切已启用' }}
      </span>
    </div>
  </section>
</template>
