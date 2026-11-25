import './styles.css';

import './components/viewport-canvas';
import './components/veg-toolbar';
import './components/scatter-panel';
import './components/height-band';
import './components/layer-list';

import { AppController } from './core/controller';
import { parseProjectFile } from './core/project-io';
import { Heightfield } from './core/terrain';
import { VegetationScene } from './pixi/VegetationScene';
import type { ViewportCanvas } from './components/viewport-canvas';

async function bootstrap(): Promise<void> {
  const controller = new AppController();

  const vp = document.querySelector<ViewportCanvas>('[data-testid="viewport-canvas"]');
  if (!vp) throw new Error('viewport-canvas element missing');

  const scene = new VegetationScene(vp.stageEl);
  await scene.init();
  controller.attachScene(scene);

  // 自动化验证 / 调试钩子
  (window as unknown as Record<string, unknown>).__VEG_TOOL__ = {
    ready: true,
    get store() {
      return controller.store;
    },
    get state() {
      return controller.store.state;
    },
    get scene() {
      return controller.scene;
    },
    get hf() {
      return controller.hf;
    },
    controller,
    undo: () => controller.undo(),
    redo: () => controller.redo(),
    /** 供脚本直接导入 JSON 文本 */
    importJSON: async (text: string) => {
      const state = parseProjectFile(text);
      if (state.terrainSeed !== controller.hf.seed) {
        controller.hf = new Heightfield(state.terrainSeed);
        scene.setTerrain(controller.hf);
      }
      controller.store.loadImported(state);
    },
    exportJSON: () => JSON.stringify(controller.store.state),
  };

  document.documentElement.dataset.appReady = 'true';
}

bootstrap().catch((err) => {
  console.error('[veg-tool] bootstrap failed', err);
  const root = document.getElementById('toast-root');
  if (root) {
    root.innerHTML = `<div class="toast error">应用初始化失败：${
      err instanceof Error ? err.message : String(err)
    }</div>`;
  }
  document.documentElement.dataset.appReady = 'error';
});
