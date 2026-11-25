<script setup lang="ts">
import { MAX_BANDS, MIN_BANDS } from '../constants'
import { addBand, project, removeBand, selectedBandId, toggleBandVisible } from '../state/store'
import ParamSlider from './ParamSlider.vue'
import TopMaskEditor from './TopMaskEditor.vue'

function selectBand(id: string): void {
  selectedBandId.value = id
}
</script>

<template>
  <section class="panel-section">
    <div class="section-heading">
      <div>
        <h2>云层面板</h2>
        <p>叠加 2–4 层云带，高度、厚度与密度实时参与遮挡</p>
      </div>
      <span class="badge">{{ project.bands.length }}/{{ MAX_BANDS }}</span>
    </div>

    <div class="band-list">
      <article
        v-for="(band, index) in project.bands"
        :key="band.id"
        class="band-card"
        :class="{ active: selectedBandId === band.id, hidden: !band.visible }"
        @click="selectBand(band.id)"
      >
        <header class="band-card__head">
          <button
            type="button"
            class="eye-button"
            :title="band.visible ? '隐藏云带对比' : '显示云带'"
            :aria-label="band.visible ? `隐藏${band.name}` : `显示${band.name}`"
            @click.stop="toggleBandVisible(band.id)"
          >
            {{ band.visible ? '👁' : '—' }}
          </button>
          <div class="band-card__title">
            <strong>{{ band.name }}</strong>
            <span>Layer {{ index + 1 }} · {{ band.visible ? '可见' : '已隐藏对比' }}</span>
          </div>
          <button
            type="button"
            class="icon-delete"
            title="删除云带"
            :disabled="project.bands.length <= MIN_BANDS"
            @click.stop="removeBand(band.id)"
          >
            ×
          </button>
        </header>

        <div class="slider-stack" @click.stop>
          <ParamSlider
            label="云带高度"
            :model-value="band.altitude"
            :min="8"
            :max="105"
            :step="1"
            unit="m"
            :history-label="`调整${band.name}高度`"
            @update:model-value="band.altitude = $event"
          />
          <ParamSlider
            label="厚度"
            :model-value="band.thickness"
            :min="2"
            :max="28"
            :step="1"
            unit="m"
            :history-label="`调整${band.name}厚度`"
            @update:model-value="band.thickness = $event"
          />
          <ParamSlider
            label="覆盖密度"
            :model-value="band.coverage"
            :min="0"
            :max="1"
            :step="0.01"
            :display="(v) => `${Math.round(v * 100)}%`"
            :history-label="`调整${band.name}覆盖率`"
            @update:model-value="band.coverage = $event"
          />
          <ParamSlider
            label="云体浓度"
            :model-value="band.density"
            :min="0.1"
            :max="1"
            :step="0.01"
            :display="(v) => `${Math.round(v * 100)}%`"
            :history-label="`调整${band.name}浓度`"
            @update:model-value="band.density = $event"
          />
        </div>
      </article>
    </div>

    <button type="button" class="button button--wide button--dashed" :disabled="project.bands.length >= MAX_BANDS" @click="addBand">
      ＋ 添加云带（最多 {{ MAX_BANDS }} 层）
    </button>

    <TopMaskEditor />
  </section>
</template>
