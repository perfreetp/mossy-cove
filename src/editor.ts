import { derived, get, writable, type Readable, type Writable } from 'svelte/store';
import { SceneEngine, type InteractionMode } from './babylon/sceneEngine';
import {
  TerrainModel,
  DEFAULT_TERRAIN_PARAMS,
  type TerrainParams
} from './lib/noise';
import {
  distributeCloudsAlongRidges,
  nextCloudId,
  radiusFromTiers,
  refreshCloudDerived,
  resolveCloudSeparation,
  type CloudBlob,
  type CloudSceneState,
  type CloudTier
} from './lib/clouds';
import { LIGHTING_ORDER, type LightingPresetId } from './lib/lighting';
import { HistoryStack, type UndoableAction } from './lib/history';
import {
  buildSerializedScene,
  downloadSceneFile,
  loadSceneLocal,
  parseSceneFile,
  saveSceneLocal,
  type BrushSettings,
  type SerializedScene
} from './lib/storage';
import { RNG, clamp } from './lib/mathUtils';

const DEFAULT_BRUSH: BrushSettings = { radius: 22, strength: 6, mode: 'raise' };
const DEFAULT_CLOUD_COUNT = 26;
const AUTOSAVE_DELAY = 500;

export class EditorStore {
  terrainModel: TerrainModel;
  history = new HistoryStack();

  // Svelte 响应式状态
  terrainParams: Writable<TerrainParams>;
  cloudState: Writable<CloudSceneState>;
  lighting: Writable<LightingPresetId>;
  brush: Writable<BrushSettings>;
  mode: Writable<InteractionMode>;
  selectedId: Writable<string | null>;
  canUndo: Writable<boolean>;
  canRedo: Writable<boolean>;
  historyLabel: Writable<string | null>;
  cloudCount: Writable<number>;
  ready: Writable<boolean>;

  private engine: SceneEngine | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const saved = loadSceneLocal();
    const terrainParams = saved?.terrainParams ?? { ...DEFAULT_TERRAIN_PARAMS };
    this.terrainModel = new TerrainModel(terrainParams);

    let blobs: CloudBlob[] = [];
    let cling = 0.35;
    if (saved) {
      this.terrainModel.brushMap.set(Float32Array.from(saved.brushMap));
      blobs = saved.clouds.map((b) => ({ ...b }));
      cling = saved.cling;
    } else {
      blobs = distributeCloudsAlongRidges(
        this.terrainModel,
        DEFAULT_CLOUD_COUNT,
        terrainParams.seed
      );
    }
    refreshCloudDerived(blobs, cling);

    this.terrainParams = writable(terrainParams);
    this.cloudState = writable({ blobs, cling });
    this.lighting = writable(saved?.lighting ?? 'noon');
    this.brush = writable(saved?.brush ?? { ...DEFAULT_BRUSH });
    this.mode = writable('camera');
    this.selectedId = writable(null);
    this.canUndo = writable(false);
    this.canRedo = writable(false);
    this.historyLabel = writable(null);
    this.cloudCount = writable(blobs.length);
    this.ready = writable(false);

