<script setup lang="ts">
import { computed } from 'vue'
import { getModel } from '../data/booths'
import { boundaryMap, getTextOutline } from '../services/outlines'
import { addDemoTexts, addText, duplicateText, removeText, selectText, studio, updateText } from '../services/store'
import { fontState } from '../services/fonts'

const model = computed(() => getModel(studio.modelId))
const selectedText = computed(() => studio.doc.texts.find((t) => t.id === studio.selectedTextId) ?? null)
const selectedFace = computed(() => model.value.faces.find((f) => f.id === selectedText.value?.faceId) ?? null)
const boundary = computed(() => (selectedText.value ? boundaryMap[selectedText.value.id] : null))

function fitToBoundary() {
  const text = selectedText.value
  const face = selectedFace.value
  if (!text || !face) return
  const padding = 18
  let low = 8
  let high = Math.min(220, face.height * 0.92)

  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2
    const outline = getTextOutline({ ...text, fontSize: mid })
    if (!outline) break
    const fitsWidth = outline.width <= face.width - padding * 2
    const fitsHeight = outline.height <= face.height - padding * 2
    if (fitsWidth && fitsHeight) low = mid
    else high = mid
  }
  updateText(text.id, { fontSize: Math.round(low * 10) / 10, nx: 0.5, ny: 0.5 })
}

function setCenter() {
  if (!selectedText.value) return
  updateText(selectedText.value.id, { nx: 0.5, ny: 0.5 })
}

function onPositionChange(axis: 'nx' | 'ny', value: number) {
  if (!selectedText.value) return
  updateText(selectedText.value.id, { [axis]: value / 100 })
}

function moveSelectedTextToFace(event: Event) {
  if (!selectedText.value) return
  const faceId = (event.target as HTMLSelectElement).value
  updateText(selectedText.value.id, { faceId, nx: 0.5, ny: 0.5 })
  studio.selectedFaceId = faceId
}
</script>

