<script setup lang="ts">
import { ref } from 'vue'
import { formatNumber, loadOrganFile, loadSampleOrgan, setSimplifyLevel, state } from '../state/controller'
import { SIMPLIFY_LABELS, SIMPLIFY_RATIOS } from '../lib/geometry'
import type { SimplifyLevel } from '../lib/types'

const input = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)

async function onChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) await loadOrganFile(file)
  target.value = ''
}

async function onDrop(event: DragEvent) {
  dragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) await loadOrganFile(file)
}
</script>

<template>
  <div>
    <h2 class="panel-title">模型载入</h2>
    <p class="panel-desc">读取常见三维网格，自动焊接重复顶点、居中包围盒并建立可用于 Manifold 布尔运算的实体。</p>

    <div
      class="file-drop"
      :class="{ drag: dragOver }"
      @click="input?.click()"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <div class="file-drop-icon">📥</div>
      <strong>点击或拖入网格文件</strong>
      <span>STL / OBJ / PLY / GLB / glTF<br />单文件项目分享请使用右上角“导出标注/报告”</span>
      <input ref="input" class="hidden-input" type="file" accept=".stl,.obj,.ply,.glb,.gltf" @change="onChange" />
    </div>

    <div class="btn-row" style="margin-top: 10px;">
      <button class="btn success block" @click="loadSampleOrgan">生成示例器官</button>
    </div>

    <div v-if="state.organ.status === 'loading'" class="card" style="margin-top:14px;">
      <strong>正在读取并解析模型…</strong>
      <p class="card-hint">大文件的顶点焊接可能需要数秒。</p>
    </div>

    <div v-else-if="state.organ.error" class="card" style="border-color: rgba(251,113,133,.45);">
      <h3>读取失败</h3>
      <p class="card-hint" style="color:#fecdd3;">{{ state.organ.error }}</p>
    </div>

    <template v-if="state.organ.status === 'ready'">
      <div class="card">
        <h3><span class="step">i</span>网格信息</h3>
        <div class="kv-line"><span>文件</span><strong :title="state.organ.name">{{ state.organ.name }}</strong></div>
        <div class="kv-line"><span>格式</span><strong>{{ state.organ.format }}</strong></div>
        <div class="stat-grid" style="margin-top:12px;">
          <div class="stat">
            <div class="stat-label">当前面片数</div>
            <div class="stat-value">{{ state.organ.faceCount.toLocaleString() }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">原始面片数</div>
            <div class="stat-value">{{ state.organ.originalFaceCount.toLocaleString() }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">顶点数</div>
            <div class="stat-value">{{ Math.round(state.organ.vertexCount).toLocaleString() }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">估算器官体积</div>
            <div class="stat-value">{{ formatNumber((state.organ.volumeMm3 ?? 0) / 1000, 1) }}<small>mL</small></div>
          </div>
          <div class="stat wide">
            <div class="stat-label">包围盒尺寸 X × Y × Z（按模型单位，通常视为 mm）</div>
            <div class="stat-value">
              {{ formatNumber(state.organ.size[0], 1) }} × {{ formatNumber(state.organ.size[1], 1) }} × {{ formatNumber(state.organ.size[2], 1) }}
              <small>mm</small>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3><span class="step">简</span>网格简化档位</h3>
        <div class="field">
          <div class="field-label">
            <span>当前档位：{{ SIMPLIFY_LABELS[state.organ.simplifyLevel] }}</span>
            <output>{{ Math.round(SIMPLIFY_RATIOS[state.organ.simplifyLevel] * 100) }}%</output>
          </div>
        <div class="axis-pad" style="grid-template-columns: 1fr 1fr;">
          <button
            v-for="(_, index) in SIMPLIFY_LABELS"
            :key="index"
            class="btn sm"
            :class="{ active: state.organ.simplifyLevel === index }"
            :disabled="state.organ.busy"
            @click="setSimplifyLevel(index as SimplifyLevel)"
          >
            {{ SIMPLIFY_LABELS[index] }} · {{ Math.round(SIMPLIFY_RATIOS[index] * 100) }}%
          </button>
        </div>
          <div class="card-hint">
            档位从原始精度到流畅模式。简化只影响操作网格；若简化结果不适合布尔，会自动回退到原始闭合网格进行 CSG。
          </div>
          <div v-if="state.organ.busy" class="badge warning" style="margin-top:10px;">正在简化…</div>
        </div>
      </div>

      <div class="card">
        <h3><span class="step">CSG</span>布尔实体状态</h3>
        <div class="kv-line"><span>Manifold</span><strong>{{ state.organ.csgStatus }}</strong></div>
        <div class="kv-line"><span>计算来源</span><strong>{{ state.organ.csgSource }}</strong></div>
        <p class="card-hint">
          CT/MRI 重建模型应尽量为水密网格。若状态不是 NoError，显示和剖面仍可用，但病灶—器官精确求交可能受限。
        </p>
      </div>
    </template>
  </div>
</template>
