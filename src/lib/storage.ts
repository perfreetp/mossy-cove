import type { CloudBlob, CloudSceneState } from './clouds';
import type { TerrainParams } from './noise';
import type { LightingPresetId } from './lighting';

/** 场景序列化、localStorage 持久化与文件导出/导入。 */

export interface BrushSettings {
  radius: number;
  strength: number;
  mode: 'raise' | 'lower';
}

export interface SerializedScene {
  format: 'cloud-ridge-studio';
  version: 1;
  savedAt: string;
  terrainParams: TerrainParams;
  brushMap: number[];
  clouds: CloudBlob[];
  cling: number;
  lighting: LightingPresetId;
  brush: BrushSettings;
}

const STORAGE_KEY = 'cloud-ridge-studio:scene:v1';

export function saveSceneLocal(data: SerializedScene): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    // 配额超限时静默降级，控制台保留诊断信息
    console.warn('[storage] 本地保存失败', err);
  }
}

export function loadSceneLocal(): SerializedScene | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SerializedScene;
    if (data.format !== 'cloud-ridge-studio' || data.version !== 1) return null;
    return data;
  } catch (err) {
    console.warn('[storage] 本地场景解析失败', err);
    return null;
  }
}

export function clearSceneLocal(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function buildSerializedScene(
  terrainParams: TerrainParams,
  brushMap: Float32Array,
  cloudState: CloudSceneState,
  lighting: LightingPresetId,
  brush: BrushSettings
): SerializedScene {
  return {
    format: 'cloud-ridge-studio',
    version: 1,
    savedAt: new Date().toISOString(),
    terrainParams,
    brushMap: Array.from(brushMap),
    clouds: cloudState.blobs.map((b) => ({ ...b })),
    cling: cloudState.cling,
    lighting,
    brush: { ...brush }
  };
}

export function downloadSceneFile(data: SerializedScene): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `cloud-ridge-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function parseSceneFile(text: string): SerializedScene {
  const data = JSON.parse(text) as SerializedScene;
  if (data.format !== 'cloud-ridge-studio' || data.version !== 1) {
    throw new Error('文件格式不匹配：不是有效的 Cloud Ridge Studio 场景文件');
  }
  if (!data.terrainParams || !Array.isArray(data.brushMap) || !Array.isArray(data.clouds)) {
    throw new Error('场景文件缺少必要字段');
  }
  return data;
}
