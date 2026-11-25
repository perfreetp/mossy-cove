import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { TerrainModel, WORLD_SIZE } from '../lib/noise';
import { clamp, smoothstep } from '../lib/mathUtils';

/**
 * 地形渲染网格：
 * - 预分配位置/法线/颜色缓冲，笔刷修改时只重算受影响区域的 CPU 数据；
 * - 法线用规则网格中心差分，局部刷新仅扩展一圈邻域；
 * - 顶点色按高度 + 坡度混合（草甸 / 岩壁 / 雪线）。
 */

const C_GRASS = new Color3(0.22, 0.34, 0.15);
const C_DIRT = new Color3(0.4, 0.31, 0.2);
const C_ROCK = new Color3(0.52, 0.5, 0.48);
const C_SNOW = new Color3(0.94, 0.96, 0.99);

export class TerrainMesh {
  readonly mesh: Mesh;
  private readonly model: TerrainModel;
  private readonly n: number;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly colors: Float32Array;
  private readonly indices: Uint32Array;
  private hMin = -20;
  private hMax = 80;

  constructor(scene: Scene, model: TerrainModel) {
    this.model = model;
    this.n = model.segments + 1;
    const vertCount = this.n * this.n;
    this.positions = new Float32Array(vertCount * 3);
    this.normals = new Float32Array(vertCount * 3);
    this.colors = new Float32Array(vertCount * 4);
    this.indices = new Uint32Array(model.segments * model.segments * 6);

    let idx = 0;
    for (let j = 0; j < model.segments; j++) {
      for (let i = 0; i < model.segments; i++) {
        const a = j * this.n + i;
        const b = a + 1;
        const c = a + this.n;
        const d = c + 1;
        this.indices[idx++] = a;
        this.indices[idx++] = c;
        this.indices[idx++] = b;
        this.indices[idx++] = b;
        this.indices[idx++] = c;
        this.indices[idx++] = d;
      }
    }

    this.mesh = new Mesh('terrain', scene);
    this.mesh.isPickable = true;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.fillPositions();
    this.computeHeightRange();
    this.computeNormals(0, this.n - 1, 0, this.n - 1);
    this.computeColors(0, this.n - 1, 0, this.n - 1);

    const vertexData = new VertexData();
    vertexData.positions = this.positions;
    vertexData.normals = this.normals;
    vertexData.colors = this.colors;
    vertexData.indices = this.indices;
    vertexData.uvs = this.buildUVs();
    // 必须为可更新缓冲，笔刷局部刷新才能通过 bufferSubData 动态写入
    vertexData.applyToMesh(this.mesh, true);
  }

