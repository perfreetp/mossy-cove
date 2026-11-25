import { BRUSH_RADII } from './config';
import { app } from './context';
import {
  createInitialState,
  eraseAtDabs,
  resampleAll,
  resampleLayer,
  scatterNewZone,
  nextSeed,
} from './actions';
import {
  downloadTextFile,
  parseProjectFile,
  readFileAsText,
  serializeProject,
} from './project-io';
import { EditorStore } from './store';
import { Heightfield } from './terrain';
import { uiState } from './ui-state';
import { uid } from './rng';
import type { EraseStroke, LayerKind, ScatterParams, ToolId } from './types';
import type { VegetationScene, TerrainRect } from '../pixi/VegetationScene';
import { showToast } from '../ui/toast';

/** 集中处理所有来自 Web Components / 快捷键 / Pixi 回调的动作 */
export class AppController {
  readonly store: EditorStore;
  hf: Heightfield;
  scene: VegetationScene | null = null;
  private activeStroke: EraseStroke | null = null;

  constructor() {
    this.hf = new Heightfield(20240517);
    this.store = new EditorStore(createInitialState(this.hf));
    app.store = this.store;
    app.hf = this.hf;
    app.controller = this;

    this.store.subscribe(() => {
      if (this.scene) this.scene.sync(this.store.state);
    });

    this.bindKeyboard();
    this.bindImportInput();
  }

  attachScene(scene: VegetationScene): void {
    this.scene = scene;
    app.scene = scene;
    scene.setTerrain(this.hf);
    scene.setBrushRadius(BRUSH_RADII[uiState.state.brushTier]);
    scene.setTool(uiState.state.tool);
    scene.sync(this.store.state);

    scene.setCallbacks({
      onZoneComplete: (r) => this.handleZoneComplete(r),
      onEraseBegin: () => this.handleEraseBegin(),
      onEraseDabs: (dabs) => this.handleEraseDabs(dabs),
      onEraseEnd: () => this.handleEraseEnd(),
    });

    uiState.subscribe((s) => {
      scene.setTool(s.tool);
      scene.setBrushRadius(BRUSH_RADII[s.brushTier]);
    });
  }

  // ---------------- 工具 ----------------
  setTool(tool: ToolId): void {
    uiState.setTool(tool);
  }

  setBrushTier(tier: number): void {
    uiState.setBrushTier(tier);
  }

  cycleBrush(dir: 1 | -1): void {
    uiState.setBrushTier(uiState.state.brushTier + dir);
  }

  // ---------------- 历史 ----------------
  undo(): void {
    if (this.store.canUndo) this.store.undo();
  }
  redo(): void {
    if (this.store.canRedo) this.store.redo();
  }

  // ---------------- 散布参数 ----------------
  setDensity(density: ScatterParams['density']): void {
    if (this.store.state.params.density === density) return;
    this.store.run('调整密度档位', (d) => {
      d.params.density = density;
      resampleAll(d, this.hf);
    });
  }

  beginParamGesture(): void {
    this.store.beginGesture();
  }

  updateParams(patch: Partial<ScatterParams>): void {
    this.store.updateGesture((d) => {
      Object.assign(d.params, patch);
      resampleAll(d, this.hf);
    });
  }

  commitParamGesture(): void {
    this.store.commitGesture('调整散布参数');
  }

  regenerateAll(): void {
    this.store.run('重新散布全部', (d) => {
      d.layers.trees.seed = nextSeed(d.layers.trees.seed);
      d.layers.bushes.seed = nextSeed(d.layers.bushes.seed);
      resampleAll(d, this.hf);
    });
    showToast('已按新随机种子重新散布两片植被层', 'success', 1800);
  }

  // ---------------- 图层 ----------------
  toggleLayer(layer: LayerKind): void {
    const label = layer === 'trees' ? '树木层' : '灌木层';
    this.store.run(`${this.store.state.layers[layer].visible ? '隐藏' : '显示'}${label}`, (d) => {
      d.layers[layer].visible = !d.layers[layer].visible;
    });
  }

  rescatterLayer(layer: LayerKind): void {
    const label = layer === 'trees' ? '树木层' : '灌木层';
    this.store.run(`重新散布${label}`, (d) => {
      d.layers[layer].seed = nextSeed(d.layers[layer].seed);
      resampleLayer(d, this.hf, layer);
    });
    showToast(`${label}已重新散布`, 'success', 1600);
  }

