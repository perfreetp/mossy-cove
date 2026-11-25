// 应用全局状态(Svelte 5 runes)与截面调度
import { SectionWorker } from './section-worker';
import type {
  AxisName, PlanesState, PlaneState, ViewScheme, SliceParams,
  ModelInfo, SectionResult, Measurement
} from './types';
import { defaultPlaneVectors } from './math';

const STORAGE_KEY = 'fossil-viewer-schemes-v1';

function defaultPlanes(center: [number, number, number] = [0, 0, 0]): PlanesState {
  const colors: Record<AxisName, { fill: string; line: string }> = {
    x: { fill: '#ff5a5f', line: '#ffd7d9' },
    y: { fill: '#4cc38a', line: '#c9f5e2' },
    z: { fill: '#4d96ff', line: '#cfe2ff' }
  };
  const make = (axis: AxisName): PlaneState => {
    const v = defaultPlaneVectors(axis);
    return {
      point: [...center] as [number, number, number],
      normal: v.normal,
      enabled: true,
      hidden: false,
      fillColor: colors[axis].fill,
      lineColor: colors[axis].line
    };
  };
  return { x: make('x'), y: make('y'), z: make('z') };
}

function defaultSlice(): SliceParams {
  return { axis: 'z', count: 12, startOffset: -0.8, endOffset: 0.8 };
}

export const appState = $state({
  planes: defaultPlanes(),
  angleLock: true,
  snapDegrees: 15,
  slice: defaultSlice(),
  modelInfo: null as ModelInfo | null,
  modelName: '',
  loading: false,
  loadError: '',
  workerReady: false,
  /** 各平面最新截面(3D 视图显示用) */
  liveSections: { x: null, y: null, z: null } as Record<AxisName, SectionResult | null>,
  /** 批量切片结果 */
  batchResults: [] as SectionResult[],
  batchBusy: false,
  batchElapsedMs: 0,
  batchIndex: 0,
  measurements: [] as Measurement[],
  schemes: [] as ViewScheme[],
  hoverHint: '',
  measureMode: 'off' as 'off' | 'distance' | 'area',
  /** 拖动节流统计 */
  lastComputeMs: 0,
  /** 最近一次成功导入的网格(供 three.js 渲染复用) */
  lastMesh: null as { vertices: Float32Array; indices: Uint32Array } | null
});

export const worker = new SectionWorker();
worker.ready.then(() => { appState.workerReady = true; });

// ---------- 模型导入 ----------

export async function importModel(
  parse: () => Promise<{ vertices: Float32Array; indices: Uint32Array }>,
  fileName: string
) {
  appState.loading = true;
  appState.loadError = '';
  try {
    const { vertices, indices } = await parse();
    if (!indices.length) throw new Error('模型没有三角面数据');
    const resp = await worker.importMesh(vertices, indices, fileName);
    if (!resp.ok || !resp.info) throw new Error(resp.error || '实体构建失败');
    appState.modelInfo = resp.info;
    appState.modelName = fileName;
    appState.lastMesh = {
      vertices: new Float32Array(resp.vertices),
      indices: new Uint32Array(resp.indices)
    };
    // 平面重置到模型中心
    const c = resp.info.bounds.center;
    appState.planes = defaultPlanes(c);
    appState.liveSections = { x: null, y: null, z: null };
    appState.batchResults = [];
    appState.measurements = [];
    return resp.info;
  } catch (err) {
    appState.loadError = err instanceof Error ? err.message : String(err);
    // 8 秒后自动清除提示,避免遮挡视图
    setTimeout(() => { appState.loadError = ''; }, 8000);
    throw err;
  } finally {
    appState.loading = false;
  }
}

export function dismissLoadError() {
  appState.loadError = '';
}

// ---------- 交互截面(拖动实时) ----------

// 同平面合并:计算进行中只标记 dirty,完成后用最新状态补算一次
const inflight = new Set<AxisName>();
const dirty = new Set<AxisName>();

export async function requestInteractiveSection(axis: AxisName) {
  const p = appState.planes[axis];
  if (!appState.modelInfo || !p.enabled || p.hidden) {
    appState.liveSections[axis] = null;
    return;
  }
  if (inflight.has(axis)) {
    dirty.add(axis); // 占用中:标记需要用最新状态补算
    return;
  }
  inflight.add(axis);
  // 每次取发起时刻的快照,避免 await 期间状态继续变化
  const snapshot = {
    point: [...p.point] as [number, number, number],
    normal: [...p.normal] as [number, number, number]
  };
  try {
    const t0 = performance.now();
    const result = await worker.requestSection(axis, snapshot.point, snapshot.normal);
    appState.lastComputeMs = performance.now() - t0;
    if (result) appState.liveSections[axis] = result;
  } catch (err) {
    console.error('截面计算失败', err);
  } finally {
    inflight.delete(axis);
    if (dirty.has(axis)) {
      dirty.delete(axis);
      void requestInteractiveSection(axis); // 用最新平面状态再算一次
    }
  }
}

/** 三个平面全量重算(开关切换、方案恢复等) */
export function refreshAllSections() {
  for (const axis of ['x', 'y', 'z'] as AxisName[]) {
    void requestInteractiveSection(axis);
  }
}

// ---------- 批量切片 ----------

