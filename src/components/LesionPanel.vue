<script setup lang="ts">
import { computed } from 'vue'
import {
  deleteLesion,
  formatNumber,
  isHighlighted,
  mm3ToMl,
  selectLesion,
  setLesionColor,
  state,
  toggleLesionVisibility,
} from '../state/controller'

const sortedLesions = computed(() =>
  [...state.lesions].sort((a, b) => {
    const av = a.volumeMm3 ?? -1
    const bv = b.volumeMm3 ?? -1
    return bv - av
  }),
)

function ratioWidth(ratio: number | null): string {
  if (!ratio || ratio <= 0) return '0%'
  return `${Math.min(100, ratio * 100 * 8).toFixed(1)}%`
}
</script>

<template>
  <div>
    <h2 class="panel-title">病灶列表与报告</h2>
    <p class="panel-desc">点击卡片选中病灶，可修改颜色、查看体积比例和当前剖面面积。导出时这些数据会一并写入项目文件。</p>

    <div v-if="!state.lesions.length" class="card">
      <h3>暂无病灶</h3>
      <p class="card-hint">前往“病灶勾画”，在器官表面放置至少 3 个控制点并闭合拉伸。也可以先使用示例器官熟悉流程。</p>
    </div>

    <div class="lesion-list">
      <article
        v-for="lesion in sortedLesions"
        :key="lesion.id"
        class="lesion-item"
        :class="{ active: lesion.id === state.activeLesionId, highlight: isHighlighted(lesion) }"
        :style="{ '--lesion-color': isHighlighted(lesion) ? '#fbbf24' : lesion.color }"
        @click="selectLesion(lesion.id)"
      >
        <div class="lesion-head">
          <i class="color-dot"></i>
          <strong class="lesion-name">{{ lesion.name }}</strong>
          <label @click.stop>
            <input
              type="color"
              :value="lesion.color"
              :disabled="isHighlighted(lesion)"
              title="病灶颜色（超阈值时由高亮材质接管）"
              @input="setLesionColor(lesion.id, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <button class="icon-mini" :title="lesion.visible ? '隐藏' : '显示'" @click.stop="toggleLesionVisibility(lesion.id)">
            {{ lesion.visible ? '👁' : '—' }}
          </button>
          <button class="icon-mini danger" title="删除" @click.stop="deleteLesion(lesion.id)">×</button>
        </div>

        <div class="lesion-tags">
          <span v-if="isHighlighted(lesion)" class="badge warning">超阈值高亮</span>
          <span class="badge" :class="lesion.measureStatus === 'ready' ? 'success' : lesion.measureStatus === 'error' ? 'error' : 'info'">
            {{ lesion.measureStatus === 'calculating' ? '测量中' : lesion.measureStatus === 'ready' ? '已求交' : lesion.measureStatus === 'error' ? '需注意' : '待测量' }}
          </span>
          <span v-if="lesion.booleanHistory.length" class="badge info">布尔 ×{{ lesion.booleanHistory.length }}</span>
        </div>

        <div class="lesion-metrics">
          <div class="metric">
            <div class="metric-label">器官内体积</div>
            <div class="metric-value">{{ formatNumber(mm3ToMl(lesion.volumeMm3), 3) }} mL</div>
          </div>
          <div class="metric">
            <div class="metric-label">占器官比例</div>
            <div class="metric-value">{{ lesion.organRatio === null ? '—' : (lesion.organRatio * 100).toFixed(2) + '%' }}</div>
          </div>
          <div class="metric">
            <div class="metric-label">原始体积</div>
            <div class="metric-value">{{ formatNumber(mm3ToMl(lesion.rawVolumeMm3), 3) }} mL</div>
          </div>
          <div class="metric">
            <div class="metric-label">剖面面积</div>
            <div class="metric-value">{{ formatNumber(lesion.sectionAreaMm2, 1) }} mm²</div>
          </div>
        </div>

        <div class="progress"><span :style="{ width: ratioWidth(lesion.organRatio), background: isHighlighted(lesion) ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : undefined }"></span></div>
      </article>
    </div>
  </div>
</template>
