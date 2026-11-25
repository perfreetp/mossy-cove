<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CloudPanel from './components/CloudPanel.vue'
import TerrainPanel from './components/TerrainPanel.vue'
import ViewPanel from './components/ViewPanel.vue'
import { SceneManager } from './babylon/SceneManager'
import { sceneManagerRef } from './babylon/bridge'
import { downloadProjectFile, readProjectFile } from './io/projectFile'
import {
  canRedo,
  canUndo,
  createBlankProject,
  history,
  project,
  redoLabel,
  replaceImportedProject,
  saveState,
  undoLabel,
} from './state/store'
import { viewState } from './state/viewState'

type TabId = 'terrain' | 'cloud' | 'view'

const activeTab = ref<TabId>('terrain')
const canvasRef = ref<HTMLCanvasElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const notice = ref('')
const noticeTone = ref<'ok' | 'error'>('ok')
const webglError = ref('')

let resizeObserver: ResizeObserver | null = null
let noticeTimer: number | undefined

function showNotice(message: string, tone: 'ok' | 'error' = 'ok'): void {
  notice.value = message
  noticeTone.value = tone
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 3600)
}

function onExport(): void {
  downloadProjectFile(project.value)
  showNotice('已导出高度场、云带参数与笔刷遮罩文件。')
}

function triggerImport(): void {
  fileInputRef.value?.click()
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const imported = await readProjectFile(file)
    replaceImportedProject(imported)
    activeTab.value = 'cloud'
    showNotice(`已导入「${imported.name}」，可继续编辑。`)
  } catch (error) {
    console.error(error)
    showNotice(error instanceof Error ? error.message : '导入失败，请检查文件格式。', 'error')
  }
}

function onNewProject(): void {
  if (window.confirm('新建会替换当前工作状态；如需保留请先导出文件。是否继续？')) {
    createBlankProject()
    activeTab.value = 'terrain'
    showNotice('已创建新的默认云海地形。')
  }
}

function onKeydown(event: KeyboardEvent): void {
  const modPressed = event.ctrlKey || event.metaKey
  if (!modPressed) return
  const key = event.key.toLowerCase()
  if (key === 'z') {
    event.preventDefault()
    if (event.shiftKey) history.redo()
    else history.undo()
  } else if (key === 'y') {
    event.preventDefault()
    history.redo()
  }
}

watch(
  () => project.value.heights,
  () => sceneManagerRef.value?.updateTerrain(project.value),
)
watch(
  () => project.value.terrain.ridgeHeight,
  () => sceneManagerRef.value?.updateTerrain(project.value),
)
watch(
  () => project.value.bands,
  () => sceneManagerRef.value?.syncClouds(project.value.bands),
  { deep: true },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)

  if (canvasRef.value) {
    try {
      const manager = new SceneManager(canvasRef.value, project.value)
      sceneManagerRef.value = manager
      manager.speed = viewState.speed
      manager.setPathVisible(viewState.showPath)
      manager.onProgress = (progress) => {
        viewState.progress = progress
      }
      manager.onOrder = (order) => {
        viewState.order = order
      }

      resizeObserver = new ResizeObserver(() => manager.resize())
      resizeObserver.observe(canvasRef.value)
    } catch (error) {
      console.error('Babylon.js 初始化失败', error)
      webglError.value = '当前浏览器无法初始化 WebGL。请启用硬件加速或使用最新版 Chrome/Edge。'
    }
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  resizeObserver?.disconnect()
  sceneManagerRef.value?.dispose()
  sceneManagerRef.value = null
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark">☁</span>
        <div>
          <h1>云海地形生成器</h1>
          <span>TypeScript · Vue 3 · Babylon.js</span>
        </div>
      </div>

      <div class="topbar__actions">
        <div class="history-group" role="group" aria-label="撤销重做">
          <button
            type="button"
            class="icon-button"
            :disabled="!canUndo"
            :title="undoLabel ? `撤销：${undoLabel}（Ctrl+Z）` : '撤销（Ctrl+Z）'"
            @click="history.undo()"
          >
            ↶
          </button>
          <button
            type="button"
            class="icon-button"
            :disabled="!canRedo"
            :title="redoLabel ? `重做：${redoLabel}（Ctrl+Shift+Z）` : '重做（Ctrl+Shift+Z）'"
            @click="history.redo()"
          >
            ↷
          </button>
        </div>

        <span class="save-status" :class="saveState">
          <i />
          {{ saveState === 'saving' ? '保存中…' : saveState === 'error' ? '浏览器存储失败' : '已存入浏览器' }}
        </span>

        <button type="button" class="button" @click="onNewProject">新建</button>
        <button type="button" class="button" @click="triggerImport">导入</button>
        <button type="button" class="button button--primary" @click="onExport">导出文件</button>
        <input
          ref="fileInputRef"
          type="file"
          accept=".json,application/json"
          hidden
          @change="onImportFile"
        />
      </div>
    </header>

    <div class="workspace">
      <aside class="sidebar">
        <nav class="tabs" aria-label="功能面板">
          <button type="button" :class="{ active: activeTab === 'terrain' }" @click="activeTab = 'terrain'">
            <span>⛰</span>地形
          </button>
          <button type="button" :class="{ active: activeTab === 'cloud' }" @click="activeTab = 'cloud'">
            <span>☁</span>云层
          </button>
          <button type="button" :class="{ active: activeTab === 'view' }" @click="activeTab = 'view'">
            <span>🎥</span>视角
          </button>
        </nav>

        <div class="panel-scroll">
          <TerrainPanel v-show="activeTab === 'terrain'" />
          <CloudPanel v-show="activeTab === 'cloud'" />
          <ViewPanel v-show="activeTab === 'view'" />
        </div>
      </aside>

      <main class="viewport">
        <canvas ref="canvasRef" class="scene-canvas" aria-label="云海地形 3D 预览" />
        <div v-if="webglError" class="webgl-error">{{ webglError }}</div>

        <div class="viewport-chip viewport-chip--left">
          <strong>实时高度遮挡</strong>
          <span>拖动云带高度即可重算穿插</span>
        </div>
        <div class="viewport-chip viewport-chip--right">
          <span>左键旋转 · 滚轮缩放 · 右键平移</span>
        </div>

        <Transition name="toast">
          <div v-if="notice" class="toast" :class="noticeTone">{{ notice }}</div>
        </Transition>
      </main>
    </div>
  </div>
</template>