  // ---------------- 区域 ----------------
  private handleZoneComplete(rect: TerrainRect): void {
    this.store.run('划定散布区域', (d) => {
      const zone = {
        id: uid('zone'),
        name: `散布区域 ${d.nextZoneNumber++}`,
        ...rect,
      };
      const index = d.zones.length;
      d.zones.push(zone);
      scatterNewZone(d, this.hf, zone, index);
    });
    const count = this.store.state.instances.length;
    showToast(`区域已生成，当前共 ${count.toLocaleString()} 个植被实例`, 'success');
  }

  deleteZone(zoneId: string): void {
    this.store.run('删除散布区域', (d) => {
      d.zones = d.zones.filter((z) => z.id !== zoneId);
      d.instances = d.instances.filter((i) => i.zoneId !== zoneId);
    });
  }

  focusZone(zoneId: string): void {
    const z = this.store.state.zones.find((zz) => zz.id === zoneId);
    if (z && this.scene) this.scene.focusRect(z);
  }

  // ---------------- 高度带 ----------------
  beginBandGesture(): void {
    this.store.beginGesture();
  }

  updateBand(low: number, high: number): void {
    this.store.updateGesture((d) => {
      d.bandLow = low;
      d.bandHigh = high;
    });
  }

  commitBandGesture(): void {
    this.store.commitGesture('调整高度带');
  }

  resetBand(): void {
    this.store.run('重置高度带', (d) => {
      d.bandLow = 0;
      d.bandHigh = 1;
    });
  }

  // ---------------- 擦除 ----------------
  private handleEraseBegin(): void {
    this.store.beginGesture();
    this.activeStroke = { id: uid('stroke'), dabs: [] };
    const stroke = this.activeStroke;
    this.store.updateGesture((d) => {
      d.strokes.push(stroke);
    });
  }

  private handleEraseDabs(
    dabs: Array<{ x: number; y: number; r: number }>,
  ): void {
    if (!this.activeStroke) return;
    const strokeId = this.activeStroke.id;
    this.store.updateGesture((d) => {
      const stroke = d.strokes.find((s) => s.id === strokeId);
      if (stroke) stroke.dabs.push(...dabs);
      eraseAtDabs(d, dabs);
    });
  }

  private handleEraseEnd(): void {
    this.store.commitGesture('擦除植被');
    this.activeStroke = null;
  }

  // ---------------- 导入 / 导出 ----------------
  exportProject(): void {
    const text = serializeProject(this.store.state);
    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const name = `qingyu-sandbox-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(
      stamp.getDate(),
    )}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.json`;
    downloadTextFile(name, text);
    showToast('散布工程已导出为 JSON 文件', 'success');
  }

  triggerImport(): void {
    document.getElementById('import-file-input')?.click();
  }

  private bindImportInput(): void {
    const input = document.getElementById('import-file-input') as HTMLInputElement | null;
    input?.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await readFileAsText(file);
        const state = parseProjectFile(text);
        // 地形种子不同则重建高度场与纹理
        if (state.terrainSeed !== this.hf.seed) {
          this.hf = new Heightfield(state.terrainSeed);
          app.hf = this.hf;
          this.scene?.setTerrain(this.hf);
        }
        this.store.loadImported(state);
        showToast(
          `工程已恢复：${state.zones.length} 个区域 · ${state.instances.length.toLocaleString()} 个实例`,
          'success',
          3200,
        );
      } catch (err) {
        showToast(`导入失败：${err instanceof Error ? err.message : '无法读取文件'}`, 'error', 4000);
      } finally {
        input.value = '';
      }
    });
  }

  // ---------------- 快捷键 ----------------
  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }
      if (typing) return;

      if (e.key === 'v' || e.key === 'V') this.setTool('pan');
      else if (e.key === 'r' || e.key === 'R') this.setTool('zone');
      else if (e.key === 'e' || e.key === 'E') this.setTool('erase');
      else if (e.key === '[') this.cycleBrush(-1);
      else if (e.key === ']') this.cycleBrush(1);
    });
  }
}