<template>
  <div class="panel-stack">
    <div class="panel-intro">
      <h3>第三步 · 品牌文字排布</h3>
      <p>使用 opentype.js 按字号和当前字距重建真实字形轮廓；拖动、吸附并检查越界。</p>
    </div>

    <div class="button-row">
      <button type="button" class="primary-btn" @click="addText()">＋ 添加文字</button>
      <button type="button" class="secondary-btn" @click="addDemoTexts(12)">放入 12 个压测块</button>
    </div>
    <p v-if="!fontState.ready && !fontState.error" class="notice-box">品牌字体正在加载，轮廓计算即将就绪…</p>
    <p v-if="fontState.error" class="notice-box error">字体加载失败：{{ fontState.error }}。控件仍可编辑，刷新后会重试。</p>

    <div v-if="selectedText && selectedFace" class="text-editor">
      <div class="editor-heading">
        <div>
          <p class="eyebrow">正在编辑</p>
          <h4>{{ selectedFace.name }}</h4>
        </div>
        <button type="button" class="text-danger-btn" @click="removeText(selectedText.id)">删除</button>
      </div>

      <label class="field">
        <span>所属立面（可移动到其他可排版面）</span>
        <select :value="selectedText.faceId" @change="moveSelectedTextToFace">
          <option v-for="face in model.faces.filter((item) => item.textAllowed)" :key="face.id" :value="face.id">
            {{ face.name }}
          </option>
        </select>
      </label>

      <label class="field">
        <span>品牌文案（支持换行）</span>
        <textarea
          :value="selectedText.content"
          rows="2"
          @input="updateText(selectedText.id, { content: ($event.target as HTMLTextAreaElement).value })"
        ></textarea>
      </label>

      <div class="field-grid two">
        <label class="field">
          <span>字体</span>
          <select
            :value="selectedText.fontId"
            @change="updateText(selectedText.id, { fontId: ($event.target as HTMLSelectElement).value as 'noto' | 'montserrat' })"
          >
            <option value="montserrat">Montserrat / 拉丁品牌</option>
            <option value="noto">Noto Sans SC / 中文黑体</option>
          </select>
        </label>
        <label class="field color-field">
          <span>颜色</span>
          <input
            type="color"
            :value="selectedText.color"
            @input="updateText(selectedText.id, { color: ($event.target as HTMLInputElement).value })"
          />
        </label>
      </div>

      <label class="field">
        <span>字号 <b>{{ selectedText.fontSize.toFixed(0) }}</b></span>
        <input
          type="range" min="12" max="180" step="1"
          :value="selectedText.fontSize"
          @input="updateText(selectedText.id, { fontSize: Number(($event.target as HTMLInputElement).value) })"
        />
      </label>

      <label class="field">
        <span>字距 <b>{{ selectedText.letterSpacing.toFixed(1) }}</b></span>
        <input
          type="range" min="-10" max="48" step="0.5"
          :value="selectedText.letterSpacing"
          @input="updateText(selectedText.id, { letterSpacing: Number(($event.target as HTMLInputElement).value) })"
        />
      </label>

      <label class="field">
        <span>行高 <b>{{ selectedText.lineHeight.toFixed(2) }}</b></span>
        <input
          type="range" min="0.85" max="2" step="0.02"
          :value="selectedText.lineHeight"
          @input="updateText(selectedText.id, { lineHeight: Number(($event.target as HTMLInputElement).value) })"
        />
      </label>

      <div class="field-grid two position-inputs">
        <label class="field">
          <span>横向位置 %</span>
          <input type="number" :value="Math.round(selectedText.nx * 100)" @input="onPositionChange('nx', Number(($event.target as HTMLInputElement).value))" />
        </label>
        <label class="field">
          <span>纵向位置 %</span>
          <input type="number" :value="Math.round(selectedText.ny * 100)" @input="onPositionChange('ny', Number(($event.target as HTMLInputElement).value))" />
        </label>
      </div>

      <label class="check-field">
        <input
          type="checkbox"
          :checked="selectedText.bold"
          @change="updateText(selectedText.id, { bold: ($event.target as HTMLInputElement).checked })"
        />
        <span>加粗轮廓（描边补偿）</span>
      </label>

      <div class="button-row">
        <button type="button" class="secondary-btn" @click="setCenter">居中</button>
        <button type="button" class="primary-btn" @click="fitToBoundary">一键贴合边界</button>
        <button type="button" class="secondary-btn" @click="duplicateText(selectedText.id)">复制</button>
      </div>

      <div v-if="boundary?.out" class="boundary-warning">
        <strong>⚠ 文字超出立面边界</strong>
        <span v-if="boundary.overflowX > 0">水平溢出约 {{ boundary.overflowX.toFixed(1) }}cm；</span>
        <span v-if="boundary.overflowY > 0">垂直溢出约 {{ boundary.overflowY.toFixed(1) }}cm。</span>
        <small>可减小字号 / 字距，或点击“一键贴合边界”。</small>
      </div>
      <div v-else class="boundary-ok">✓ 字形轮廓位于当前立面边界内</div>
    </div>

    <div v-else class="notice-box">
      尚未选择文字块。可在展开图中点击文字，或从下方列表选择。
    </div>

    <div class="text-list-card">
      <div class="card-title-row">
        <h5>文字块（{{ studio.doc.texts.length }}）</h5>
        <span>拖动展开图中的文字即可排版</span>
      </div>
      <div class="text-list">
        <button
          v-for="text in studio.doc.texts"
          :key="text.id"
          type="button"
          class="text-row"
          :class="{ active: studio.selectedTextId === text.id, warning: boundaryMap[text.id]?.out }"
          @click="selectText(text.id)"
        >
          <span
            class="text-row-preview"
            :style="{
              color: text.color,
              textShadow: '0 0 2px rgba(255,255,255,.92), 0 1px 3px rgba(15,23,42,.55)',
            }"
          >
            {{ text.content.split('\n')[0] || '空' }}
          </span>
          <span class="text-row-meta">
            <strong>{{ text.content.split('\n')[0] || '空文字' }}</strong>
            <small>{{ model.faces.find(f => f.id === text.faceId)?.name ?? text.faceId }}</small>
          </span>
          <span v-if="boundaryMap[text.id]?.out" class="warning-dot" title="超出边界">!</span>
        </button>
      </div>
    </div>
  </div>
</template>
