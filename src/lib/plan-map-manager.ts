import { Box3, Vector3 } from 'three';
import type { EvidenceMarker, PathKeyPoint } from '../types';
import { EVIDENCE_META } from './evidence';
import { PlanMapProjection } from './map-projection';

export interface MapMarkerClick {
  markerId: string;
}

export interface MapPathPointClick {
  pointId: string;
}

export interface MapCallbacks {
  /** 平面图空白处点选：请求三维飞到对应世界位置 */
  onLocate: (worldX: number, worldZ: number) => void;
  onMarkerClick: (id: string) => void;
  onMarkerDrag: (id: string, worldX: number, worldZ: number) => void;
  onPathPointClick: (id: string) => void;
  onPathPointDrag: (id: string, worldX: number, worldZ: number) => void;
}

interface CameraIndicator {
  position: Vector3;
  direction: Vector3;
}

const MARKER_RADIUS = 11;
const PATH_RADIUS = 9;

/**
 * 俯视平面图渲染与交互。
 * 所有绘制每帧重画（对象数量为标记/路径点量级，开销可忽略），
 * 坐标全部经 PlanMapProjection 换算，裁剪与缩放后映射保持一致。
 */
export class PlanMapManager {
  readonly projection = new PlanMapProjection();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: MapCallbacks;

  private markers: EvidenceMarker[] = [];
  private pathPoints: PathKeyPoint[] = [];
  private bounds: Box3 | null = null;
  private camera: CameraIndicator | null = null;

