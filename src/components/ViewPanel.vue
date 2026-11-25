<script setup lang="ts">
import { sceneManagerRef } from '../babylon/bridge'
import { viewState } from '../state/viewState'

function scrub(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value) / 1000
  viewState.progress = value
  viewState.playing = false
  if (sceneManagerRef.value) {
    sceneManagerRef.value.playing = false
    sceneManagerRef.value.setPathProgress(value)
  }
}

function togglePlay(): void {
  viewState.playing = !viewState.playing
  if (sceneManagerRef.value) sceneManagerRef.value.playing = viewState.playing
}

function updateSpeed(event: Event): void {
  viewState.speed = Number((event.target as HTMLInputElement).value)
  if (sceneManagerRef.value) sceneManagerRef.value.speed = viewState.speed
}

function togglePath(): void {
  viewState.showPath = !viewState.showPath
  sceneManagerRef.value?.setPathVisible(viewState.showPath)
}

function resetView(): void {
  viewState.playing = false
  viewState.progress = 0
  if (sceneManagerRef.value) {
    sceneManagerRef.value.playing = false
    sceneManagerRef.value.speed = viewState.speed
    sceneManagerRef.value.resetView()
  }
}
</script>

<template>
  <section class="panel-section">
    <div class="section-heading">
      <div>
        <h2>视角联动</h2>
        <p>沿空中相机路径巡航，观察山脊与云带的层次重排</p>
      </div>
    </div>

    <div class="path-control">
      <div class="path-control__top">
        <button type="button" class="button button--primary" @click="togglePlay">
          {{ viewState.playing ? '⏸ 暂停巡航' : '▶ 播放巡航' }}
        </button>
        <button type="button" class="button" @click="resetView">重置视角</button>
      </div>

      <label class="path-scrub">
        <span>路径位置 <b>{{ Math.round(viewState.progress * 100) }}%</b></span>
        <input
          type="range"
          min="0"
          max="1000"
          step="1"
          :value="Math.round(viewState.progress * 1000)"
          @input="scrub"
        />
      </label>

      <label class="mini-slider">
        <span>巡航速度 <b>{{ viewState.speed.toFixed(1) }}×</b></span>
        <input type="range" min="0.4" max="2.4" step="0.1" :value="viewState.speed" @input="updateSpeed" />
      </label>

      <label class="toggle-row">
        <input type="checkbox" :checked="viewState.showPath" @change="togglePath" />
        <span>显示空中相机路径与视点标记</span>
      </label>
    </div>

    <div class="order-card">
      <h3>当前云带渲染顺序（远 → 近）</h3>
      <ol v-if="viewState.order.length">
        <li v-for="(item, index) in viewState.order" :key="item.id">
          <span class="order-index">{{ index + 1 }}</span>
          <strong>{{ item.name }}</strong>
          <span class="order-distance">{{ item.distance }} m</span>
        </li>
      </ol>
      <p v-else class="fine-print">云带全部隐藏时无透明排序对象。</p>
    </div>

    <div class="hint-card">
      <strong>遮挡如何生效？</strong>
      <p>地形是写入深度的不透明网格；云片开启深度测试。相机移动或云带高度变化后，GPU 逐像素判断山体是否更近，同时透明云片按相机距离从远到近混合。</p>
      <p>在主视口可左键旋转、滚轮缩放、右键平移。</p>
    </div>
  </section>
</template>