  private buildUVs(): Float32Array {
    const uvs = new Float32Array(this.n * this.n * 2);
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        const k = (j * this.n + i) * 2;
        uvs[k] = i / this.model.segments;
        uvs[k + 1] = j / this.model.segments;
      }
    }
    return uvs;
  }

  private fillPositions(): void {
    const { n, model } = this;
    const half = WORLD_SIZE / 2;
    const cell = WORLD_SIZE / model.segments;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const vi = j * n + i;
        const x = -half + i * cell;
        const z = -half + j * cell;
        this.positions[vi * 3] = x;
        this.positions[vi * 3 + 1] = model.heightAt(x, z);
        this.positions[vi * 3 + 2] = z;
      }
    }
  }

  private computeHeightRange(): void {
    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < this.n * this.n; k++) {
      const h = this.positions[k * 3 + 1];
      if (h < min) min = h;
      if (h > max) max = h;
    }
    this.hMin = min;
    this.hMax = Math.max(max, min + 1);
  }

  private heightAtGrid(i: number, j: number): number {
    const ci = clamp(i, 0, this.n - 1);
    const cj = clamp(j, 0, this.n - 1);
    return this.positions[(cj * this.n + ci) * 3 + 1];
  }

  /** 中心差分法线，i0..i1 / j0..j1 为需要刷新的网格范围。 */
  private computeNormals(i0: number, i1: number, j0: number, j1: number): void {
    const cell = WORLD_SIZE / this.model.segments;
    const twoCell = cell * 2;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const hL = this.heightAtGrid(i - 1, j);
        const hR = this.heightAtGrid(i + 1, j);
        const hD = this.heightAtGrid(i, j - 1);
        const hU = this.heightAtGrid(i, j + 1);
        // 边缘用单侧差分
        const dhdx = i === 0 || i === this.n - 1 ? (hR - hL) / cell : (hR - hL) / twoCell;
        const dhdz = j === 0 || j === this.n - 1 ? (hU - hD) / cell : (hU - hD) / twoCell;
        let nx = -dhdx;
        let ny = 1;
        let nz = -dhdz;
        const invLen = 1 / Math.hypot(nx, ny, nz);
        nx *= invLen;
        ny *= invLen;
        nz *= invLen;
        const vi = j * this.n + i;
        this.normals[vi * 3] = nx;
        this.normals[vi * 3 + 1] = ny;
        this.normals[vi * 3 + 2] = nz;
      }
    }
  }

  private computeColors(i0: number, i1: number, j0: number, j1: number): void {
    const range = this.hMax - this.hMin;
    const tmp = new Color3();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const vi = j * this.n + i;
        const h = this.positions[vi * 3 + 1];
        const ny = this.normals[vi * 3 + 1];
        const ht = clamp((h - this.hMin) / range, 0, 1);
        const steep = 1 - smoothstep(0.5, 0.92, ny); // 越陡越接近岩壁
        // 基底：低处草甸过渡到泥土，过渡带收窄让色块更明确
        tmp.copyFrom(C_GRASS);
        Color3.LerpToRef(tmp, C_DIRT, smoothstep(0.12, 0.42, ht), tmp);
        // 高海拔与陡坡岩石
        const rockT = clamp(steep * 0.95 + smoothstep(0.4, 0.68, ht) * 0.7, 0, 1);
        Color3.LerpToRef(tmp, C_ROCK, rockT, tmp);
        // 雪线
        const snow = smoothstep(0.68, 0.86, ht) * smoothstep(0.55, 0.82, ny);
        Color3.LerpToRef(tmp, C_SNOW, snow, tmp);
        this.colors[vi * 4] = tmp.r;
        this.colors[vi * 4 + 1] = tmp.g;
        this.colors[vi * 4 + 2] = tmp.b;
        this.colors[vi * 4 + 3] = 1;
      }
    }
  }

  /** 全量重建（滑杆参数 / 种子 / 载入场景后）。 */
  rebuildAll(): void {
    this.fillPositions();
    this.computeHeightRange();
    this.computeNormals(0, this.n - 1, 0, this.n - 1);
    this.computeColors(0, this.n - 1, 0, this.n - 1);
    this.uploadAll();
  }

  /**
   * 笔刷局部刷新：bounds 为笔刷图格坐标，
   * 映射到地形网格并外扩一圈（法线邻域），只重算该矩形。
   */
  refreshFromBrush(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    const scale = this.model.segments / (this.model.brushSize - 1);
    const i0 = clamp(Math.floor(bounds.minX * scale) - 1, 0, this.n - 1);
    const i1 = clamp(Math.ceil(bounds.maxX * scale) + 1, 0, this.n - 1);
    const j0 = clamp(Math.floor(bounds.minZ * scale) - 1, 0, this.n - 1);
    const j1 = clamp(Math.ceil(bounds.maxZ * scale) + 1, 0, this.n - 1);

    const half = WORLD_SIZE / 2;
    const cell = WORLD_SIZE / this.model.segments;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const vi = j * this.n + i;
        const x = -half + i * cell;
        const z = -half + j * cell;
        this.positions[vi * 3 + 1] = this.model.heightAt(x, z);
      }
    }
    // 一次线性扫描维护全局高度范围（约 3.7 万浮点，亚毫秒级）；
    // 主要性能收益来自下方 uploadRegion 的 GPU 局部上传。
    this.computeHeightRange();
    this.computeNormals(i0, i1, j0, j1);
    this.computeColors(i0, i1, j0, j1);
    this.uploadRegion(i0, i1, j0, j1);
  }

  /**
   * 按网格矩形区域局部上传三个顶点缓冲。
   * Babylon 默认每种顶点属性使用独立（非交错）缓冲，GPU 缓冲按自身
   * component 宽度紧密排列。这里切片出影响的顶点区间，经 updateDirectly
   * 走 bufferSubData，只传笔刷触及的少量顶点。
   */
  private uploadRegion(i0: number, i1: number, j0: number, j1: number): void {
    const mesh = this.mesh;
    const stride = this.n;
    const specs: Array<{ kind: string; components: number; data: Float32Array }> = [
      { kind: VertexBuffer.PositionKind, components: 3, data: this.positions },
      { kind: VertexBuffer.NormalKind, components: 3, data: this.normals },
      { kind: VertexBuffer.ColorKind, components: 4, data: this.colors }
    ];
    const firstVertex = j0 * stride + i0;
    const vertexCount = (j1 - j0) * stride + (i1 - i0) + 1;
    for (const { kind, components, data } of specs) {
      const vertexBuffer = mesh.getVertexBuffer(kind);
      if (!vertexBuffer) continue;
      const start = firstVertex * components;
      const slice = data.subarray(start, start + vertexCount * components);
      // 外层 VertexBuffer.updateDirectly 不支持 vertexCount，
      // 直接走底层 Buffer 的四参重载（offset 以顶点计，内部换算字节）。
      vertexBuffer._buffer.updateDirectly(slice, firstVertex, vertexCount);
    }
  }

  private uploadAll(): void {
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, false, false);
    this.mesh.updateVerticesData(VertexBuffer.NormalKind, this.normals, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors, false, false);
  }

  get vertexCount(): number {
    return this.n * this.n;
  }
}
