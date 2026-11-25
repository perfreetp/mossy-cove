// manifold worker 的主线程封装:双 worker(交互/批量)、代次管理、过时结果丢弃
import type {
  WorkerRequest, WorkerResponse, SectionResult, ModelInfo,
  AxisName, SectionRequest, BatchRequest, ImportMeshRequest
} from './types';
import type { Vec3 } from './math';

/** 剥离 Svelte 5 响应式代理,转为可结构化克隆的普通数据(坐标均为纯数字/数组) */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

interface Pending {
  id: number;
  resolve: (r: WorkerResponse) => void;
  reject: (e: Error) => void;
  kind: 'interactive' | 'batch' | 'import';
}

let nextId = 1;

export class SectionWorker {
  private interactive: Worker;
  private batch: Worker;
  private pending = new Map<number, Pending>();
  /** 交互请求代次:同平面新请求会让旧代次失效 */
  private interactiveGen = new Map<AxisName, number>();
  ready: Promise<void>;

  constructor() {
    this.interactive = new Worker(new URL('./manifold-worker.ts', import.meta.url), { type: 'module' });
    this.batch = new Worker(new URL('./manifold-worker.ts', import.meta.url), { type: 'module' });
    this.ready = Promise.resolve();
    this.interactive.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
    this.batch.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
    this.interactive.onerror = (e) => this.onError(e.message);
    this.batch.onerror = (e) => this.onError(e.message);
  }

  private onMessage(resp: WorkerResponse) {
    const p = this.pending.get(resp.id);
    if (!p) return;
    this.pending.delete(resp.id);
    p.resolve(resp);
  }

  private onError(msg: string) {
    const err = new Error(msg || 'worker 运行错误');
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private send(worker: Worker, req: WorkerRequest, transfer: Transferable[]): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, {
        id: req.id,
        resolve,
        reject,
        kind: req.type === 'batch' ? 'batch' : req.type === 'import-mesh' ? 'import' : 'interactive'
      });
      worker.postMessage(req, transfer);
    });
  }

  /** 导入网格(在批量 worker 上做,避免占交互通道) */
  async importMesh(vertices: Float32Array, indices: Uint32Array, fileName: string): Promise<{
    ok: boolean; error?: string; info?: ModelInfo;
    vertices: Float32Array; indices: Uint32Array;
  }> {
    const id = nextId++;
    const req: ImportMeshRequest = { type: 'import-mesh', id, vertices, indices, fileName };
    const resp = await this.send(this.batch, req, [vertices.buffer, indices.buffer]);
    if (resp.type !== 'imported') throw new Error('响应类型不匹配');
    if (!resp.ok) return { ok: false, error: resp.error, vertices: resp.vertices, indices: resp.indices };
    // 导入成功后,把同一份网格也送到交互 worker(两个 WASM 实例各持一份实体)
    const v2 = new Float32Array(resp.vertices);
    const i2 = new Uint32Array(resp.indices);
    const id2 = nextId++;
    const req2: ImportMeshRequest = { type: 'import-mesh', id: id2, vertices: v2, indices: i2, fileName };
    const resp2 = await this.send(this.interactive, req2, [v2.buffer, i2.buffer]);
    if (resp2.type !== 'imported' || !resp2.ok) {
      return { ok: false, error: resp2.type === 'imported' ? resp2.error : '交互 worker 初始化失败', vertices: resp.vertices, indices: resp.indices };
    }
    return { ok: true, info: resp.info, vertices: resp.vertices, indices: resp.indices };
  }

  /**
   * 交互截面(拖动时调用)。同平面新请求自动作废旧请求,
   * 旧 Promise 以 stale 结果返回(ok=false,error=STALE),调用方直接忽略即可。
   */
  requestSection(plane: AxisName, point: Vec3, normal: Vec3): Promise<SectionResult | null> {
    const gen = (this.interactiveGen.get(plane) ?? 0) + 1;
    this.interactiveGen.set(plane, gen);
    const id = nextId++;
    // plain() 剥离 Svelte 响应式代理,保证可结构化克隆
    const req: SectionRequest = {
      type: 'section', id, plane,
      point: plain(point),
      normal: plain(normal)
    };
    return this.send(this.interactive, req, []).then(resp => {
      if (gen !== this.interactiveGen.get(plane)) return null; // 已被更新的请求取代
      if (!resp.ok || resp.type !== 'section') {
        if (resp.error === 'STALE') return null;
        throw new Error(resp.error || '截面计算失败');
      }
      return resp.result;
    });
  }

  /** 批量切片序列,在独立 worker 上运行,不阻塞交互响应 */
  requestBatch(axis: AxisName, point: Vec3, normal: Vec3, offsets: number[]): Promise<{
    ok: boolean; results: SectionResult[]; elapsedMs: number; error?: string;
  }> {
    const id = nextId++;
    const req: BatchRequest = {
      type: 'batch', id, axis,
      point: plain(point),
      normal: plain(normal),
      offsets: plain(offsets)
    };
    return this.send(this.batch, req, []).then(resp => {
      if (resp.type !== 'batch') throw new Error('响应类型不匹配');
      return { ok: resp.ok, results: resp.results ?? [], elapsedMs: resp.elapsedMs ?? 0, error: resp.error };
    });
  }

  dispose() {
    this.interactive.terminate();
    this.batch.terminate();
    this.pending.clear();
  }
}
