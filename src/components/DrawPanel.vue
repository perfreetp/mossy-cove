<script setup lang="ts">
import {
  applyBoolean,
  clearDraftPoints,
  createLesionFromDraft,
  startNewContour,
  state,
  undoDraftPoint,
  updateSmoothing,
  updateThickness,
} from '../state/controller'

function onThickness(event: Event) {
  updateThickness(Number((event.target as HTMLInputElement).value))
}
function onSmoothing(event: Event) {
  updateSmoothing(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div>
    <h2 class="panel-title">病灶勾画</h2>
    <p class="panel-desc">在器官表面依次点击控制点，形成闭合轮廓后沿表面平均法向拉伸为病灶实体。</p>

    <div class="card">
      <h3><span class="step">1</span>表面控制点</h3>
      <div class="btn-row">
        <button class="btn primary" :disabled="!state.organ.original" @click="startNewContour">
          {{ state.drawMode ? '勾画中…点击表面加点' : '开始/新建勾画' }}
        </button>
      </div>
      <div class="btn-row" style="margin-top:8px;">
        <button class="btn sm" :disabled="!state.draftPoints.length" @click="undoDraftPoint">撤销一点</button>
        <button class="btn sm danger" :disabled="!state.draftPoints.length" @click="clearDraftPoints">清空</button>
        <button
          class="btn sm success"
          :disabled="state.draftPoints.length < 3"
          @click="createLesionFromDraft"
        >
          闭合拉伸出病灶
        </button>
      </div>
      <p class="card-hint">
        当前控制点：<b style="color:var(--amber)">{{ state.draftPoints.length }}</b>。
        控制点按点击顺序连接；可旋转视角后继续点击，法线会自动取各点表面法线平均值。
      </p>
    </div>

    <div class="card">
      <h3><span class="step">2</span>拉伸与边缘圆滑</h3>
      <div class="field">
        <div class="field-label">
          <span>拉伸厚度</span>
          <output>{{ state.drawThickness.toFixed(1) }} mm</output>
        </div>
        <input type="range" min="2" max="60" step="0.5" :value="state.drawThickness" @input="onThickness" />
      </div>
      <div class="field">
        <div class="field-label">
          <span>边缘圆滑档位</span>
          <output>{{ ['锐利', '轻度', '标准', '高圆滑'][state.drawSmoothing] }}</output>
        </div>
        <input type="range" min="0" max="3" step="1" :value="state.drawSmoothing" @input="onSmoothing" />
        <p class="card-hint">
          圆滑通过倒角分段实现。若选中了已有病灶，拖动滑杆会按其原始控制点实时重建；曾做过布尔运算的病灶将回到轮廓实体。
        </p>
      </div>
    </div>

    <div class="card">
      <h3><span class="step">3</span>已有病灶布尔操作</h3>
      <div v-if="state.lesions.length < 2" class="card-hint">至少创建两个病灶后可执行合并或求差。</div>
      <template v-else>
        <div class="field">
          <div class="field-label"><span>目标病灶 A</span></div>
          <select v-model="state.booleanTargetId">
            <option v-for="lesion in state.lesions" :key="lesion.id" :value="lesion.id">{{ lesion.name }}</option>
          </select>
        </div>
        <div class="field">
          <div class="field-label"><span>参与病灶 B</span></div>
          <select v-model="state.booleanToolId">
            <option v-for="lesion in state.lesions" :key="lesion.id" :value="lesion.id">{{ lesion.name }}</option>
          </select>
        </div>
        <label class="check-row">
          <input type="checkbox" v-model="state.keepBooleanOperand" />
          运算后保留参与病灶 B（默认移除，避免体积重复统计）
        </label>
        <div class="btn-row">
          <button class="btn primary" @click="applyBoolean('union')">合并 A ∪ B</button>
          <button class="btn warning" @click="applyBoolean('difference')">求差 A − B</button>
        </div>
        <p class="card-hint">布尔运算由 manifold-3d/WASM 执行，结果会立即重新与器官求交并更新体积。</p>
      </template>
    </div>
  </div>
</template>
