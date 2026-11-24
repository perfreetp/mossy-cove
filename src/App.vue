<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ViewportStage from './components/ViewportStage.vue';
import {
  CATEGORIES,
  CATEGORY_COLORS,
  getFragment,
  store,
} from './store';
import {
  alignToReferenceAxis,
  deleteFragment,
  exportFullProject,
  exportPoseReport,
  finishPairPicking,
  getViewer,
  handleGeometryFiles,
  handleViewerSelect,
  importProjectFile,
  loadDemoDataset,
  lockSelectedPair,
  newProject,
  persistNow,
  registerSelectedPair,
  removePair,
  scheduleSave,
  setTransformTool,
  splitAssemblyGroup,
  startPairPicking,
  updateViewerSettings,
} from './controller';
import type { FragmentCategory, FragmentRecord, Vec3Tuple } from './types';

const fragmentInput = ref<HTMLInputElement | null>(null);
const projectInput = ref<HTMLInputElement | null>(null);
const targetAxis = ref<'x' | 'y' | 'z'>('y');

const filteredFragments = computed(() => {
  const query = store.filter.trim().toLowerCase();
  return [...store.fragments]
    .filter((fragment) => {
      if (store.categoryFilter !== '全部' && fragment.category !== store.categoryFilter) return false;
      if (!query) return true;
      return [fragment.code, fragment.name, fragment.sourceName, fragment.id]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    })
    .sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true }));
});

const selectedA = computed(() => (store.selectedIds[0] ? getFragment(store.selectedIds[0]) : undefined));
const selectedB = computed(() => (store.selectedIds[1] ? getFragment(store.selectedIds[1]) : undefined));
const activeFragment = computed(() => getFragment(store.activeFragmentId));

const stats = computed(() => ({
  total: store.fragments.length,
  groups: store.groups.length,
  pairs: store.pairs.length,
  triangles: store.fragments.reduce((sum, f) => sum + f.triangleCount, 0),
}));

const saveText = computed(() => {
  if (store.saveState === 'saving') return '本地保存中…';
  if (store.saveState === 'saved' && store.lastSavedAt) {
    return `已自动保存 ${new Date(store.lastSavedAt).toLocaleTimeString('zh-CN')}`;
  }
  if (store.saveState === 'error') return '本地保存失败';
  return '更改将自动保存到此浏览器';
});

const overlapPercent = computed<number>({
  get: () => Number((store.settings.overlapRatioLimit * 100).toFixed(3)),
  set: (value) => {
    store.settings.overlapRatioLimit = Math.max(0.0001, value / 100);
  },
});

watch(
  () => store.settings,
  () => {
    updateViewerSettings();
    scheduleSave();
  },
  { deep: true },
);

watch(
  () => [store.projectName, store.fragments, store.groups, store.pairs],
  () => scheduleSave(900),
  { deep: true },
);

function onFragmentInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  void handleGeometryFiles(files);
  input.value = '';
}

function onProjectInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void importProjectFile(file);
  input.value = '';
}

function onDrop(event: DragEvent): void {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) return;
  const project = files.find((file) => file.name.endsWith('.json') || file.name.endsWith('.bonepack.json'));
  if (project) {
    void importProjectFile(project);
    return;
  }
  void handleGeometryFiles(files);
}

function rowClick(fragment: FragmentRecord, event: MouseEvent): void {
  handleViewerSelect(fragment.id, event.ctrlKey || event.metaKey || event.shiftKey);
}

function onCategoryChange(fragment: FragmentRecord): void {
  fragment.color = CATEGORY_COLORS[fragment.category] ?? fragment.color;
  getViewer()?.setFragmentColor(fragment.id, fragment.color);
  scheduleSave();
}

function toggleVisible(fragment: FragmentRecord, event: MouseEvent): void {
  event.stopPropagation();
  fragment.visible = !fragment.visible;
  getViewer()?.setFragmentVisible(fragment.id, fragment.visible);
  scheduleSave();
}

