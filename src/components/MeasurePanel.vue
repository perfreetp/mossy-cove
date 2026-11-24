<script setup lang="ts">
import { computed } from 'vue'
import { formatNumber, isHighlighted, mm3ToMl, remeasureAll, setThreshold, state } from '../state/controller'

const thresholdModel = computed({
  get: () => state.thresholdMl,
  set: (value: number) => setThreshold(value),
})

const highlightedLesions = computed(() => state.lesions.filter(isHighlighted))
const totalOccupiedMl = computed(() =>
  state.lesions.reduce((sum, lesion) => sum + (mm3ToMl(lesion.volumeMm3) ?? 0), 0),
)
const readyCount = computed(() => state.lesions.filter((l) => l.measureStatus === 'ready').length)
const activeLesion = computed(() => state.lesions.find((l) => l.id === state.activeLesionId) ?? null)
</script>

<template>
  <div>
    <h2 class="panel-title">体积测量</h2>
    <p class="panel-desc">每个病灶都会与器官执行 Manifold 布尔求交，得到真正位于器官内的部分，再计算体积和占器官比例。</p>

    <div class="card total-card">
      <h3><span class="step">∑</span>测量汇总</h3>
      <div class="total-volume">{{ formatNumber(totalOccupiedMl, 2) }} <small>mL 病灶体积列表求和</small></div>
      <div class="stat-grid" style="margin-top:12px;">
        <div class="stat">
          <div class="stat-label">病灶数量</div>
          <div class="stat-value">{{ state.lesions.length }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">已完成测量</div>
          <div class="stat-value">{{ readyCount }}</div>
        </div>
        <div class="stat wide">
          <div class="stat-label">器官总体积</div>
          <div class="stat-value">{{ formatNumber(mm3ToMl(state.organ.volumeMm3), 1) }} mL</div>
        </div>
      </div>
      <p class="card-hint">若多个病灶空间重叠，列表求和会重复计入；可使用勾画模块的“合并”生成并集病灶。</p>
      <button class="btn block" style="margin-top:10px;" :disabled="!state.lesions.length" @click="remeasureAll">
        重新求交并测量全部
      </button>
    </div>

    <div class="card">
      <h3><span class="step">!</span>体积阈值高亮</h3>
      <div class="field">
        <div class="field-label">
          <span>大于阈值的病灶使用琥珀色高亮材质</span>
          <output>{{ thresholdModel.toFixed(1) }} mL</output>
        </div>
        <input type="range" min="0" max="20" step="0.1" v-model.number="thresholdModel" />
        <input type="number" min="0" max="1000" step="0.1" v-model.number="thresholdModel" style="margin-top:10px;" />
      </div>
      <div class="badge warning">当前 {{ highlightedLesions.length }} 个病灶超过阈值</div>
      <p class="card-hint">阈值改动通过响应式状态同步到所有三维材质和剖面轮廓，无需逐个刷新。</p>
    </div>

    <div v-if="activeLesion" class="card">
      <h3><span class="step">●</span>{{ activeLesion.name }} · 实时数据</h3>
      <div class="kv-line"><span>原始拉伸体积</span><strong>{{ formatNumber(mm3ToMl(activeLesion.rawVolumeMm3), 3) }} mL</strong></div>
      <div class="kv-line"><span>器官内实际体积</span><strong style="color:var(--green)">{{ formatNumber(mm3ToMl(activeLesion.volumeMm3), 3) }} mL</strong></div>
      <div class="kv-line"><span>占器官比例</span><strong>{{ activeLesion.organRatio === null ? '—' : (activeLesion.organRatio * 100).toFixed(2) + '%' }}</strong></div>
      <div class="kv-line"><span>当前剖面截面积</span><strong>{{ formatNumber(activeLesion.sectionAreaMm2, 1) }} mm²</strong></div>
      <div class="kv-line"><span>测量状态</span><strong>{{ activeLesion.measureStatus }}</strong></div>
      <p v-if="activeLesion.measureMessage" class="card-hint">{{ activeLesion.measureMessage }}</p>
      <div v-for="(item, index) in activeLesion.booleanHistory" :key="index" class="history-line">{{ item }}</div>
    </div>
  </div>
</template>
