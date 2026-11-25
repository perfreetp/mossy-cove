// manifold 计算 worker:实体构建 + 截面布尔切片
// 所有重计算在 WASM 内完成,不阻塞渲染线程
import Module from 'manifold-3d/manifold';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type {
  WorkerRequest, WorkerResponse, SectionResult, ContourData,
  ModelInfo, SectionRequest, BatchRequest
} from './types';
import { planeBasis, signedArea2d, type Vec3 } from './math';

type ManifoldModule = Awaited<ReturnType<typeof Module>>;
type Manifold = InstanceType<ManifoldModule['Manifold']>;

let M: ManifoldModule | null = null;
let manifold: Manifold | null = null;
let seq = 0;

async function ensureModule(): Promise<ManifoldModule> {
  if (!M) {
    M = await Module({ locateFile: () => wasmUrl });
    M.setup();
  }
  return M;
}

/** 由三角网格构建实体(非闭合网格会报错,由调用方提示) */
function buildManifold(vertices: Float32Array, indices: Uint32Array): { m: Manifold; info: ModelInfo } {
  const mod = M!;
  let extent = 0;
  for (let i = 0; i < vertices.length; i += 3) {
    extent = Math.max(extent, Math.abs(vertices[i]), Math.abs(vertices[i + 1]), Math.abs(vertices[i + 2]));
  }
  // 按模型尺度给容差,提升鲁棒性
  const tolerance = Math.max(1e-9, extent * 1e-6);

  const mesh = new mod.Mesh({
    numProp: 3,
    vertProperties: vertices,
    triVerts: indices,
    tolerance
  });
  const m = new mod.Manifold(mesh);
  const status = m.status();
  if (status !== 'NoError') {
    m.delete();
    throw new Error(`网格不是有效的二维流形(状态:${status})。请检查模型是否为闭合、可定向的实体网格。`);
  }
  const b = m.boundingBox();
  const min: Vec3 = [b.min[0], b.min[1], b.min[2]];
  const max: Vec3 = [b.max[0], b.max[1], b.max[2]];
  return {
    m,
    info: {
      vertexCount: m.numVert(),
      triangleCount: m.getMesh().triVerts.length / 3,
      manifoldStatus: status,
      bounds: {
        min,
        max,
        center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
        size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
      }
    }
  };
}

/**
 * 单个平面截面。
 * 把模型变换到平面局部坐标(法向→+Z,平面点→原点),slice(0) 得到 CrossSection,
 * 再映射回世界坐标并用 manifold.triangulate 三角化填充(自动处理孔洞)。
 */