export async function runBatchSlice() {
  if (!appState.modelInfo) return;
  const { axis, count, startOffset, endOffset } = appState.slice;
  const p = appState.planes[axis];
  const bounds = appState.modelInfo.bounds;

  // 沿平面法向投影包围盒 8 个角点,得到该法向上模型的真实范围
  const corners: Array<[number, number, number]> = [];
  for (const bx of [bounds.min[0], bounds.max[0]]) {
    for (const by of [bounds.min[1], bounds.max[1]]) {
      for (const bz of [bounds.min[2], bounds.max[2]]) {
        corners.push([bx, by, bz]);
      }
    }
  }
  const proj = corners.map(c => c[0] * p.normal[0] + c[1] * p.normal[1] + c[2] * p.normal[2]);
  const minProj = Math.min(...proj);
  const maxProj = Math.max(...proj);
  const centerProj = (minProj + maxProj) / 2;
  const halfSpan = (maxProj - minProj) / 2;

  // startOffset/endOffset 是相对法向半跨度的归一化值(-1..1)
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const norm = startOffset + (endOffset - startOffset) * t;
    // 相对当前平面点的位移:目标投影点 - 当前平面点投影
    const targetProj = centerProj + norm * halfSpan;
    const currentProj = p.point[0] * p.normal[0] + p.point[1] * p.normal[1] + p.point[2] * p.normal[2];
    offsets.push(targetProj - currentProj);
  }
  appState.batchBusy = true;
  try {
    const resp = await worker.requestBatch(axis, p.point, p.normal, offsets);
    if (!resp.ok) throw new Error(resp.error);
    appState.batchResults = resp.results;
    appState.batchElapsedMs = resp.elapsedMs;
    appState.batchIndex = 0;
  } catch (err) {
    appState.loadError = err instanceof Error ? err.message : String(err);
    setTimeout(() => { appState.loadError = ''; }, 8000);
  } finally {
    appState.batchBusy = false;
  }
}

// ---------- 测量 ----------

let measureId = 1;
export function addMeasurement(m: Omit<Measurement, 'id'>) {
  appState.measurements = [...appState.measurements, { ...m, id: measureId++ }];
}

export function clearMeasurements() {
  appState.measurements = [];
}

// ---------- 视图方案 ----------

export function loadSchemes(): ViewScheme[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    appState.schemes = raw ? (JSON.parse(raw) as ViewScheme[]) : [];
  } catch {
    appState.schemes = [];
  }
  return appState.schemes;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.schemes));
}

/** 深拷贝为纯 JSON 数据(剥离 Svelte 响应式代理) */
function snapshot<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function saveScheme(name: string): ViewScheme {
  const scheme: ViewScheme = {
    id: `s-${Date.now()}-${Math.round(performance.now())}`,
    name,
    createdAt: Date.now(),
    planes: snapshot(appState.planes),
    slice: snapshot(appState.slice),
    angleLock: appState.angleLock,
    snapDegrees: appState.snapDegrees
  };
  appState.schemes = [...appState.schemes, scheme];
  persist();
  return scheme;
}

export function applyScheme(scheme: ViewScheme) {
  appState.planes = snapshot(scheme.planes);
  appState.slice = snapshot(scheme.slice);
  appState.angleLock = scheme.angleLock;
  appState.snapDegrees = scheme.snapDegrees;
  refreshAllSections();
}

export function deleteScheme(id: string) {
  appState.schemes = appState.schemes.filter(s => s.id !== id);
  persist();
}

/** 法向方向上模型包围盒的半跨度与中心投影 */
function normalSpan(normal: [number, number, number]): { centerProj: number; halfSpan: number } {
  const info = appState.modelInfo!;
  const b = info.bounds;
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const x of [b.min[0], b.max[0]]) {
    for (const y of [b.min[1], b.max[1]]) {
      for (const z of [b.min[2], b.max[2]]) {
        const pr = x * normal[0] + y * normal[1] + z * normal[2];
        minProj = Math.min(minProj, pr);
        maxProj = Math.max(maxProj, pr);
      }
    }
  }
  return { centerProj: (minProj + maxProj) / 2, halfSpan: (maxProj - minProj) / 2 || 1 };
}

/** 沿法向的当前偏移(相对中心,归一化到法向半跨度,UI 滑块用) */
export function planeOffset(axis: AxisName): number {
  const info = appState.modelInfo;
  if (!info) return 0;
  const p = appState.planes[axis];
  const { centerProj, halfSpan } = normalSpan(p.normal);
  const cur = p.point[0] * p.normal[0] + p.point[1] * p.normal[1] + p.point[2] * p.normal[2];
  return (cur - centerProj) / halfSpan;
}

export function setPlaneOffset(axis: AxisName, normalized: number) {
  const info = appState.modelInfo;
  if (!info) return;
  const p = appState.planes[axis];
  const { centerProj, halfSpan } = normalSpan(p.normal);
  const targetProj = centerProj + normalized * halfSpan;
  // 把平面点沿法向移动到目标投影位置(保持其在法向线上)
  const cur = p.point[0] * p.normal[0] + p.point[1] * p.normal[1] + p.point[2] * p.normal[2];
  const d = targetProj - cur;
  p.point = [
    p.point[0] + p.normal[0] * d,
    p.point[1] + p.normal[1] * d,
    p.point[2] + p.normal[2] * d
  ];
  void requestInteractiveSection(axis);
}

export { defaultPlanes, defaultSlice };
