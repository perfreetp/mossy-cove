import type { AppController } from './controller';
import type { EditorStore } from './store';
import type { Heightfield } from './terrain';
import type { VegetationScene } from '../pixi/VegetationScene';

/** 全局轻量上下文：Web Components 与主控之间共享实例 */
export const app: {
  store: EditorStore | null;
  hf: Heightfield | null;
  scene: VegetationScene | null;
  controller: AppController | null;
} = {
  store: null,
  hf: null,
  scene: null,
  controller: null,
};
