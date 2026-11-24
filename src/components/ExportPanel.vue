<script setup lang="ts">
import { ref } from 'vue'
import { downloadJson, readJsonFile, serializeProject } from '../utils/io'
import { clearScene, loadProjectSnapshot, resetToSeed, store } from '../state/store'

const fileInput = ref<HTMLInputElement | null>(null)
const message = ref('')
const error = ref('')
const importing = ref(false)

function exportJson() {
  error.value = ''
  const text = serializeProject()
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  downloadJson(`sandbox-buildings-${stamp}.json`, text)
  message.value = '已导出包含坐标、尺寸、朝向和街道折线的 JSON 文件。'
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(serializeProject())
    message.value = 'JSON 已复制到剪贴板，可直接发送分享。'
    error.value = ''
  } catch {
    error.value = '浏览器拒绝了剪贴板访问，请使用导出文件。'
  }
}

function triggerImport() {
  fileInput.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importing.value = true
  error.value = ''
  message.value = ''
  try {
    const project = await readJsonFile(file)
    loadProjectSnapshot(project, '导入 JSON 文件')
    message.value = `已导入 ${project.buildings.length} 个建筑和 ${project.streets.length} 条街道。`
  } catch (e) {
    console.error(e)
    error.value = '导入失败：JSON 格式不符合沙盘文件结构。'
  } finally {
    importing.value = false
    input.value = ''
  }
}

function clearAll() {
  if (window.confirm('确定清空全部建筑和街道吗？该操作可以立即撤销。')) clearScene()
}

function resetDemo() {
  resetToSeed()
  message.value = '已恢复为 96 个示例建筑的沙盘。'
}
</script>

<template>
  <section class="panel export-panel" aria-label="导出">
    <header class="panel-header">
      <div>
        <h2>导出 / 分享</h2>
        <p>浏览器自动存档，JSON 文件可交换沙盘</p>
      </div>
    </header>

    <div class="export-actions">
      <button class="btn primary" type="button" @click="exportJson">导出 JSON 文件</button>
      <button class="btn" type="button" @click="copyJson">复制 JSON</button>
      <button class="btn ghost" type="button" :disabled="importing" @click="triggerImport">
        {{ importing ? '导入中…' : '导入分享文件' }}
      </button>
      <input ref="fileInput" class="hidden-file" type="file" accept="application/json,.json" @change="onFileChange" />
    </div>

    <div class="schema-list">
      <span>建筑坐标 x/z</span>
      <span>宽深高尺寸</span>
      <span>弧度 + 角度朝向</span>
      <span>屋顶样式</span>
      <span>街道折点数组</span>
    </div>

    <p v-if="message" class="form-message success">{{ message }}</p>
    <p v-if="error" class="form-message error">{{ error }}</p>

    <div class="storage-box">
      <div>
        <strong>本地存档</strong>
        <span>{{ store.saveState }}</span>
      </div>
      <small>{{ store.lastSavedAt.toLocaleTimeString() }} · localStorage</small>
      <div class="danger-actions">
        <button class="btn subtle" type="button" @click="resetDemo">恢复示例</button>
        <button class="btn danger-ghost" type="button" @click="clearAll">清空场景</button>
      </div>
    </div>
  </section>
</template>
