<script setup lang="ts">
import { computed } from 'vue'
import {
  formatNumber,
  setSectionEnabled,
  setSectionFlip,
  setSectionNormal,
  setSectionPosition,
  setViewMode,
  state,
} from '../state/controller'

const range = computed(() => {
  if (!state.organ.original) return 100
  return Math.max(10, Math.hypot(...state.organ.size) / 2)
})

function onPosition(event: Event) {
  setSectionPosition(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div>
    <h2 class="panel-title">剖面查看</h2>
    <p class="panel-desc">可拖动切割平面同时剖切器官和全部病灶，使用三角面—平面求交生成切口轮廓并计算截面积。</p>

    <div class="card">
      <h3><span class="step">切</span>切割平面</h3>
      <label class="check-row" style="margin-top:0;">
        <input type="checkbox" :checked="state.section.enabled" @change="setSectionEnabled(($event.target as HTMLInputElement).checked)" />
        启用剖切（器官与病灶同步裁剪）
      </label>

      <div class="field">
        <div class="field-label"><span>法线方向 / 常用解剖切面</span></div>
        <div class="axis-pad segmented">
          <button class="btn" :class="{ active: state.section.normal[0] === 1 }" @click="setSectionNormal('x')">X 矢状</button>
          <button class="btn" :class="{ active: state.section.normal[1] === 1 }" @click="setSectionNormal('y')">Y 冠状</button>
          <button class="btn" :class="{ active: state.section.normal[2] === 1 }" @click="setSectionNormal('z')">Z 轴位</button>
        </div>
      </div>

      <div class="field">
        <div class="field-label">
          <span>平面位置</span>
          <output>{{ state.section.position.toFixed(1) }} mm</output>
        </div>
        <input
          type="range"
          :min="-range"
          :max="range"
          step="0.5"
          :value="state.section.position"
          :disabled="!state.section.enabled"
          @input="onPosition"
        />
      </div>

      <label class="check-row">
        <input type="checkbox" :checked="state.section.flip" @change="setSectionFlip(($event.target as HTMLInputElement).checked)" />
        翻转保留侧
      </label>

      <p class="card-hint">
        启用后可直接在三维视窗中拖动青色半透明平面或边缘圆球；轮廓和截面积会在拖动时刷新。
      </p>
    </div>

    <div class="card">
      <h3><span class="step">视</span>可见对象</h3>
      <div class="segmented">
        <button class="btn" :class="{ active: state.viewMode === 'all' }" @click="setViewMode('all')">器官 + 病灶</button>
        <button class="btn" :class="{ active: state.viewMode === 'lesions' }" @click="setViewMode('lesions')">只看病灶</button>
        <button class="btn" :class="{ active: state.viewMode === 'organ' }" @click="setViewMode('organ')">只看器官</button>
      </div>
    </div>

    <div class="card">
      <h3><span class="step">面</span>切口轮廓与截面积</h3>
      <div class="stat-grid">
        <div class="stat wide">
          <div class="stat-label">器官切口截面积</div>
          <div class="stat-value" style="color:var(--cyan);">
            {{ state.section.enabled ? formatNumber(state.section.organAreaMm2, 1) : '—' }} <small>mm²</small>
          </div>
        </div>
      </div>
      <div class="kv-line" style="margin-top:10px;"><span style="color:#a5f3fc;">● 青色轮廓</span><strong>器官切口</strong></div>
      <div class="kv-line"><span style="color:var(--green);">● 病灶颜色轮廓</span><strong>对应裁剪形状</strong></div>
      <div class="kv-line"><span style="color:var(--amber);">● 琥珀色轮廓</span><strong>超阈值高亮病灶</strong></div>
      <p class="card-hint">各病灶在当前平面的截面积显示在右侧病灶卡片中，并会随项目文件一起导出。</p>
    </div>
  </div>
</template>