    this.history.onChange = () => this.refreshHistoryFlags();
  }

  // ------------------------------------------------------------- 生命周期

  attach(canvas: HTMLCanvasElement): void {
    if (this.engine) return;
    const engine = new SceneEngine(canvas, this.terrainModel, {
      onBrushCommit: (before, after) => this.commitBrush(before, after),
      onCloudDragCommit: (id, before, after) => this.commitCloudDrag(id, before, after),
      onCloudDragMove: (id, x, z) => this.syncCloudMoveLive(id, x, z),
      onSelectionChange: (id) => this.selectedId.set(id)
    });
    this.engine = engine;
    const state = get(this.cloudState);
    engine.setClouds(state.blobs, state.cling);
    engine.setLightingInitial(get(this.lighting));
    engine.setBrushSettings(get(this.brush).radius, get(this.brush).strength, get(this.brush).mode);
    engine.setMode(get(this.mode));
    this.ready.set(true);
  }

  detach(): void {
    this.engine?.dispose();
    this.engine = null;
    this.ready.set(false);
  }

  private refreshHistoryFlags(): void {
    this.canUndo.set(this.history.canUndo());
    this.canRedo.set(this.history.canRedo());
    this.historyLabel.set(this.history.lastLabel);
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.persist(), AUTOSAVE_DELAY);
  }

  persist(): void {
    saveSceneLocal(
      buildSerializedScene(
        get(this.terrainParams),
        this.terrainModel.brushMap,
        get(this.cloudState),
        get(this.lighting),
        get(this.brush)
      )
    );
  }

  // ------------------------------------------------------------- 地形参数

  /** 滑杆拖动中的高频实时刷新：更新模型与视图，但不写历史。 */
  applyTerrainLive(params: TerrainParams): void {
    this.terrainParams.set({ ...params });
    this.terrainModel.rebuildBase(params);
    this.engine?.terrainRebuilt();
  }

  /** 一次滑杆编辑结束：在拖动前快照与当前状态之间提交一条历史。 */
  commitTerrainChange(before: TerrainParams): void {
    const after = { ...get(this.terrainParams) };
    if (
      before.relief === after.relief &&
      before.fragmentation === after.fragmentation &&
      before.baseHeight === after.baseHeight &&
      before.seed === after.seed
    ) {
      return;
    }
    const changedKey = (Object.keys(after) as (keyof TerrainParams)[]).find(
      (k) => before[k] !== after[k]
    )!;
    this.history.commit({
      label: `地形参数·${terrainParamLabel(changedKey)}`,
      undo: () => {
        this.terrainParams.set({ ...before });
        this.terrainModel.rebuildBase(before);
        this.engine?.terrainRebuilt();
        this.scheduleAutosave();
      },
      redo: () => {
        this.terrainParams.set({ ...after });
        this.terrainModel.rebuildBase(after);
        this.engine?.terrainRebuilt();
        this.scheduleAutosave();
      }
    });
    this.refreshHistoryFlags();
    this.scheduleAutosave();
  }

  setTerrainParam<K extends keyof TerrainParams>(key: K, value: TerrainParams[K]): void {
    const before = { ...get(this.terrainParams) };
    const next = { ...before, [key]: value };
    this.applyTerrainLive(next);
    this.commitTerrainChange(before);
  }

  regenerateSeed(): void {
    const before = { ...get(this.terrainParams) };
    const seed = (Math.floor(Math.random() * 0xffffffff) + 1) >>> 0;
    const after = { ...before, seed };
    this.terrainParams.set(after);
    this.terrainModel.rebuildBase(after);
    this.engine?.terrainRebuilt();
    this.history.commit({
      label: '重新生成地形种子',
      undo: () => {
        this.terrainParams.set({ ...before });
        this.terrainModel.rebuildBase(before);
        this.engine?.terrainRebuilt();
      },
      redo: () => {
        this.terrainParams.set({ ...after });
        this.terrainModel.rebuildBase(after);
        this.engine?.terrainRebuilt();
      }
    });
    this.refreshHistoryFlags();
    this.scheduleAutosave();
  }

  // ------------------------------------------------------------- 笔刷

  setBrushRadius(radius: number): void {
    this.brush.update((b) => ({ ...b, radius: clamp(radius, 4, 60) }));
    const b = get(this.brush);
    this.engine?.setBrushSettings(b.radius, b.strength, b.mode);
    this.scheduleAutosave();
  }

  setBrushStrength(strength: number): void {
    this.brush.update((b) => ({ ...b, strength: clamp(strength, 1, 20) }));
    const b = get(this.brush);
    this.engine?.setBrushSettings(b.radius, b.strength, b.mode);
    this.scheduleAutosave();
  }

  setBrushMode(mode: 'raise' | 'lower'): void {
    this.brush.update((b) => ({ ...b, mode }));
    const b = get(this.brush);
    this.engine?.setBrushSettings(b.radius, b.strength, b.mode);
    this.scheduleAutosave();
  }

  private commitBrush(before: Float32Array, after: Float32Array): void {
    this.history.commit({
      label: '笔刷地形修改',
      undo: () => this.restoreBrushMap(before),
      redo: () => this.restoreBrushMap(after)
    });
    this.refreshHistoryFlags();
    this.scheduleAutosave();
  }

  private restoreBrushMap(map: Float32Array): void {
    this.terrainModel.brushMap.set(map);
    // 全图重算：历史记录不携带 patch bounds，直接全量刷新，数万顶点仍在预算内
    this.engine?.terrainRebuilt();
    this.scheduleAutosave();
  }

  // ------------------------------------------------------------- 云团

  private blobs(): CloudBlob[] {
    return get(this.cloudState).blobs;
  }

  /** 贴合程度滑杆拖动中的实时刷新（不入历史）。 */
  setClingLive(cling: number): void {
    const blobs = this.blobs();
    refreshCloudDerived(blobs, cling);
    this.cloudState.set({ blobs: blobs.map((b) => ({ ...b })), cling });
    this.engine?.setCling(cling);
  }

  /** 贴合程度滑杆松手：提交一条历史。 */
  commitClingChange(beforeCling: number): void {
    const cling = get(this.cloudState).cling;
    if (Math.abs(cling - beforeCling) < 1e-9) return;
    const blobs = this.blobs();
    this.history.commit({
      label: '云层贴合程度',
      undo: () => {
        refreshCloudDerived(blobs, beforeCling);
        this.cloudState.set({ blobs: blobs.map((b) => ({ ...b })), cling: beforeCling });
        this.engine?.setCling(beforeCling);
        this.scheduleAutosave();
      },
      redo: () => {
        refreshCloudDerived(blobs, cling);
        this.cloudState.set({ blobs: blobs.map((b) => ({ ...b })), cling });
        this.engine?.setCling(cling);
        this.scheduleAutosave();
      }
    });
    this.refreshHistoryFlags();
    this.scheduleAutosave();
  }

  setCling(cling: number): void {
    const before = get(this.cloudState).cling;
    this.setClingLive(cling);
    this.commitClingChange(before);
  }

  setCloudCount(count: number): void {
    const target = clamp(Math.round(count), 4, 80);
    const before = this.blobs().map((b) => ({ ...b }));
    const seed = get(this.terrainParams).seed;
    const next = distributeCloudsAlongRidges(this.terrainModel, target, seed ^ 0x9e3779b9, before);
    const cling = get(this.cloudState).cling;
    refreshCloudDerived(next, cling);
    this.cloudState.set({ blobs: next, cling });
    this.cloudCount.set(next.length);
    this.engine?.setClouds(next, cling);
    this.scheduleAutosave();
    this.history.commit({
      label: `云团数量 ${target}`,
      undo: () => {
        const blobs = before.map((b) => ({ ...b }));
        refreshCloudDerived(blobs, cling);
        this.cloudState.set({ blobs, cling });
        this.cloudCount.set(blobs.length);
        this.engine?.setClouds(blobs, cling);
      },
      redo: () => {
        const blobs = next.map((b) => ({ ...b }));
        refreshCloudDerived(blobs, cling);
        this.cloudState.set({ blobs, cling });
        this.cloudCount.set(blobs.length);
        this.engine?.setClouds(blobs, cling);
      }
    });
    this.refreshHistoryFlags();
  }

  redistribute(): void {
    const before = this.blobs().map((b) => ({ ...b }));
    const seed = get(this.terrainParams).seed ^ Math.floor(Math.random() * 0xffff);
    const cling = get(this.cloudState).cling;
    const next = distributeCloudsAlongRidges(this.terrainModel, before.length, seed, before);
    refreshCloudDerived(next, cling);
    this.cloudState.set({ blobs: next, cling });
    this.engine?.setClouds(next, cling);
    this.scheduleAutosave();
    this.history.commit({
      label: '重新环绕分布云团',
      undo: () => {
        const blobs = before.map((b) => ({ ...b }));
        this.cloudState.set({ blobs, cling });
        this.engine?.setClouds(blobs, cling);
      },
      redo: () => {
        const blobs = next.map((b) => ({ ...b }));
        this.cloudState.set({ blobs, cling });
        this.engine?.setClouds(blobs, cling);
      }
    });
    this.refreshHistoryFlags();
  }

  addCloud(): void {
    const rng = new RNG((Math.random() * 0xffffffff) >>> 0);
    const blobs = this.blobs();
    const ang = rng.range(0, Math.PI * 2);
    const rad = rng.range(30, 80);
    const density = 2 as CloudTier;
    const thickness = 2 as CloudTier;
    const height = 2 as CloudTier;
    const blob: CloudBlob = {
      id: nextCloudId(),
      x: Math.cos(ang) * rad,
      z: Math.sin(ang) * rad,
      density,
      thickness,
      height,
      radius: radiusFromTiers(density, thickness, rng.next() * 2 - 1),
      visible: true,
      locked: false,
      orientation: rng.range(0, Math.PI * 2),
      clearance: 0
    };
    const resolved = resolveCloudSeparation(blobs, blob.id, blob.x, blob.z);
    blob.x = resolved.x;
    blob.z = resolved.z;
    const cling = get(this.cloudState).cling;
    refreshCloudDerived([blob], cling);
    const next = [...blobs, blob];
    this.cloudState.set({ blobs: next, cling });
    this.cloudCount.set(next.length);
    this.engine?.setClouds(next, cling);
    this.selectedId.set(blob.id);
    this.scheduleAutosave();
    this.history.commit({
      label: '新增云团',
      undo: () => this.removeBlobById(blob.id, false),
      redo: () => this.restoreBlob(blob, cling)
    });
    this.refreshHistoryFlags();
  }

  private removeBlobById(id: string, record: boolean): void {
    const cling = get(this.cloudState).cling;
    const removed = this.blobs().find((b) => b.id === id);
    const next = this.blobs().filter((b) => b.id !== id);
    this.cloudState.set({ blobs: next, cling });
    this.cloudCount.set(next.length);
    this.engine?.setClouds(next, cling);
    if (get(this.selectedId) === id) this.selectedId.set(null);
    this.scheduleAutosave();
    if (record && removed) {
      this.history.commit({
        label: '删除云团',
        undo: () => this.restoreBlob(removed, cling),
        redo: () => this.removeBlobById(id, false)
      });
      this.refreshHistoryFlags();
    }
  }

  private restoreBlob(blob: CloudBlob, cling: number): void {
    const next = [...this.blobs(), { ...blob }];
    this.cloudState.set({ blobs: next, cling });
    this.cloudCount.set(next.length);
    this.engine?.setClouds(next, cling);
    this.scheduleAutosave();
  }

  deleteSelected(): void {
    const id = get(this.selectedId);
    if (id) this.removeBlobById(id, true);
  }

  selectCloud(id: string | null): void {
    this.selectedId.set(id);
    this.engine?.setSelected(id);
  }

  toggleVisible(id: string): void {
    const cling = get(this.cloudState).cling;
    const next = this.blobs().map((b) => (b.id === id ? { ...b, visible: !b.visible } : b));
    this.cloudState.set({ blobs: next, cling });
    this.engine?.setClouds(next, cling);
    this.scheduleAutosave();
  }

  toggleLock(id: string): void {
    const cling = get(this.cloudState).cling;
    const next = this.blobs().map((b) => (b.id === id ? { ...b, locked: !b.locked } : b));
    this.cloudState.set({ blobs: next, cling });
    this.engine?.setClouds(next, cling);
    this.scheduleAutosave();
  }

  setCloudTier(id: string, key: 'density' | 'thickness' | 'height', tier: CloudTier): void {
    const before = this.blobs().find((b) => b.id === id);
    if (!before) return;
    const beforeCopy = { ...before };
    const cling = get(this.cloudState).cling;
    const next = this.blobs().map((b) => {
      if (b.id !== id) return b;
      const updated = { ...b, [key]: tier };
      if (key !== 'height') {
        updated.radius = radiusFromTiers(updated.density, updated.thickness, 0);
      }
      return updated;
    });
    refreshCloudDerived(next, cling);
    this.cloudState.set({ blobs: next, cling });
    this.engine?.setClouds(next, cling);
    this.scheduleAutosave();
    this.history.commit({
      label: `云团${tierLabel(key)}档位`,
      undo: () => {
        const restored = this.blobs().map((b) => (b.id === id ? { ...beforeCopy } : b));
        refreshCloudDerived(restored, cling);
        this.cloudState.set({ blobs: restored, cling });
        this.engine?.setClouds(restored, cling);
      },
      redo: () => {
        const redone = this.blobs().map((b) => (b.id === id ? { ...b, ...next.find((x) => x.id === id)! } : b));
        this.cloudState.set({ blobs: redone, cling });
        this.engine?.setClouds(redone, cling);
      }
    });
    this.refreshHistoryFlags();
  }

  private commitCloudDrag(
    id: string,
    before: { x: number; z: number },
    after: { x: number; z: number }
  ): void {
    this.history.commit({
      label: '拖拽云团',
      undo: () => this.moveCloud(id, before.x, before.z),
      redo: () => this.moveCloud(id, after.x, after.z)
    });
    this.refreshHistoryFlags();
    this.scheduleAutosave();
  }

  /** 拖拽中的实时同步：更新 store 但不重建引擎视觉（引擎已自行更新位置）。 */
  private syncCloudMoveLive(id: string, x: number, z: number): void {
    const cling = get(this.cloudState).cling;
    const next = this.blobs().map((b) => (b.id === id ? b : { ...b }));
    const target = next.find((b) => b.id === id);
    if (target) {
      target.x = x;
      target.z = z;
    }
    this.cloudState.set({ blobs: next, cling });
  }

  private moveCloud(id: string, x: number, z: number): void {
    const cling = get(this.cloudState).cling;
    const next = this.blobs().map((b) => (b.id === id ? { ...b, x, z } : b));
    this.cloudState.set({ blobs: next, cling });
    this.engine?.setClouds(next, cling);
    this.scheduleAutosave();
  }

  // ------------------------------------------------------------- 光照 / 模式

  setLighting(id: LightingPresetId): void {
    this.lighting.set(id);
    this.engine?.setLighting(id);
    this.scheduleAutosave();
  }

  setMode(mode: InteractionMode): void {
    this.mode.set(mode);
    this.engine?.setMode(mode);
  }

  // ------------------------------------------------------------- 撤销重做

  undo(): void {
    this.history.undo();
    this.syncEngineFromState();
    this.scheduleAutosave();
  }

  redo(): void {
    this.history.redo();
    this.syncEngineFromState();
    this.scheduleAutosave();
  }

  /**
   * 历史动作的 undo/redo 闭包本身已负责把引擎同步到目标状态，
   * 这里只需对齐选中态（云团可能已被增删）。
   */
  private syncEngineFromState(): void {
    const id = get(this.selectedId);
    const exists = this.blobs().some((b) => b.id === id);
    this.engine?.setSelected(exists ? id : null);
    if (!exists) this.selectedId.set(null);
  }

  // ------------------------------------------------------------- 导入导出

  exportScene(): void {
    this.persist();
    saveSceneLocal(
      buildSerializedScene(
        get(this.terrainParams),
        this.terrainModel.brushMap,
        get(this.cloudState),
        get(this.lighting),
        get(this.brush)
      )
    );
    downloadSceneFile(
      buildSerializedScene(
        get(this.terrainParams),
        this.terrainModel.brushMap,
        get(this.cloudState),
        get(this.lighting),
        get(this.brush)
      )
    );
  }

  importScene(data: SerializedScene): void {
    this.terrainParams.set({ ...data.terrainParams });
    this.terrainModel = new TerrainModel(data.terrainParams);
    this.terrainModel.brushMap.set(Float32Array.from(data.brushMap));
    const blobs = data.clouds.map((b) => ({ ...b }));
    refreshCloudDerived(blobs, data.cling);
    this.cloudState.set({ blobs, cling: data.cling });
    this.cloudCount.set(blobs.length);
    this.lighting.set(data.lighting);
    this.brush.set({ ...data.brush });
    this.selectedId.set(null);
    this.history.clear();
    this.refreshHistoryFlags();
    // 引擎持有的是旧 TerrainModel 引用，整体重建引擎最稳妥
    this.recreateEngine();
    this.persist();
  }

  async importFromFile(file: File): Promise<void> {
    const text = await file.text();
    const data = parseSceneFile(text);
    this.importScene(data);
  }

  private recreateEngine(): void {
    const canvas = this.engineCanvas;
    this.detach();
    if (canvas) this.attach(canvas);
  }

  private engineCanvas: HTMLCanvasElement | null = null;

  rememberCanvas(canvas: HTMLCanvasElement): void {
    this.engineCanvas = canvas;
  }

  get lightingPresets() {
    return LIGHTING_ORDER;
  }

  /** 聚合响应式视图：组件统一通过 $editorView 订阅。 */
  get view(): Readable<EditorView> {
    if (this._view) return this._view;
    this._view = derived(
      [
        this.terrainParams,
        this.cloudState,
        this.lighting,
        this.brush,
        this.mode,
        this.selectedId,
        this.canUndo,
        this.canRedo,
        this.historyLabel,
        this.cloudCount,
        this.ready
      ],
      ([$terrainParams, $cloudState, $lighting, $brush, $mode, $selectedId, $canUndo, $canRedo, $historyLabel, $cloudCount, $ready]) => ({
        terrainParams: $terrainParams,
        cloudState: $cloudState,
        lighting: $lighting,
        brush: $brush,
        mode: $mode,
        selectedId: $selectedId,
        canUndo: $canUndo,
        canRedo: $canRedo,
        historyLabel: $historyLabel,
        cloudCount: $cloudCount,
        ready: $ready
      })
    );
    return this._view;
  }
  private _view: Readable<EditorView> | null = null;
}

export interface EditorView {
  terrainParams: TerrainParams;
  cloudState: CloudSceneState;
  lighting: LightingPresetId;
  brush: BrushSettings;
  mode: InteractionMode;
  selectedId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  historyLabel: string | null;
  cloudCount: number;
  ready: boolean;
}

function terrainParamLabel(key: keyof TerrainParams): string {
  switch (key) {
    case 'relief':
      return '山脊起伏';
    case 'fragmentation':
      return '破碎度';
    case 'baseHeight':
      return '基准高度';
    case 'seed':
      return '种子';
  }
}

function tierLabel(key: 'density' | 'thickness' | 'height'): string {
  switch (key) {
    case 'density':
      return '密度';
    case 'thickness':
      return '厚度';
    case 'height':
      return '高度';
  }
}

export const editor = new EditorStore();
export const editorView = editor.view;
export type { UndoableAction };
