import * as THREE from 'three';
import type { AnnotationRecord, AxisName } from '../types';
import { local2DToWorld } from './section';
import { PLANE_FRAMES } from './joint';

const DIM_COLOR = 0xffd54a;
const OFFSET = 0.055; // 尺寸线相对标注连线的偏移(米)
const TEXT_PX = 30; // 画布内文字像素高度

/** 单个尺寸标注:两条延伸线 + 尺寸线 + 两端斜划 + 朝屏文字 Sprite */
export class AnnotationView {
  readonly group: THREE.Group;
  readonly record: AnnotationRecord;
  private line: THREE.LineSegments;
  private points: THREE.Points;
  private sprite: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private worldLength = 0;

  constructor(record: AnnotationRecord) {
    this.record = record;
    this.group = new THREE.Group();
    this.group.name = `annotation-${record.id}`;

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: DIM_COLOR,
      depthTest: false,
      transparent: true,
    });
    this.line = new THREE.LineSegments(lineGeo, lineMat);
    this.line.renderOrder = 20;
    this.group.add(this.line);

    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const pointMat = new THREE.PointsMaterial({
      color: DIM_COLOR,
      size: 9,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
    });
    this.points = new THREE.Points(pointGeo, pointMat);
    this.points.renderOrder = 21;
    this.group.add(this.points);

    this.canvas = document.createElement('canvas');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({
      map: this.texture,
      depthTest: false,
      transparent: true,
    });
    this.sprite = new THREE.Sprite(spriteMat);
    this.sprite.renderOrder = 22;
    this.group.add(this.sprite);
  }

  /** 锚点重定位后刷新几何与数值;offset 为当前剖切面偏移 */
  update(
    p1World: THREE.Vector3 | null,
    p2World: THREE.Vector3 | null,
    offset: number,
    camera: THREE.Camera,
  ): void {
    const visible = p1World !== null && p2World !== null;
    this.group.visible = visible;
    if (!visible || !p1World || !p2World) return;

    const axis = this.record.plane;
    const frame = PLANE_FRAMES[axis];
    const dir = new THREE.Vector3().subVectors(p2World, p1World);
    this.worldLength = dir.length();
    if (this.worldLength < 1e-9) {
      this.group.visible = false;
      return;
    }
    dir.normalize();
    // 尺寸线偏移方向 = 法线 × 标注方向
    const offDir = new THREE.Vector3().crossVectors(frame.normal, dir).normalize();
    const q1 = p1World.clone().addScaledVector(offDir, OFFSET);
    const q2 = p2World.clone().addScaledVector(offDir, OFFSET);
    const tick = 0.018;
    const tickDir = new THREE.Vector3().crossVectors(frame.normal, offDir).normalize();

    const verts: number[] = [];
    // 延伸线(2 段)
    pushSeg(verts, p1World, q1);
    pushSeg(verts, p2World, q2);
    // 尺寸线(1 段)
    pushSeg(verts, q1, q2);
    // 两端斜划(2 段)
    pushSeg(
      verts,
      q1.clone().addScaledVector(tickDir, -tick),
      q1.clone().addScaledVector(tickDir, tick),
    );
    pushSeg(
      verts,
      q2.clone().addScaledVector(tickDir, -tick),
      q2.clone().addScaledVector(tickDir, tick),
    );
    this.line.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(verts, 3),
    );
    this.line.geometry.computeBoundingSphere();

    const posAttr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.setXYZ(0, p1World.x, p1World.y, p1World.z);
    posAttr.setXYZ(1, p2World.x, p2World.y, p2World.z);
    posAttr.needsUpdate = true;
    this.points.geometry.computeBoundingSphere();

    const mid = new THREE.Vector3().addVectors(q1, q2).multiplyScalar(0.5);
    this.sprite.position
      .copy(mid)
      .addScaledVector(offDir, 0.045)
      .addScaledVector(frame.normal, 0.002);
    this.scaleSprite(camera);
    void offset;
  }

  redrawText(): void {
    const label = `${(this.worldLength * 1000).toFixed(1)} mm`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = this.canvas.getContext('2d')!;
    const font = `600 ${TEXT_PX}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.font = font;
    const metrics = ctx.measureText(label);
    const padX = 14 * dpr;
    const padY = 8 * dpr;
    this.canvas.width = Math.ceil(metrics.width + padX * 2);
    this.canvas.height = TEXT_PX * dpr + padY * 2;

    ctx.font = font;
    ctx.textBaseline = 'middle';
    // 半透明深色底,保证在木纹上可读
    const r = 7 * dpr;
    roundRect(ctx, 0, 0, this.canvas.width, this.canvas.height, r);
    ctx.fillStyle = 'rgba(20, 22, 26, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 213, 74, 0.9)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.stroke();
    ctx.fillStyle = '#ffd54a';
    ctx.fillText(label, padX, this.canvas.height / 2 + 1 * dpr);
    this.texture.needsUpdate = true;
  }

  /** 让文字在屏幕上保持恒定像素尺寸 */
  scaleSprite(camera: THREE.Camera): void {
    if (!this.group.visible) return;
    const dist = camera.position.distanceTo(this.sprite.position);
    const viewH =
      camera instanceof THREE.PerspectiveCamera
        ? 2 * dist * Math.tan((camera.fov * Math.PI) / 360)
        : (camera as THREE.OrthographicCamera).top - (camera as THREE.OrthographicCamera).bottom;
    const h = (this.canvas.height / (window.innerHeight || 1)) * viewH;
    const w = h * (this.canvas.width / this.canvas.height);
    this.sprite.scale.set(w, h, 1);
  }

  /** 文字世界坐标(供屏幕空间拾取) */
  labelPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.sprite.position);
  }

  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.texture.dispose();
    (this.sprite.material as THREE.Material).dispose();
  }
}

/** 标注图层:管理全部标注视图,批量刷新与节流重绘文字 */
export class AnnotationLayer {
  readonly root = new THREE.Group();
  private views = new Map<string, AnnotationView>();
  private redrawPending = false;

  constructor() {
    this.root.name = 'annotation-layer';
  }

  get size(): number {
    return this.views.size;
  }

  has(id: string): boolean {
    return this.views.has(id);
  }

  add(record: AnnotationRecord): AnnotationView {
    const view = new AnnotationView(record);
    this.views.set(record.id, view);
    this.root.add(view.group);
    return view;
  }

  remove(id: string): boolean {
    const view = this.views.get(id);
    if (!view) return false;
    this.root.remove(view.group);
    view.dispose();
    this.views.delete(id);
    return true;
  }

  get(id: string): AnnotationView | undefined {
    return this.views.get(id);
  }

  all(): AnnotationView[] {
    return [...this.views.values()];
  }

  /** 相机变化时同步所有 Sprite 的屏幕尺寸 */
  refreshSpriteScales(camera: THREE.Camera): void {
    for (const view of this.views.values()) view.scaleSprite(camera);
  }

  /** 剖切面拖动中节流调用:合并到一帧重绘所有文字画布 */
  scheduleTextRedraw(): void {
    if (this.redrawPending) return;
    this.redrawPending = true;
    requestAnimationFrame(() => {
      this.redrawPending = false;
      for (const view of this.views.values()) {
        if (view.group.visible) view.redrawText();
      }
    });
  }

  redrawAllNow(): void {
    for (const view of this.views.values()) view.redrawText();
  }

  clear(): void {
    for (const id of [...this.views.keys()]) this.remove(id);
  }
}

function pushSeg(verts: number[], a: THREE.Vector3, b: THREE.Vector3): void {
  verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { local2DToWorld };
export type { AxisName };
