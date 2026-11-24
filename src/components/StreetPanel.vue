<script setup lang="ts">
import { computed } from 'vue'
import {
  beginStreetDrawing,
  cancelStreetDrawing,
  deleteStreet,
  finishStreetDrawing,
  relayoutStreetBuildings,
  runCommand,
  store
} from '../state/store'

const activeStreet = computed(() => store.streets.find((s) => s.id === store.activeStreetId) ?? null)

function startDraw() {
  beginStreetDrawing()
}

function relayoutActive() {
  if (!activeStreet.value) return
  const id = activeStreet.value.id
  runCommand('街道重排', () => relayoutStreetBuildings(id))
}
</script>

<template>
  <section class="panel street-panel" aria-label="街道编辑">
    <header class="panel-header">
      <div>
        <h2>街道编辑</h2>
        <p>画折线，建筑自动朝街并保持退距</p>
      </div>
      <span class="badge street-count">{{ store.streets.length }}</span>
    </header>

    <div class="street-actions">
      <button v-if="!store.drawingStreet" class="btn primary" type="button" @click="startDraw">＋ 绘制街道折线</button>
      <template v-else>
        <button class="btn success" type="button" @click="finishStreetDrawing">完成折线</button>
        <button class="btn ghost" type="button" @click="cancelStreetDrawing">取消</button>
      </template>
      <button class="btn" type="button" :disabled="!activeStreet" @click="relayoutActive">两侧重排</button>
    </div>

    <div v-if="store.drawingStreet" class="notice">
      在场景地面单击添加折点；双击或点击“完成折线”结束。折点按 {{ store.settings.gridSize }} 网格吸附。
    </div>

    <div v-if="activeStreet" class="street-detail">
      <label class="field">
        <span>当前街道</span>
        <input v-model="activeStreet.name" class="text-input" type="text" />
      </label>
      <div class="street-meta">
        <span>折点 <b>{{ activeStreet.points.length }}</b></span>
        <span>路宽 <b>{{ activeStreet.width.toFixed(1) }}</b></span>
        <span>固定退距 <b>{{ activeStreet.setback.toFixed(1) }}</b></span>
      </div>
      <p class="tip">拖动场景中的橙色手柄修改折线，两侧绑定建筑会整体重排。</p>
    </div>

    <div class="street-list">
      <button
        v-for="street in store.streets"
        :key="street.id"
        type="button"
        class="street-item"
        :class="{ active: street.id === store.activeStreetId }"
        @click="store.activeStreetId = street.id"
      >
        <span class="street-color" :style="{ background: street.color }"></span>
        <span class="street-name">{{ street.name }}</span>
        <small>{{ street.points.length }} 点</small>
        <span
          class="icon-delete"
          role="button"
          tabindex="0"
          title="删除街道并解除沿街绑定"
          @click.stop="deleteStreet(street.id)"
          @keydown.enter.stop="deleteStreet(street.id)"
        >×</span>
      </button>
      <p v-if="!store.streets.length" class="empty-inline">还没有街道，点击上方按钮开始绘制。</p>
    </div>
  </section>
</template>