function computeSection(req: SectionRequest): SectionResult {
  const t0 = performance.now();
  const mod = M!;
  const point = req.point as Vec3;
  const normal = req.normal as Vec3;
  const { e1, e2, n } = planeBasis(normal);

  // 世界 → 局部:旋转取 [e1 e2 n] 的转置,平移取 -Rᵀt
  const toLocal = new Array(16).fill(0);
  toLocal[0] = e1[0]; toLocal[1] = e1[1]; toLocal[2] = e1[2];
  toLocal[4] = e2[0]; toLocal[5] = e2[1]; toLocal[6] = e2[2];
  toLocal[8] = n[0];  toLocal[9] = n[1];  toLocal[10] = n[2];
  toLocal[15] = 1;
  toLocal[12] = -(toLocal[0] * point[0] + toLocal[1] * point[1] + toLocal[2] * point[2]);
  toLocal[13] = -(toLocal[4] * point[0] + toLocal[5] * point[1] + toLocal[6] * point[2]);
  toLocal[14] = -(toLocal[8] * point[0] + toLocal[9] * point[1] + toLocal[10] * point[2]);

  const local = manifold!.transform(toLocal as never);
  const section = local.slice(0);
  const polygons = section.toPolygons() as Array<Array<[number, number]>>;

  const contours: ContourData[] = [];
  const fillVerts: number[] = [];
  let totalArea = 0;

  let triangles: Array<[number, number, number]> = [];
  if (polygons.length > 0) {
    try {
      triangles = mod.triangulate(polygons, -1, false) as Array<[number, number, number]>;
    } catch {
      triangles = [];
    }
  }

  for (const poly of polygons) {
    const pts2: Array<[number, number]> = [];
    const pts3: Array<[number, number, number]> = [];
    for (const [u, v] of poly) {
      pts2.push([u, v]);
      // 局部 (u,v,0) → 世界
      pts3.push([
        e1[0] * u + e2[0] * v + point[0],
        e1[1] * u + e2[1] * v + point[1],
        e1[2] * u + e2[2] * v + point[2]
      ]);
      fillVerts.push(pts3[pts3.length - 1][0], pts3[pts3.length - 1][1], pts3[pts3.length - 1][2]);
    }
    const sa = signedArea2d(pts2);
    totalArea += sa; // 有符号求和自动扣除孔洞
    contours.push({
      points2d: pts2,
      points3d: pts3,
      signedArea: sa,
      area: Math.abs(sa),
      isHole: sa < 0
    });
  }

  const fillIdx: number[] = [];
  for (const tri of triangles) fillIdx.push(tri[0], tri[1], tri[2]);

  section.delete();
  local.delete();

  return {
    id: seq++,
    plane: req.plane,
    point,
    normal: n,
    basis: { center: point, e1, e2 },
    contours,
    fillIndices: new Uint32Array(fillIdx),
    fillVertices: new Float32Array(fillVerts),
    totalArea: Math.abs(totalArea),
    elapsedMs: performance.now() - t0
  };
}

/** 批量切片:同一方向、多个偏移,复用一次法向基计算 */
function computeBatch(req: BatchRequest): { results: SectionResult[]; elapsedMs: number } {
  const t0 = performance.now();
  const { n } = planeBasis(req.normal as Vec3);
  const results: SectionResult[] = [];
  for (const off of req.offsets) {
    const point: Vec3 = [
      req.point[0] + n[0] * off,
      req.point[1] + n[1] * off,
      req.point[2] + n[2] * off
    ];
    results.push(computeSection({
      type: 'section',
      id: req.id,
      plane: req.axis,
      point,
      normal: req.normal
    }));
  }
  return { results, elapsedMs: performance.now() - t0 };
}

function failedResponse(id: number, reqType: string, msg: string): WorkerResponse {
  const emptyInfo: ModelInfo = {
    vertexCount: 0, triangleCount: 0, manifoldStatus: 'Failed',
    bounds: { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: [0, 0, 0] }
  };
  if (reqType === 'import-mesh') {
    return { type: 'imported', id, ok: false, error: msg, vertices: new Float32Array(0), indices: new Uint32Array(0), info: emptyInfo };
  }
  if (reqType === 'batch') {
    return { type: 'batch', id, ok: false, error: msg, results: [], elapsedMs: 0 };
  }
  return { type: 'section', id, ok: false, error: msg, result: null };
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    await ensureModule();

    if (req.type === 'import-mesh') {
      if (manifold) { manifold.delete(); manifold = null; }
      const built = buildManifold(req.vertices, req.indices);
      manifold = built.m;
      const mesh = built.m.getMesh();
      const resp: WorkerResponse = {
        type: 'imported',
        id: req.id,
        ok: true,
        vertices: mesh.vertProperties.slice(0, mesh.numProp * built.m.numVert()) as Float32Array,
        indices: mesh.triVerts.slice() as Uint32Array,
        info: built.info
      };
      self.postMessage(resp);
      return;
    }

    if (req.type === 'section') {
      if (!manifold) throw new Error('尚未导入模型');
      const result = computeSection(req);
      self.postMessage({ type: 'section', id: req.id, ok: true, result } satisfies WorkerResponse);
      return;
    }

    if (req.type === 'batch') {
      if (!manifold) throw new Error('尚未导入模型');
      const { results, elapsedMs } = computeBatch(req);
      self.postMessage({ type: 'batch', id: req.id, ok: true, results, elapsedMs } satisfies WorkerResponse);
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    self.postMessage(failedResponse(req.id, req.type, msg));
  }
};
