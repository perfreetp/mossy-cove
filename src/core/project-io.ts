import { SPACING } from './config';
import type {
  DensityTier,
  EraseStroke,
  LayerKind,
  ProjectState,
  VegetationInstance,
} from './types';

const DENSITIES: DensityTier[] = ['sparse', 'normal', 'dense'];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function num(v: unknown, fallback: number, min?: number, max?: number): number {
  let n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  if (min !== undefined) n = Math.max(min, n);
  if (max !== undefined) n = Math.min(max, n);
  return n;
}

/**
 * 把解析出的 JSON 校验 / 修补成合法 ProjectState。
 * 接受两种文件：完整导出信封 { project: {...} } 或裸 ProjectState。
 */
export function parseProjectFile(text: string): ProjectState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法的 JSON');
  }
  if (!isObj(raw)) throw new Error('工程文件结构不正确');

  const p = isObj(raw.project) ? raw.project : raw;
  if (!isObj(p)) throw new Error('缺少工程数据');

  const paramsRaw = isObj(p.params) ? p.params : {};
  const density = DENSITIES.includes(paramsRaw.density as DensityTier)
    ? (paramsRaw.density as DensityTier)
    : 'normal';

  const layersRaw = isObj(p.layers) ? p.layers : {};
  const readLayer = (k: LayerKind) => {
    const l = isObj(layersRaw[k]) ? layersRaw[k] : {};
    return {
      visible: typeof l.visible === 'boolean' ? l.visible : true,
      seed: num(l.seed, k === 'trees' ? 0x13579bdf : 0x2468ace0) >>> 0,
    };
  };

  const zones = Array.isArray(p.zones)
    ? p.zones
        .filter(isObj)
        .map((z, i) => ({
          id: typeof z.id === 'string' ? z.id : `zone_imp_${i}`,
          name: typeof z.name === 'string' ? z.name : `散布区域 ${i + 1}`,
          x: num(z.x, 0),
          y: num(z.y, 0),
          w: num(z.w, 100, 24),
          h: num(z.h, 100, 24),
        }))
    : [];

  const strokes: EraseStroke[] = Array.isArray(p.strokes)
    ? p.strokes
        .filter(isObj)
        .map((s, si) => ({
          id: typeof s.id === 'string' ? s.id : `stroke_${si}`,
          dabs: Array.isArray(s.dabs)
            ? s.dabs.filter(isObj).map((d) => ({
                x: num(d.x, 0),
                y: num(d.y, 0),
                r: num(d.r, 60, 4, 400),
              }))
            : [],
        }))
        .filter((s) => s.dabs.length > 0)
    : [];

  const instances: VegetationInstance[] = Array.isArray(p.instances)
    ? p.instances
        .filter(isObj)
        .map((it) => {
          const layer: LayerKind = it.layer === 'bushes' ? 'bushes' : 'trees';
          return {
            id: num(it.id, 0) >>> 0,
            layer,
            zoneId: typeof it.zoneId === 'string' ? it.zoneId : '',
            x: num(it.x, 0),
            y: num(it.y, 0),
            h: num(it.h, 0.5, 0, 1),
            slope: num(it.slope, 0, 0, 90),
            size: num(it.size, 40, 4, 240),
            rot: num(it.rot, 0),
            variant: num(it.variant, 0, 0, 16) | 0,
          };
        })
    : [];

  // 重新分配连续 id，避免脏数据冲突
  instances.forEach((it, i) => (it.id = i + 1));

  const bandLow = num(p.bandLow, 0, 0, 1);
  const bandHigh = num(p.bandHigh, 1, 0, 1);

  const state: ProjectState = {
    app: 'qingyu-veg-scatter',
    format: 1,
    terrainSeed: num(p.terrainSeed, 20240517) >>> 0,
    params: {
      density,
      minSpacing: num(paramsRaw.minSpacing, SPACING.default, SPACING.min, SPACING.max),
      treeRatio: num(paramsRaw.treeRatio, 0.55, 0, 1),
    },
    bandLow: Math.min(bandLow, bandHigh),
    bandHigh: Math.max(bandLow, bandHigh),
    zones,
    layers: {
      trees: readLayer('trees'),
      bushes: readLayer('bushes'),
    },
    strokes,
    instances,
    nextInstanceId: instances.length + 1,
    nextZoneNumber: num(p.nextZoneNumber, zones.length + 1, 1),
  };
  return state;
}

export function serializeProject(state: ProjectState): string {
  return JSON.stringify(
    {
      tool: 'qingyu-veg-scatter',
      version: 1,
      exportedAt: new Date().toISOString(),
      project: state,
    },
    null,
    2,
  );
}

export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readFileAsText(file: File): Promise<string> {
  return file.text();
}
