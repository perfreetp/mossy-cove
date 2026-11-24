<script setup lang="ts">
import { ref } from 'vue'
import {
  exportProject,
  importProjectFile,
  loadOrganFile,
  loadSampleOrgan,
  saveStatus,
  lastSavedAt,
  state,
} from '../state/controller'

const organInput = ref<HTMLInputElement | null>(null)
const importInput = ref<HTMLInputElement | null>(null)

async function onOrganSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await loadOrganFile(file)
  input.value = ''
}

async function onImportSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await importProjectFile(file)
  input.value = ''
}

const saveText = () => {
  if (saveStatus.value === 'saved' && lastSavedAt.value) {
    return `本地已保存 ${new Date(lastSavedAt.value).toLocaleTimeString('zh-CN', { hour12: false })}`
  }
  if (saveStatus.value === 'saving') return '正在写入浏览器存储…'
  if (saveStatus.value === 'pending') return '有修改，等待保存…'
  if (saveStatus.value === 'error') return '本地保存失败，可导出文件备份'
  return '数据保存在浏览器 IndexedDB'
}
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">Lx</div>
      <div>
        <div class="brand-title">LesionMetric Studio</div>
        <div class="brand-subtitle">CT / MRI 重建病灶体积测量与剖面分析</div>
      </div>
    </div>

    <div class="save-state">
      <i class="status-dot" :class="saveStatus"></i>
      <span>{{ saveText() }}</span>
    </div>

    <div class="topbar-spacer"></div>

    <input ref="organInput" class="hidden-input" type="file" accept=".stl,.obj,.ply,.glb,.gltf" @change="onOrganSelected" />
    <input ref="importInput" class="hidden-input" type="file" accept=".json,application/json" @change="onImportSelected" />

    <button class="btn ghost sm" @click="loadSampleOrgan">示例器官</button>
    <button class="btn ghost sm" @click="organInput?.click()">载入网格</button>
    <button class="btn ghost sm" @click="importInput?.click()">导入项目</button>
    <button class="btn primary sm" :disabled="!state.organ.original" @click="exportProject">导出标注/报告</button>
  </header>
</template>
