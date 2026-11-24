<script setup lang="ts">
import { BOOTH_MODELS } from '../data/booths'
import { chooseModel, studio } from '../services/store'

function selectModel(modelId: string) {
  if (modelId === studio.modelId) return
  const ok = window.confirm('切换展台外形会重置当前未保存的配色与文字排布；已保存的三个方案槽不受影响。是否继续？')
  if (ok) chooseModel(modelId)
}
</script>

<template>
  <div class="panel-stack">
    <div class="panel-intro">
      <h3>第一步 · 选择展台外形</h3>
      <p>每种外形自动拆分为数十个立面、台面与顶面，并平铺为展开图。</p>
    </div>

    <div class="model-list">
      <button
        v-for="model in BOOTH_MODELS"
        :key="model.id"
        type="button"
        class="model-card"
        :class="{ active: model.id === studio.modelId }"
        @click="selectModel(model.id)"
      >
        <div class="model-card-top">
          <span class="model-index">{{ BOOTH_MODELS.indexOf(model) + 1 }}</span>
          <div>
            <h4>{{ model.name }}</h4>
            <p>{{ model.tagline }}</p>
          </div>
          <span v-if="model.id === studio.modelId" class="active-pill">当前</span>
        </div>
        <p class="model-desc">{{ model.description }}</p>
        <div class="model-stats">
          <span>{{ model.faceCount }} 个面</span>
          <span>{{ model.textFaceCount }} 个可排文字面</span>
          <span>{{ model.width / 100 }}×{{ model.depth / 100 }}m</span>
        </div>
      </button>
    </div>
  </div>
</template>
