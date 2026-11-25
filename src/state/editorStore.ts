import * as THREE from 'three';
import { clipMeshByPlane } from '../geometry/clipPlane';
import { extractBoundaryLoops } from '../geometry/boundaryLoops';
import { fillHole, insertCapHandle } from '../geometry/fillHole';
import type { BoundaryLoop, Snapshot } from '../types';

export interface OrganEntry {
  id: string;
  name: string;
  snapshots: Snapshot[];
  cursor: number; // 当前快照下标
}

export interface StoreSummary {
  organs: { id: string; name: string; triangleCount: number; vertexCount: number }[];
  activeOrganId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  historyLabels: string[];
  cursor: number;
  loopCount: number;
  previewActive: boolean;
  version: number;
}

let organSeq = 1;

export class EditorStore {
  private organs = new Map<string, OrganEntry>();
  private order: string[] = [];
  private activeOrganId: string | null = null;
  private listeners = new Set<() => void>();
  private version = 0;

  /** 平面刀拖动中的实时预览几何（不入栈），null 表示无预览 */
  private previewGeometry: THREE.BufferGeometry | null = null;
  private previewLoops: BoundaryLoop[] = [];
  private cachedSummary: StoreSummary | null = null;

  // ---------------------------------------------------------------- 订阅
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    this.version++;
    this.cachedSummary = null;
    for (const fn of [...this.listeners]) fn();
  }

  // ---------------------------------------------------------------- 器官
  addOrgan(name: string, geometry: THREE.BufferGeometry): string {
    const id = `organ-${organSeq++}`;
    const loops = extractBoundaryLoops(geometry);
    const snapshot: Snapshot = {
      label: '导入模型',
      geometry,
      loops,
      caps: [],
      triangleCount: geometry.index?.count ?? 0,
      vertexCount: geometry.getAttribute('position').count,
    };
    this.organs.set(id, { id, name, snapshots: [snapshot], cursor: 0 });
    this.order.push(id);
    this.activeOrganId = id;
    this.clearPreview();
    this.emit();
    return id;
  }

  removeOrgan(id: string) {
    const entry = this.organs.get(id);
    if (!entry) return;
    for (const s of entry.snapshots) this.disposeSnapshot(s);
    this.organs.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.activeOrganId === id) {
      this.activeOrganId = this.order[0] ?? null;
    }
    this.clearPreview();
    this.emit();
  }

  setActiveOrgan(id: string) {
    if (!this.organs.has(id) || this.activeOrganId === id) return;
    this.activeOrganId = id;
    this.clearPreview();
    this.emit();
  }

  getActiveOrganId() {
    return this.activeOrganId;
  }

  getOrgan(id: string): OrganEntry | undefined {
    return this.organs.get(id);
  }

  getOrganIds() {
    return [...this.order];
  }

  private requireActive(): OrganEntry {
    const entry = this.activeOrganId ? this.organs.get(this.activeOrganId) : undefined;
    if (!entry) throw new Error('当前没有活动器官');
    return entry;
  }

  // ---------------------------------------------------------------- 快照
  private present(entry: OrganEntry): Snapshot {
    return entry.snapshots[entry.cursor];
  }

  getPresentGeometry(): THREE.BufferGeometry | null {
    if (this.previewGeometry) return this.previewGeometry;
    const entry = this.activeOrganId ? this.organs.get(this.activeOrganId) : undefined;
    return entry ? this.present(entry).geometry : null;
  }

  getPresentLoops(): BoundaryLoop[] {
    return this.previewGeometry ? this.previewLoops : this.currentSnapshot()?.loops ?? [];
  }

  currentSnapshot(): Snapshot | null {
    const entry = this.activeOrganId ? this.organs.get(this.activeOrganId) : undefined;
    return entry ? this.present(entry) : null;
  }

  isPreviewActive() {
    return this.previewGeometry !== null;
  }

  /** 入栈：丢弃 redo 分支，快照内含完整几何与环（重做即整体还原） */
  private pushSnapshot(entry: OrganEntry, label: string, geometry: THREE.BufferGeometry, loops: BoundaryLoop[]) {
    const dropped = entry.snapshots.splice(entry.cursor + 1);
    for (const s of dropped) this.disposeSnapshot(s);
    entry.snapshots.push({
      label,
      geometry,
      loops,
      caps: [],
      triangleCount: geometry.index?.count ?? 0,
      vertexCount: geometry.getAttribute('position').count,
    });
    entry.cursor = entry.snapshots.length - 1;
  }

  private disposeSnapshot(s: Snapshot) {
    s.geometry.disposeBoundsTree?.();
    s.geometry.dispose();
  }

  // ---------------------------------------------------------------- 裁剪
  /**
   * 平面刀拖动实时重算：结果仅作预览，不产生历史记录。
   * 每次调用释放上一份预览，保证拖动过程内存平稳。
   */
  updateClipPreview(plane: THREE.Plane): { empty: boolean } {
    const entry = this.requireActive();
    const { geometry } = clipMeshByPlane(this.present(entry).geometry, plane);
    if (geometry.index && geometry.index.count === 0) {
      this.clearPreview();
      return { empty: true };
    }
    this.setPreview(geometry);
    return { empty: false };
  }

  private setPreview(geometry: THREE.BufferGeometry) {
    if (this.previewGeometry) {
      this.previewGeometry.disposeBoundsTree?.();
      this.previewGeometry.dispose();
    }
    this.previewGeometry = geometry;
    this.previewLoops = extractBoundaryLoops(geometry);
    this.emit();
  }

  clearPreview() {
    if (this.previewGeometry) {
      this.previewGeometry.disposeBoundsTree?.();
      this.previewGeometry.dispose();
      this.previewGeometry = null;
      this.previewLoops = [];
      this.emit();
    }
  }

  /** 提交当前刀位：把预览固化为一次裁剪快照 */
  commitClip(plane: THREE.Plane, label?: string) {
    const entry = this.requireActive();
    const { geometry } = clipMeshByPlane(this.present(entry).geometry, plane);
    if (!geometry.index || geometry.index.count === 0) {
      throw new Error('刀平面将整个模型裁空，已阻止该操作');
    }
    const loops = extractBoundaryLoops(geometry);
    this.clearPreviewSilent();
    this.pushSnapshot(entry, label ?? '平面裁剪', geometry, loops);
    this.emit();
  }

  private clearPreviewSilent() {
    if (this.previewGeometry) {
      this.previewGeometry.disposeBoundsTree?.();
      this.previewGeometry.dispose();
      this.previewGeometry = null;
      this.previewLoops = [];
    }
  }

  // ---------------------------------------------------------------- 补洞
  /**
   * 手动补洞：pickedPositions 为按顺序拾取并已吸附到边界环顶点的点。
   */
  fillHole(snappedPositions: THREE.Vector3[], plane: THREE.Plane, label = '手动补洞') {
    const entry = this.requireActive();
    const current = this.present(entry);
    const { geometry } = fillHole(current.geometry, snappedPositions, plane);
    const loops = extractBoundaryLoops(geometry);
    this.clearPreviewSilent();
    this.pushSnapshot(entry, label, geometry, loops);
    this.emit();
  }

  /** 一键自动补洞：对当前所有未封闭的断面环依次补洞 */
  autoFillAll() {
    const entry = this.requireActive();
    let geometry = this.present(entry).geometry;
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const loops = this.present(entry).loops;
    if (loops.length === 0) return;
    for (const loop of loops) {
      const pts = loop.indices.map((id) => new THREE.Vector3().fromBufferAttribute(pos, id));
      const result = fillHole(geometry, pts, loop.plane);
      geometry = result.geometry;
    }
    const newLoops = extractBoundaryLoops(geometry);
    this.clearPreviewSilent();
    this.pushSnapshot(entry, `自动补洞×${loops.length}`, geometry, newLoops);
    this.emit();
  }

  // ---------------------------------------------------------------- 微调
  /** 顶点级微调：移动单个断面内部顶点（aCap=2） */
  moveCapVertex(vertexId: number, target: THREE.Vector3) {
    const entry = this.requireActive();
    const current = this.present(entry);
    const geometry = current.geometry.clone();
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (vertexId < 0 || vertexId >= pos.count) return;
    pos.setXYZ(vertexId, target.x, target.y, target.z);
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.computeBoundsTree();
    const loops = extractBoundaryLoops(geometry);
    this.clearPreviewSilent();
    this.pushSnapshot(entry, '顶点微调', geometry, loops);
    this.emit();
  }

  /**
   * 断面平移微调：整体平移某个断面（通过断面三角形分组定位其顶点）。
   * @param pickVertexId 在该断面上拾取到的任意顶点
   */
  translateCap(pickVertexId: number, delta: THREE.Vector3, label = '断面平移') {
    const entry = this.requireActive();
    const current = this.present(entry);
    const geometry = current.geometry.clone();
    const capGroup = geometry.groups.find((g) => g.materialIndex === 1);
    if (!capGroup) return;
    const index = geometry.index!;
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;

    // 找到包含拾取顶点的连通断面分量（沿三角形邻接传播）。
    // 拾取点可能是器官网格的边界环顶点，而补洞断面用的是坐标重合的复制
    // 顶点（id 不同），因此先按坐标把拾取点映射到断面 group 内的顶点。
    const member = new Set<number>();
    const triOfVertex = new Map<number, number[]>();
    const capVertexIds: number[] = [];
    for (let i = capGroup.start; i < capGroup.start + capGroup.count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const id = index.getX(i + k);
        if (!triOfVertex.has(id)) {
          triOfVertex.set(id, []);
          capVertexIds.push(id);
        }
        triOfVertex.get(id)!.push(i / 3);
      }
    }
    let seedId = pickVertexId;
    if (!triOfVertex.has(seedId)) {
      // 坐标匹配：找与拾取顶点重合的断面顶点（吸附复制体）
      const px = pos.getX(pickVertexId);
      const py = pos.getY(pickVertexId);
      const pz = pos.getZ(pickVertexId);
      let best = -1;
      let bestD = 1e-12;
      for (const id of capVertexIds) {
        const d =
          (pos.getX(id) - px) ** 2 + (pos.getY(id) - py) ** 2 + (pos.getZ(id) - pz) ** 2;
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best < 0) return; // 拾取点不属于任何断面
      seedId = best;
    }
    const stack = triOfVertex.get(seedId) ? [...triOfVertex.get(seedId)!] : [];
    const seenTri = new Set<number>();
    while (stack.length) {
      const t = stack.pop()!;
      if (seenTri.has(t)) continue;
      seenTri.add(t);
      const base = t * 3;
      for (let k = 0; k < 3; k++) {
        const id = index.getX(base + k);
        member.add(id);
        for (const nt of triOfVertex.get(id) ?? []) if (!seenTri.has(nt)) stack.push(nt);
      }
    }
    if (member.size === 0) return;

    for (const id of member) {
      pos.setXYZ(id, pos.getX(id) + delta.x, pos.getY(id) + delta.y, pos.getZ(id) + delta.z);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.computeBoundsTree();
    const loops = extractBoundaryLoops(geometry);
    this.clearPreviewSilent();
    this.pushSnapshot(entry, label, geometry, loops);
    this.emit();
  }

  /** 在断面上追加一个可调内部顶点 */
  addHandle(point: THREE.Vector3) {
    const entry = this.requireActive();
    const current = this.present(entry);
    const result = insertCapHandle(current.geometry, point);
    if (!result) return;
    const loops = extractBoundaryLoops(result.geometry);
    this.clearPreviewSilent();
    this.pushSnapshot(entry, '添加调整点', result.geometry, loops);
    this.emit();
  }

  // ---------------------------------------------------------------- 撤销重做
  undo() {
    const entry = this.requireActive();
    if (entry.cursor <= 0) return;
    this.clearPreviewSilent();
    entry.cursor--;
    this.emit();
  }

  redo() {
    const entry = this.requireActive();
    if (entry.cursor >= entry.snapshots.length - 1) return;
    this.clearPreviewSilent();
    entry.cursor++;
    // 快照保存了完整几何与环，重做后断面与轮廓完全还原
    this.emit();
  }

  // ---------------------------------------------------------------- 摘要
  getSummary(): StoreSummary {
    if (this.cachedSummary) return this.cachedSummary;
    const entry = this.activeOrganId ? this.organs.get(this.activeOrganId) : undefined;
    const present = entry ? this.present(entry) : null;
    const summary: StoreSummary = {
      organs: this.order.map((id) => {
        const o = this.organs.get(id)!;
        const p = this.present(o);
        return {
          id,
          name: o.name,
          triangleCount: p.triangleCount / 3,
          vertexCount: p.vertexCount,
        };
      }),
      activeOrganId: this.activeOrganId,
      canUndo: !!entry && entry.cursor > 0,
      canRedo: !!entry && entry.cursor < entry.snapshots.length - 1,
      undoCount: entry ? entry.cursor : 0,
      redoCount: entry ? entry.snapshots.length - 1 - entry.cursor : 0,
      historyLabels: entry ? entry.snapshots.map((s) => s.label) : [],
      cursor: entry ? entry.cursor : 0,
      loopCount: present ? present.loops.length : 0,
      previewActive: this.previewGeometry !== null,
      version: this.version,
    };
    this.cachedSummary = summary;
    return summary;
  }
}

export const editorStore = new EditorStore();