function removeFragmentClick(fragment: FragmentRecord, event: MouseEvent): void {
  event.stopPropagation();
  if (!window.confirm(`确定删除碎片 ${fragment.code} 吗？相关特征点会一并移除。`)) return;
  deleteFragment(fragment.id);
}

function setOpacity(fragment: FragmentRecord, value: number): void {
  fragment.opacity = value;
  getViewer()?.setFragmentOpacity(fragment.id, value);
  scheduleSave(120);
}

function codeOf(id: string): string {
  return getFragment(id)?.code ?? id.slice(-6);
}

function pairLabel(pair: { aId: string; bId: string }): string {
  return `${codeOf(pair.aId)} ↔ ${codeOf(pair.bId)}`;
}

function chooseAxisAndAlign(): void {
  const axis: Vec3Tuple =
    targetAxis.value === 'x' ? [1, 0, 0] : targetAxis.value === 'z' ? [0, 0, 1] : [0, 1, 0];
  alignToReferenceAxis(axis);
}

async function confirmNew(): Promise<void> {
  if (store.fragments.length && !window.confirm('新建项目会清空当前三维场景和本机自动存档。建议先导出完整项目包，是否继续？')) {
    return;
  }
  await newProject();
}

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if (event.key.toLowerCase() === 'w') setTransformTool('translate');
  if (event.key.toLowerCase() === 'e') setTransformTool('rotate');
  if (event.key.toLowerCase() === 'f') getViewer()?.frameAll();
  if (event.key === 'Escape' && store.pickSession) finishPairPicking();
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template>
  <div class="app-shell" @drop="onDrop">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">骨鉴</div>
        <div>
          <h1>骨骼碎片三维拼接复原工具</h1>
          <p>Forensic Bone Fragment Reassembly · TypeScript / Vue 3 / Three.js / Manifold</p>
        </div>
      </div>

      <input v-model="store.projectName" class="project-name" aria-label="项目名称" @change="scheduleSave()" />

      <div class="top-actions">
        <span class="save-status" :class="store.saveState">{{ saveText }}</span>
        <button class="btn subtle" @click="void persistNow()">立即保存</button>
        <button class="btn subtle" @click="fragmentInput?.click()">导入碎片</button>
        <button class="btn subtle" @click="projectInput?.click()">导入项目包</button>
        <button class="btn primary" @click="exportFullProject">导出分享包</button>
        <button class="btn success" @click="exportPoseReport">导出位姿报告</button>
        <button class="btn danger-ghost" @click="void confirmNew()">新建</button>
      </div>

      <input ref="fragmentInput" type="file" multiple accept=".obj,.stl,.ply" hidden @change="onFragmentInput" />
      <input ref="projectInput" type="file" accept=".json,application/json" hidden @change="onProjectInput" />
    </header>

    <main class="workspace">
      <aside class="panel left-panel">
        <section class="panel-section import-section">
          <h2><span>1</span>碎片导入与编号归类</h2>
          <div class="button-grid">
            <button class="btn primary" @click="fragmentInput?.click()">添加 OBJ/STL/PLY</button>
            <button class="btn" @click="loadDemoDataset(12)">12 块演示</button>
            <button class="btn" @click="loadDemoDataset(300)">300 块压力测试</button>
          </div>
          <p class="hint">也可将文件直接拖入窗口。文件名中的数字会自动识别为编号，并按关键词推断骨骼类别。</p>

          <div class="stats-grid">
            <div><strong>{{ stats.total }}</strong><span>碎片</span></div>
            <div><strong>{{ stats.groups }}</strong><span>拼接组</span></div>
            <div><strong>{{ stats.pairs }}</strong><span>特征点对</span></div>
            <div><strong>{{ Math.round(stats.triangles / 1000) }}k</strong><span>三角面</span></div>
          </div>

          <div class="filter-row">
            <input v-model="store.filter" class="input" placeholder="搜索编号 / 名称" />
            <select v-model="store.categoryFilter" class="input narrow">
              <option>全部</option>
              <option v-for="category in CATEGORIES" :key="category" :value="category">{{ category }}</option>
            </select>
          </div>
        </section>

        <section class="panel-section fragment-list-section">
          <div class="section-title-row">
            <h3>碎片清单</h3>
            <span class="tiny">{{ filteredFragments.length }} / {{ store.fragments.length }}</span>
          </div>

          <div v-if="!filteredFragments.length" class="empty-list">
            暂无碎片。点击“添加”或载入演示数据。
          </div>

          <div class="fragment-list">
            <div
              v-for="fragment in filteredFragments"
              :key="fragment.id"
              class="fragment-row"
              :class="{
                selected: store.selectedIds.includes(fragment.id),
                slotA: store.selectedIds[0] === fragment.id,
                slotB: store.selectedIds[1] === fragment.id,
              }"
              @click="rowClick(fragment, $event)"
            >
              <span class="color-dot" :style="{ background: fragment.color }"></span>
              <div class="fragment-main">
                <div class="fragment-line">
                  <input
                    v-model="fragment.code"
                    class="code-input"
                    aria-label="碎片编号"
                    @click.stop
                    @change="scheduleSave()"
                  />
                  <span v-if="fragment.groupId" class="group-badge" :title="fragment.groupId">
                    组 · {{ store.groups.find((g) => g.id === fragment.groupId)?.name ?? '已锁定' }}
                  </span>
                </div>
                <select
                  v-model="fragment.category"
                  class="category-select"
                  aria-label="骨骼归类"
                  @click.stop
                  @change="onCategoryChange(fragment)"
                >
                  <option v-for="category in CATEGORIES" :key="category" :value="category as FragmentCategory">
                    {{ category }}
                  </option>
                </select>
                <div class="fragment-meta">
                  {{ fragment.vertexCount.toLocaleString() }} 顶点 · {{ Math.round(fragment.triangleCount).toLocaleString() }} 面
                </div>
                <input
                  type="range"
                  min="0.15"
                  max="1"
                  step="0.05"
                  :value="fragment.opacity"
                  class="opacity-range"
                  aria-label="透明度"
                  @click.stop
                  @input="setOpacity(fragment, Number(($event.target as HTMLInputElement).value))"
                />
              </div>
              <div class="row-actions">
                <button class="icon-btn" :title="fragment.visible ? '隐藏碎片' : '显示碎片'" @click="toggleVisible(fragment, $event)">
                  {{ fragment.visible ? '显' : '隐' }}
                </button>
                <button class="icon-btn danger" title="删除碎片" @click="removeFragmentClick(fragment, $event)">
                  删
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="store.groups.length" class="panel-section groups-section">
          <div class="section-title-row"><h3>拼接组</h3></div>
          <div v-for="group in store.groups" :key="group.id" class="group-card">
            <div>
              <strong>{{ group.name }}</strong>
              <p>{{ group.memberIds.map(codeOf).join(' + ') }}</p>
            </div>
            <button class="btn small warning" @click="splitAssemblyGroup(group.id)">拆分</button>
          </div>
        </section>
      </aside>

      <section class="center-panel">
        <ViewportStage />

        <div class="view-toolbar" role="toolbar" aria-label="三维工具">
          <button :class="['tool-btn', { active: store.tool === 'translate' }]" @click="setTransformTool('translate')">
            平移 <kbd>W</kbd>
          </button>
          <button :class="['tool-btn', { active: store.tool === 'rotate' }]" @click="setTransformTool('rotate')">
            旋转 <kbd>E</kbd>
          </button>
          <span class="toolbar-divider"></span>
          <button class="tool-btn" @click="getViewer()?.frameAll()">全景 <kbd>F</kbd></button>
          <button class="tool-btn" @click="getViewer()?.frameSelected()">聚焦选中</button>
        </div>

        <div class="view-toggles">
          <label><input type="checkbox" v-model="store.settings.showGrid" /> 网格</label>
          <label><input type="checkbox" v-model="store.settings.showAxes" /> 坐标轴</label>
          <label><input type="checkbox" v-model="store.settings.deviationArrows" /> 偏差箭头</label>
        </div>

        <div class="view-hud">
          <template v-if="store.pickSession">
            <strong>特征点采集：</strong>
            <span :class="{ 'hud-active': store.pickSession.awaiting === 'a' }">
              A / {{ codeOf(store.pickSession.aId) }}
              {{ store.pickSession.aLocal ? '✓' : '待取点' }}
            </span>
            →
            <span :class="{ 'hud-active': store.pickSession.awaiting === 'b' }">
              B / {{ codeOf(store.pickSession.bId) }} 待取点
            </span>
            <button class="btn tiny" @click="finishPairPicking">完成 (Esc)</button>
          </template>
          <template v-else-if="selectedA && selectedB">
            已选择 <b class="cyan">{{ selectedA.code }}</b> 与 <b class="orange">{{ selectedB.code }}</b>
            ，可采集断口特征点。
          </template>
          <template v-else-if="activeFragment">
            当前对象：<b>{{ activeFragment.code }}</b>
            {{ activeFragment.groupId ? '（拼接组联动模式）' : '（独立碎片）' }}
          </template>
          <template v-else>
            左键选择 / Ctrl+点击多选 · 右键平移 · 滚轮缩放 · 拖动 Gizmo 旋转平移
          </template>
        </div>

        <div v-if="store.busyMessage" class="busy-overlay">
          <div class="spinner"></div>
          <p>{{ store.busyMessage }}</p>
        </div>
      </section>

      <aside class="panel right-panel">
        <section class="panel-section">
          <h2><span>2</span>断口特征点与粗配准</h2>
          <div class="select-slots">
            <div :class="['slot', 'slot-a', { filled: selectedA }]">
              <small>A 基准</small>
              <strong>{{ selectedA?.code ?? '未选择' }}</strong>
            </div>
            <div class="slot-link">⇄</div>
            <div :class="['slot', 'slot-b', { filled: selectedB }]">
              <small>B 贴合</small>
              <strong>{{ selectedB?.code ?? '未选择' }}</strong>
            </div>
          </div>

          <div class="button-grid">
            <button class="btn primary" :disabled="store.selectedIds.length !== 2" @click="startPairPicking">
              添加对应点对
            </button>
            <button class="btn success" :disabled="store.selectedIds.length !== 2" @click="void registerSelectedPair()">
              计算粗配准
            </button>
          </div>
          <p class="hint">至少采集 3 组不共线的对应特征点。系统使用 Kabsch + SVD 求刚体变换，并把 B 贴合到 A。</p>

          <div v-if="store.pairs.length" class="pair-list">
            <div v-for="pair in store.pairs" :key="pair.id" class="pair-row">
              <span>{{ pairLabel(pair) }}</span>
              <button class="icon-btn danger" @click="removePair(pair.id)">×</button>
            </div>
          </div>
        </section>

        <section class="panel-section">
          <h2><span>3</span>锁定、穿插判定与贴合评估</h2>

          <label class="field">
            <span>残差提示阈值（场景单位，通常为 mm）</span>
            <input v-model.number="store.settings.residualThreshold" type="number" min="0.05" step="0.1" class="input" />
          </label>
          <label class="field">
            <span>允许穿插体积占较小碎片比例（%）</span>
            <input v-model.number="overlapPercent" type="number" min="0.01" step="0.05" class="input" />
          </label>

          <button
            class="btn warning wide"
            :disabled="store.selectedIds.length !== 2"
            @click="void lockSelectedPair()"
          >
            Manifold 接触判定并锁定拼接组
          </button>
          <p class="hint">若布尔交集超过阈值，将显示红色交集体并阻止锁定；闭合实体使用真实 WASM 布尔运算。</p>

          <div v-if="store.interference" :class="['report-card', store.interference.blocking ? 'bad' : 'good']">
            <h4>{{ store.interference.blocking ? '检测到穿插 · 已阻止锁定' : '接触判定通过' }}</h4>
            <p>{{ store.interference.message }}</p>
            <div class="report-grid">
              <span>重叠体积</span><b>{{ store.interference.intersectionVolume.toFixed(5) }}</b>
              <span>重叠占比</span><b>{{ (store.interference.overlapRatio * 100).toFixed(3) }}%</b>
              <span>最小间隙</span><b>{{ store.interference.minGap.toFixed(3) }}</b>
              <span>Manifold 实体</span><b>{{ store.interference.manifold ? '成功' : '失败/非流形' }}</b>
            </div>
          </div>

          <div v-if="store.report" :class="['report-card', store.report.acceptable ? 'good' : 'bad']">
            <h4>
              贴合度：{{ store.report.acceptable ? '通过阈值' : '残差超限' }}
              <em>RMS {{ store.report.rms.toFixed(3) }}</em>
            </h4>
            <div class="report-grid">
              <span>特征点对</span><b>{{ store.report.pairCount }}</b>
              <span>平均残差</span><b>{{ store.report.meanResidual.toFixed(3) }}</b>
              <span>最大残差</span><b>{{ store.report.maxResidual.toFixed(3) }}</b>
              <span>阈值</span><b>{{ store.report.threshold.toFixed(3) }}</b>
            </div>
            <div class="residual-list">
              <div v-for="(residual, index) in store.report.residuals" :key="residual.pairId" class="residual-row">
                <span>点 {{ index + 1 }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    :class="{ over: residual.overThreshold }"
                    :style="{ width: `${Math.min(100, (residual.distance / Math.max(store.report?.threshold || 1, residual.distance)) * 100)}%` }"
                  ></div>
                </div>
                <b :class="{ 'text-danger': residual.overThreshold }">{{ residual.distance.toFixed(3) }}</b>
              </div>
            </div>
          </div>
        </section>

        <section class="panel-section">
          <h2><span>4</span>参考轴线整体校正</h2>
          <p class="hint">从当前参考碎片顶点协方差提取 PCA 主轴线，将全部碎片/拼接组绕同一中心旋转到目标轴。</p>
          <div class="axis-row">
            <label><input type="radio" value="x" v-model="targetAxis" /> X 轴</label>
            <label><input type="radio" value="y" v-model="targetAxis" /> Y 轴</label>
            <label><input type="radio" value="z" v-model="targetAxis" /> Z 轴</label>
          </div>
          <button class="btn primary wide" :disabled="!activeFragment" @click="chooseAxisAndAlign">
            以 {{ activeFragment?.code ?? '当前碎片' }} 为参考并整体校正
          </button>
        </section>

        <section class="panel-section">
          <h2><span>5</span>复原结果分享与导出</h2>
          <p class="hint">
            完整项目包内嵌几何 Base64、编号归类、特征点、最终本地姿态和组结构，可分享给另一台浏览器继续复原。
            位姿报告输出每个碎片的世界矩阵、四元数、欧拉角和拼接组成员关系。
          </p>
          <div class="button-grid">
            <button class="btn primary" @click="exportFullProject">导出完整项目包</button>
            <button class="btn success" @click="exportPoseReport">导出最终位姿 JSON</button>
          </div>
          <div class="local-status">
            <span :class="['status-dot', store.manifoldReady ? 'online' : 'waiting']"></span>
            Manifold WASM：{{ store.manifoldReady ? '已就绪' : '加载中' }} · IndexedDB 本地存储
          </div>
        </section>
      </aside>
    </main>

    <div class="toast-stack" aria-live="polite">
      <div v-for="message in store.toasts" :key="message.id" :class="['toast', message.type]">
        {{ message.message }}
      </div>
    </div>
  </div>
</template>
