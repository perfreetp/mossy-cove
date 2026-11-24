<script setup lang="ts">
import { onMounted, watch } from 'vue'
import ModelPanel from './components/ModelPanel.vue'
import MaterialPanel from './components/MaterialPanel.vue'
import TextPanel from './components/TextPanel.vue'
import SchemePanel from './components/SchemePanel.vue'
import UnfoldedCanvas from './components/UnfoldedCanvas.vue'
import ThreePreview from './components/ThreePreview.vue'
import { loadFonts } from './services/fonts'
import { persistState, setStep, studio } from './services/store'

const steps = [
  { title: '展台模型', desc: '选择外形与展开面' },
  { title: '材质配色', desc: '逐面指派并双向联动' },
  { title: '文字排布', desc: '轮廓、字距与边界检查' },
  { title: '方案交付', desc: '三套保存、切换、导入导出' },
]

onMounted(() => {
  void loadFonts()
})

watch(
  () => ({ doc: studio.doc, slots: studio.slots, activeSlot: studio.activeSlot }),
  persistState,
  { deep: true },
)
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">展</div>
        <div>
          <h1>展台焕颜 <span>BoothBrand Studio</span></h1>
          <p>立面展开图配色 · 品牌文字轮廓排布 · 三维外观预演</p>
        </div>
      </div>
      <div class="topbar-badges">
        <span>Vue 3 + TypeScript</span>
        <span>Konva · opentype.js · Three.js</span>
      </div>
    </header>

    <main class="workflow-layout">
      <aside class="sidebar">
        <nav class="steps" aria-label="外观设计流程">
          <button
            v-for="(step, index) in steps"
            :key="step.title"
            type="button"
            class="step-item"
            :class="{ active: studio.step === index, done: studio.step > index }"
            @click="setStep(index)"
          >
            <span class="step-number">{{ studio.step > index ? '✓' : index + 1 }}</span>
            <span>
              <strong>{{ step.title }}</strong>
              <small>{{ step.desc }}</small>
            </span>
          </button>
        </nav>

        <div class="panel-host">
          <ModelPanel v-if="studio.step === 0" />
          <MaterialPanel v-else-if="studio.step === 1" />
          <TextPanel v-else-if="studio.step === 2" />
          <SchemePanel v-else />
        </div>

        <div class="flow-actions">
          <button v-if="studio.step > 0" type="button" class="secondary-btn" @click="setStep(studio.step - 1)">上一步</button>
          <button v-if="studio.step < 3" type="button" class="primary-btn" @click="setStep(studio.step + 1)">下一步</button>
          <button v-else type="button" class="primary-btn" @click="setStep(1)">继续调整配色</button>
        </div>
      </aside>

      <section class="preview-split">
        <UnfoldedCanvas />
        <ThreePreview />
      </section>
    </main>

    <Transition name="toast">
      <div v-if="studio.toast" :key="studio.toast.key" class="toast" :class="studio.toast.tone">
        {{ studio.toast.message }}
      </div>
    </Transition>
  </div>
</template>
