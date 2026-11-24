<script setup lang="ts">
import { ref } from 'vue'
import { downloadTextFile } from '../services/fonts'
import {
  createExportBundle,
  importJsonText,
  isSlotDirty,
  loadFromSlot,
  saveToSlot,
  showToast,
  studio,
} from '../services/store'

const fileInput = ref<HTMLInputElement | null>(null)

function save(index: number) {
  if (studio.slots[index].scheme && index !== studio.activeSlot) {
    const ok = window.confirm(`确定要用当前画布覆盖${studio.slots[index].label}中已保存的方案吗？`)
    if (!ok) return
  }
  saveToSlot(index)
}

function load(index: number) {
  if (isSlotDirty(studio.activeSlot)) {
    const ok = window.confirm('当前方案有未保存修改，切换后将载入已保存快照。确定继续吗？')
    if (!ok) return
  }
  loadFromSlot(index)
}

function exportCurrent() {
  const safeName = studio.doc.name.replace(/[\\/:*?"<>|]/g, '-') || 'booth-scheme'
  downloadTextFile(`${safeName}.json`, JSON.stringify(studio.doc, null, 2))
  showToast('当前方案 JSON 已导出')
}

function exportBundle() {
  downloadTextFile('booth-brand-studio-三套方案包.json', JSON.stringify(createExportBundle(), null, 2))
  showToast('三套方案与当前编辑状态已打包导出')
}

function triggerImport() {
  fileInput.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const result = importJsonText(text)
    showToast(result.kind === 'bundle' ? '方案包导入成功，三套方案已还原' : '方案导入成功，配色与文字位置已还原')
  } catch (error) {
    console.error(error)
    showToast(`导入失败：${error instanceof Error ? error.message : 'JSON 格式无效'}`, 'error')
  } finally {
    input.value = ''
  }
}

function formatTime(value: string | null): string {
  if (!value) return '尚未保存'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '已保存' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="panel-stack">
    <div class="panel-intro">
      <h3>第四步 · 方案保存 / 切换 / 交付</h3>
      <p>三套方案分别保存全部面的材质 ID、文字内容、字号、字距和归一化坐标。</p>
    </div>

    <label class="field">
      <span>当前方案名称</span>
      <input v-model="studio.doc.name" type="text" maxlength="60" placeholder="为发布会方案命名" />
    </label>

    <div class="slot-grid">
      <article v-for="(slot, index) in studio.slots" :key="slot.id" class="slot-card" :class="{ active: studio.activeSlot === index && slot.scheme }">
        <div class="slot-head">
          <span class="slot-letter">{{ slot.id }}</span>
          <div>
            <h4>{{ slot.label }}</h4>
            <p>{{ formatTime(slot.savedAt) }}</p>
          </div>
          <span v-if="studio.activeSlot === index && isSlotDirty(index)" class="dirty-pill">未保存</span>
          <span v-else-if="studio.activeSlot === index && slot.scheme" class="saved-pill">使用中</span>
        </div>
        <p v-if="slot.scheme" class="slot-summary">
          {{ slot.scheme.name }} · {{ slot.scheme.texts.length }} 个文字块
        </p>
        <p v-else class="slot-empty">空方案位，点击下方保存当前配色与排布。</p>
        <div class="slot-actions">
          <button type="button" class="primary-btn small" @click="save(index)">保存当前</button>
          <button type="button" class="secondary-btn small" :disabled="!slot.scheme" @click="load(index)">切换还原</button>
        </div>
      </article>
    </div>

    <div class="io-card">
      <h5>导出 / 导入</h5>
      <p>导出的 JSON 包含模型 ID、每面材质和所有文字参数；重新导入即可完整还原。</p>
      <div class="button-row wrap">
        <button type="button" class="primary-btn" @click="exportCurrent">导出当前方案</button>
        <button type="button" class="secondary-btn" @click="exportBundle">导出三套方案包</button>
        <button type="button" class="secondary-btn" @click="triggerImport">导入 JSON</button>
      </div>
      <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onFileChange" />
    </div>

    <div class="notice-box subtle">
      浏览器本地会自动缓存当前工作区；清理站点数据前请先导出方案 JSON。
    </div>
  </div>
</template>