  private dragTarget:
    | { kind: 'marker' | 'pathPoint'; id: string; moved: boolean }
    | null = null;
  private panState: { startX: number; startY: number; baseOX: number; baseOY: number } | null = null;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, callbacks: MapCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 上下文');
    this.ctx = ctx;
    this.bindEvents();
  }

  setBounds(box: Box3): void {
    this.bounds = box.clone();
    this.projection.setOrigin(box);
    this.resize();
    this.projection.fitBox(box, this.canvas.clientWidth, this.canvas.clientHeight);
    this.draw();
  }

  setMarkers(markers: EvidenceMarker[]): void {
    this.markers = markers;
    this.draw();
  }

  setPathPoints(points: PathKeyPoint[]): void {
    this.pathPoints = points;
    this.draw();
  }

  updateCamera(position: Vector3, direction: Vector3): void {
    this.camera = { position: position.clone(), direction: direction.clone() };
    this.draw();
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  fitView(): void {
    if (this.bounds) {
      this.projection.fitBox(this.bounds, this.canvas.clientWidth, this.canvas.clientHeight);
      this.draw();
    }
  }

  // ---------- 绘制 ----------

  draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // 背景网格
    this.drawGrid(w, h);

    // 裁剪/点云边界框
    if (this.bounds) this.drawBounds();

    // 路径连线
    this.drawPathLine();

    // 标记投影
    for (const m of this.markers) this.drawMarker(m);

    // 路径关键点
    this.pathPoints.forEach((p, i) => this.drawPathPoint(p, i));

    // 相机位置指示
    if (this.camera) this.drawCamera();
  }

  private drawGrid(w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, w, h);
    if (!this.bounds) return;
    // 网格间距按尺度自适应到约 64px
    const worldStep = this.pickGridStep(64 / this.projection.scale);
    const startX = Math.floor(this.bounds.min.x / worldStep) * worldStep;
    const startZ = Math.floor(this.bounds.min.z / worldStep) * worldStep;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= this.bounds.max.x; x += worldStep) {
      const a = this.projection.worldToCanvas(x, this.bounds.min.z);
      const b = this.projection.worldToCanvas(x, this.bounds.max.z);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    for (let z = startZ; z <= this.bounds.max.z; z += worldStep) {
      const a = this.projection.worldToCanvas(this.bounds.min.x, z);
      const b = this.projection.worldToCanvas(this.bounds.max.x, z);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  private pickGridStep(raw: number): number {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const candidates = [1, 2, 5, 10].map((m) => m * pow);
    return candidates.find((c) => c >= raw) ?? candidates[candidates.length - 1];
  }

  private drawBounds(): void {
    const ctx = this.ctx;
    const b = this.bounds!;
    const corners = [
      this.projection.worldToCanvas(b.min.x, b.min.z),
      this.projection.worldToCanvas(b.max.x, b.min.z),
      this.projection.worldToCanvas(b.max.x, b.max.z),
      this.projection.worldToCanvas(b.min.x, b.max.z)
    ];
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawPathLine(): void {
    if (this.pathPoints.length < 2) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    this.pathPoints.forEach((p, i) => {
      const c = this.projection.worldToCanvas(p.position.x, p.position.z);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawMarker(m: EvidenceMarker): void {
    const ctx = this.ctx;
    const meta = EVIDENCE_META[m.type];
    const c = this.projection.worldToCanvas(m.position.x, m.position.z);
    // 投影光圈
    ctx.beginPath();
    ctx.arc(c.x, c.y, MARKER_RADIUS + 3, 0, Math.PI * 2);
    ctx.fillStyle = `${meta.color}33`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c.x, c.y, MARKER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = meta.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f8fafc';
    ctx.stroke();
    // 编号文字
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(m.seq), c.x, c.y + 0.5);
  }

  private drawPathPoint(p: PathKeyPoint, index: number): void {
    const ctx = this.ctx;
    const c = this.projection.worldToCanvas(p.position.x, p.position.z);
    ctx.beginPath();
    ctx.rect(c.x - PATH_RADIUS, c.y - PATH_RADIUS, PATH_RADIUS * 2, PATH_RADIUS * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1f2937';
    ctx.stroke();
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), c.x, c.y + 0.5);
  }

  private drawCamera(): void {
    const ctx = this.ctx;
    const { position, direction } = this.camera!;
    const c = this.projection.worldToCanvas(position.x, position.z);
    // 朝向角（XZ 平面；注意 Z 翻转）
    const angle = Math.atan2(-direction.z, direction.x);
    const fov = (60 * Math.PI) / 180;
    const len = 26;

    // 视锥扇形
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.arc(c.x, c.y, len, angle - fov / 2, angle + fov / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.fill();

    // 位置点
    ctx.beginPath();
    ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#e0f2fe';
    ctx.stroke();

    // 朝向线
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + Math.cos(angle) * len, c.y + Math.sin(angle) * len);
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ---------- 交互 ----------

  private canvasPos(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private hitTest(p: { x: number; y: number }): { kind: 'marker' | 'pathPoint'; id: string } | null {
    // 后画的在上层，反向检测；路径点优先于标记
    for (let i = this.pathPoints.length - 1; i >= 0; i--) {
      const pp = this.pathPoints[i];
      const c = this.projection.worldToCanvas(pp.position.x, pp.position.z);
      if (Math.abs(p.x - c.x) <= PATH_RADIUS + 3 && Math.abs(p.y - c.y) <= PATH_RADIUS + 3) {
        return { kind: 'pathPoint', id: pp.id };
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      const c = this.projection.worldToCanvas(m.position.x, m.position.z);
      if (Math.hypot(p.x - c.x, p.y - c.y) <= MARKER_RADIUS + 4) {
        return { kind: 'marker', id: m.id };
      }
    }
    return null;
  }

  private bindEvents(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onPointerDown = (e: PointerEvent): void => {
    const p = this.canvasPos(e);
    const hit = this.hitTest(p);
    this.canvas.setPointerCapture(e.pointerId);
    if (hit) {
      this.dragTarget = { kind: hit.kind, id: hit.id, moved: false };
    } else if (e.button === 1 || e.shiftKey || e.button === 2) {
      // 平移
      this.panState = { startX: e.clientX, startY: e.clientY, baseOX: this.projection.offsetX, baseOY: this.projection.offsetY };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.canvasPos(e);
    if (this.dragTarget) {
      const world = this.projection.canvasToWorld(p.x, p.y);
      this.dragTarget.moved = true;
      if (this.dragTarget.kind === 'marker') this.callbacks.onMarkerDrag(this.dragTarget.id, world.x, world.z);
      else this.callbacks.onPathPointDrag(this.dragTarget.id, world.x, world.z);
      return;
    }
    if (this.panState) {
      this.projection.offsetX = this.panState.baseOX + (e.clientX - this.panState.startX);
      this.projection.offsetY = this.panState.baseOY + (e.clientY - this.panState.startY);
      this.draw();
    } else {
      this.canvas.style.cursor = this.hitTest(p) ? 'grab' : 'crosshair';
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.canvasPos(e);
    if (this.dragTarget) {
      const t = this.dragTarget;
      if (!t.moved) {
        if (t.kind === 'marker') this.callbacks.onMarkerClick(t.id);
        else this.callbacks.onPathPointClick(t.id);
      }
      this.dragTarget = null;
      return;
    }
    if (this.panState) {
      this.panState = null;
      return;
    }
    // 空白点选 -> 三维联动定位
    if (e.button === 0) {
      const world = this.projection.canvasToWorld(p.x, p.y);
      this.callbacks.onLocate(world.x, world.z);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.canvasPos(e);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.projection.zoom(factor, p);
    this.draw();
  };

  dispose(): void {
    const canvas = this.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
  }
}
