<script setup lang="ts">
import { RELIEF_OPTIONS, HEIGHT_RES } from '../constants'
import { history, project, regenerateTerrainNow, requestTerrainRegeneration } from '../state/store'
import type { ReliefStyle, TerrainParams } from '../types'
import ParamSlider from './ParamSlider.vue'

const terrain = project

function updateNumber(key: 'ridgeHeight' | 'frequency' | 'erosion', value: number): void {
  project.value.terrain[key] = value
  if (key !== 'ridgeHeight') requestTerrainRegeneration()
}

function chooseStyle(style: ReliefStyle): void {
  if (project.value.terrain.style === style) return
  history.run('切换起伏风格', () => {
    project.value.terrain.style = style
    regenerateTerrainNow()
  })
}

function randomizeSeed(): void {
  history.run('生成新山地', () => {
    project.value.terrain.seed = Math.floor(Math.random() * 2_000_000_000) + 1
    regenerateTerrainNow()
  })
}

function onSeedPointerDown(): void {
  history.begin()
}

function onSeedInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) {
    project.value.terrain.seed = Math.max(1, Math.round(value))
    requestTerrainRegeneration()
  }
}

function commitSeed(): void {
  history.commit('修改地形种子')
}

function param(key: keyof TerrainParams): number {
  return project.value.terrain[key] as number
}

const quadCount = (HEIGHT_RES - 1) ** 2
const triangleCount = quadCount * 2
</script>

<template>
  <section class="panel-section">
    <div class="section-heading">
      <div>
        <h2>地形面板</h2>
        <p>调整山脊尺度并生成可侵蚀的连绵高度场</p>
      </div>
      <span class="badge">{{ HEIGHT_RES }}²</span>
    </div>

    <div class="style-grid" role="radiogroup" aria-label="起伏风格">
      <button
        v-for="option in RELIEF_OPTIONS"
        :key="option.value"
        type="button"
        class="style-card"
        :class="{ active: terrain.terrain.style === option.value }"
        role="radio"
        :aria-checked="terrain.terrain.style === option.value"
        :title="option.hint"
        @click="chooseStyle(option.value)"
      >
        <span class="style-card__title">{{ option.label }}</span>
        <span class="style-card__hint">{{ option.hint }}</span>
      </button>
    </div>

    <div class="slider-stack">
      <ParamSlider
        label="山脊高度"
        :model-value="param('ridgeHeight')"
        :min="18"
        :max="120"
        :step="1"
        unit="m"
        history-label="调整山脊高度"
        @update:model-value="updateNumber('ridgeHeight', $event)"
      />
      <ParamSlider
        label="起伏频率"
        :model-value="param('frequency')"
        :min="0.65"
        :max="3"
        :step="0.05"
        history-label="调整起伏频率"
        @update:model-value="updateNumber('frequency', $event)"
      />
      <ParamSlider
        label="侵蚀强度"
        :model-value="param('erosion')"
        :min="0"
        :max="1"
        :step="0.01"
        :display="(v) => `${Math.round(v * 100)}%`"
        history-label="调整侵蚀强度"
        @update:model-value="updateNumber('erosion', $event)"
      />
    </div>

    <div class="seed-row">
      <label class="seed-field">
        <span>随机种子</span>
        <input
          type="number"
          min="1"
          max="2147483647"
          :value="terrain.terrain.seed"
          @pointerdown="onSeedPointerDown"
          @focus="onSeedPointerDown"
          @input="onSeedInput"
          @change="commitSeed"
          @blur="commitSeed"
        />
      </label>
      <button type="button" class="button button--primary" @click="randomizeSeed">
        ⟳ 生成山地
      </button>
    </div>

    <div class="stats-box">
      <div><strong>{{ quadCount.toLocaleString() }}</strong><span>地形四边形</span></div>
      <div><strong>{{ triangleCount.toLocaleString() }}</strong><span>三角面</span></div>
      <div><strong>{{ project.bands.length * 3 }}</strong><span>云层面片</span></div>
    </div>
    <p class="fine-print">高度场以 {{ HEIGHT_RES }}×{{ HEIGHT_RES }} 采样；拖动高度只更新顶点，频率与侵蚀使用 45ms 合并重算。</p>
  </section>
</template>
