import {
  Box3,
  Box3Helper,
  CatmullRomCurve3,
  Color,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Sphere,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  CanvasTexture,
  LineBasicMaterial,
  BufferGeometry,
  Line,
  RingGeometry,
  DoubleSide
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  ClipMode,
  PointCloudOctree,
  Potree,
  createClipBox
} from 'potree-core';
import type { PointCloudMaterial } from 'potree-core';
import { LocalRequestManager, buildLocalUrl } from './local-request-manager';
import { easeInOutCubic } from './util';
import { EVIDENCE_META } from './evidence';
import type { EvidenceMarker, PathKeyPoint, TourPath } from '../types';

export interface FlyOptions {
  duration?: number;
  /** 到达后看向的目标点；默认看向飞行目的地本身（适合平面图点选定位） */
  lookAt?: Vector3;
}

interface Tween {
  fromPos: Vector3;
  toPos: Vector3;
  fromTarget: Vector3;
  toTarget: Vector3;
  elapsed: number;
  duration: number;
  resolve: () => void;
}

/** 标记三维表现（球体 + 编号 Sprite + 投影光圈） */
class MarkerObject extends Group {
  markerId: string;
  private label: Sprite;
  private ring: Mesh;
  private stem: Line;

  constructor(marker: EvidenceMarker) {
    super();
    this.markerId = marker.id;
    const meta = EVIDENCE_META[marker.type];
    const pos = new Vector3(marker.position.x, marker.position.y, marker.position.z);

    const sphere = new Mesh(
      new SphereGeometry(0.35, 20, 16),
      new MeshBasicMaterial({ color: new Color(meta.color), depthTest: false })
    );
    sphere.renderOrder = 10;
    this.add(sphere);

    this.label = this.makeLabel(`${meta.icon}${marker.seq}`, meta.color);
    this.label.scale.set(1.6, 0.8, 1);
    this.label.position.set(0, 0.75, 0);
    this.label.renderOrder = 11;
    this.add(this.label);

    // 地面投影光圈（放在标记正下方 0.01，高度由 scene manager 校正到裁剪盒底部）
    this.ring = new Mesh(
      new RingGeometry(0.28, 0.42, 28),
      new MeshBasicMaterial({ color: new Color(meta.color), side: DoubleSide, transparent: true, opacity: 0.85, depthTest: false })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 9;
    this.add(this.ring);

    // 连接球体与地面的竖线
    const lineGeo = new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, -1, 0)]);
    this.stem = new Line(lineGeo, new LineBasicMaterial({ color: new Color(meta.color), transparent: true, opacity: 0.7, depthTest: false }));
    this.stem.renderOrder = 9;
    this.add(this.stem);

    this.position.copy(pos);
    this.userData.draggable = true;
    this.userData.kind = 'marker';
  }

  private makeLabel(text: string, color: string): Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.beginPath();
    ctx.roundRect(4, 12, 152, 56, 12);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 34px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 80, 40);
    const tex = new CanvasTexture(canvas);
    const mat = new SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    return new Sprite(mat);
  }

  updateLabel(marker: EvidenceMarker): void {
    const meta = EVIDENCE_META[marker.type];
    this.remove(this.label);
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.label = this.makeLabel(`${meta.icon}${marker.seq}`, meta.color);
    this.label.scale.set(1.6, 0.8, 1);
    this.label.position.set(0, 0.75, 0);
    this.label.renderOrder = 11;
    this.add(this.label);
    const sphere = this.children[0] as Mesh;
    (sphere.material as MeshBasicMaterial).color.set(meta.color);
    (this.ring.material as MeshBasicMaterial).color.set(meta.color);
    (this.stem.material as LineBasicMaterial).color.set(meta.color);
  }

  /** 把光圈/竖线落到给定地面高度 */
  setGroundHeight(y: number): void {
    const h = this.position.y - y;
    this.ring.position.set(0, -h - 0.02, 0);
    const geo = this.stem.geometry;
    geo.setFromPoints([new Vector3(0, 0, 0), new Vector3(0, -Math.max(h, 0), 0)]);
  }
}

/** 路径关键点三维表现 */
class PathPointObject extends Group {
  pointId: string;
  constructor(position: Vector3, index: number, accent = '#f59e0b') {
    super();
    this.pointId = '';
    const cone = new Mesh(
      new SphereGeometry(0.28, 16, 12),
      new MeshBasicMaterial({ color: new Color(accent), depthTest: false })
    );
    cone.renderOrder = 10;
    this.add(cone);

    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(245, 158, 11, 0.95)';
    ctx.beginPath();
    ctx.arc(48, 48, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), 48, 50);
    const sprite = new Sprite(
      new SpriteMaterial({ map: new CanvasTexture(canvas), transparent: true, depthTest: false })
    );
    sprite.scale.set(0.9, 0.9, 1);
    sprite.position.y = 0.65;
    sprite.renderOrder = 11;
    this.add(sprite);
    this.position.copy(position);
    this.userData.draggable = true;
    this.userData.kind = 'pathPoint';
  }
}

export class ThreeSceneManager {
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly scene: Scene;
  readonly potree: Potree;

  private pointClouds: PointCloudOctree[] = [];
  private markerGroup = new Group();
  private pathGroup = new Group();
  private clipHelper: Box3Helper | null = null;
  private markerObjects = new Map<string, MarkerObject>();
  private pathPointObjects = new Map<string, PathPointObject>();
  private pathLine: Line | null = null;
  private groundY = 0;

  private raycaster = new Raycaster();
  private tween: Tween | null = null;
  private tourState: {
    curve: CatmullRomCurve3;
    total: number;
    elapsed: number;
    duration: number;
    resolve: () => void;
    lookAts: (Vector3 | null)[];
  } | null = null;

  /** 拖拽状态 */
  private drag: { kind: 'marker' | 'pathPoint'; id: string; plane: Plane; offset: Vector3; moved: boolean } | null = null;
  /** 最近一次指针按下是否落在标记/路径点上（供视图层区分点击与拖拽） */
  pointerDownOnObject = false;
  /** 最近一次拖拽是否真的发生了位移 */
  pointerDragMoved = false;
  /** 当前交互模式（由视图层从 store 同步），激活时点击穿透标记对象 */
  placeMode = false;
  recordMode = false;
  /** 当前点云世界包围盒 */
  cloudBox: Box3 | null = null;
  /** 当前裁剪盒（世界坐标） */
  clipBox: Box3 | null = null;

  /** 相机状态变化回调（驱动平面图联动） */
  onCameraChange: ((pos: Vector3, dir: Vector3) => void) | null = null;
  /** 标记被拖动结束回调，参数为新坐标 */
  onMarkerMoved: ((id: string, pos: Vector3) => void) | null = null;
  onPathPointMoved: ((id: string, pos: Vector3) => void) | null = null;
  /** 点云加载进度 */
  onProgress: ((progress: number) => void) | null = null;
  /** 点云加载完成、包围盒可用时触发一次 */
  onCloudReady: ((box: Box3) => void) | null = null;

  private container: HTMLElement;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private lastProgressEmit = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.scene = new Scene();
    this.scene.background = new Color(0x0f172a);
    this.camera = new PerspectiveCamera(60, width / height, 0.05, 20000);
    this.camera.position.set(10, 10, 10);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.potree = new Potree();
    // 几千万点场景放宽点预算，配合 LOD 仍保持流畅
    this.potree.pointBudget = 5_000_000;
    this.potree.maxNumNodesLoading = 6;

    this.scene.add(this.markerGroup, this.pathGroup);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.bindPointerEvents();
    this.loop();
  }

  // ---------- 点云加载 ----------

  /**
   * 从本地数据仓加载点云。
   * @param cloudKey IndexedDB 中的条目键
   */
  async loadLocalCloud(cloudKey: string): Promise<PointCloudOctree> {
    this.clearCloud();
    const rm = new LocalRequestManager();
    // 2.x 与 1.x 的入口文件名不同，先探测 metadata.json
    let entry = buildLocalUrl(cloudKey, 'metadata.json');
    let pco: PointCloudOctree;
    try {
      pco = await this.potree.loadPointCloud(entry, rm);
    } catch (err) {
      console.warn('[potree] metadata.json 入口失败，尝试 cloud.js：', err);
      entry = buildLocalUrl(cloudKey, 'cloud.js');
      pco = await this.potree.loadPointCloud(entry, rm);
    }

    this.scene.add(pco);
    this.pointClouds = [pco];
    this.cloudBox = pco.getBoundingBoxWorld().clone();
    this.groundY = this.cloudBox.min.y;
    this.frameBox(this.cloudBox);

    const material = pco.material as PointCloudMaterial;
    material.size = 1.2;
    material.minSize = 1;
    material.maxSize = 8;
    material.opacity = 1;

    // 进度轮询：potree 的 progress 属性反映已加载节点比例
    const progressTimer = window.setInterval(() => {
      if (this.disposed || !this.pointClouds.includes(pco)) {
        window.clearInterval(progressTimer);
        return;
      }
      const now = performance.now();
      if (now - this.lastProgressEmit > 200) {
        this.lastProgressEmit = now;
        this.onProgress?.(pco.progress ?? 0);
      }
      if ((pco.progress ?? 0) >= 1) window.clearInterval(progressTimer);
    }, 250);

    this.onCloudReady?.(this.cloudBox!);
    return pco;
  }

  clearCloud(): void {
    for (const pco of this.pointClouds) {
      this.scene.remove(pco);
      pco.dispose();
    }
    this.pointClouds = [];
    this.cloudBox = null;
    this.clipBox = null;
    if (this.clipHelper) {
      this.scene.remove(this.clipHelper);
      this.clipHelper.geometry.dispose();
      (this.clipHelper.material as Material).dispose();
      this.clipHelper = null;
    }
  }

  get hasCloud(): boolean {
    return this.pointClouds.length > 0;
  }

  /** 当前已加载的点云对象（只读视图） */
  get clouds(): readonly PointCloudOctree[] {
    return this.pointClouds;
  }

  /** 当前三维中存在的标记 ID */
  get markerIds(): Set<string> {
    return new Set(this.markerObjects.keys());
  }

  /** 让相机框住指定包围盒 */
  frameBox(box: Box3): void {
    const sphere = box.getBoundingSphere(new Sphere());
    const dir = new Vector3(0.6, 0.8, 1).normalize();
    const dist = sphere.radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.4;
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.controls.target.copy(sphere.center);
    this.controls.update();
  }

  // ---------- 裁剪 ----------

  /** 设置/更新包围盒裁剪；box 为 null 时取消裁剪 */
  setClipBox(box: Box3 | null): void {
    this.clipBox = box ? box.clone() : null;
    const pco = this.pointClouds[0];
    if (!pco) return;
    const material = pco.material as PointCloudMaterial;

    if (!box) {
      material.clipMode = ClipMode.DISABLED;
      material.setClipBoxes([]);
      if (this.clipHelper) {
        this.scene.remove(this.clipHelper);
        this.clipHelper = null;
      }
      this.groundY = this.cloudBox?.min.y ?? 0;
    } else {
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      const clip = createClipBox(size, center, 'include');
      material.clipMode = ClipMode.CLIP_OUTSIDE;
      material.setClipBoxes([clip]);

      if (!this.clipHelper) {
        this.clipHelper = new Box3Helper(box, new Color(0x38bdf8));
        this.clipHelper.renderOrder = 5;
        this.scene.add(this.clipHelper);
      } else {
        this.clipHelper.box.copy(box);
      }
      this.groundY = box.min.y;
    }
    this.refreshMarkerGround();
  }

  // ---------- 证据标记 ----------

  addMarker(marker: EvidenceMarker): void {
    const obj = new MarkerObject(marker);
    this.markerGroup.add(obj);
    this.markerObjects.set(marker.id, obj);
    obj.setGroundHeight(this.groundY);
  }

  updateMarker(marker: EvidenceMarker): void {
    const obj = this.markerObjects.get(marker.id);
    if (!obj) return;
    obj.position.set(marker.position.x, marker.position.y, marker.position.z);
    obj.updateLabel(marker);
    obj.setGroundHeight(this.groundY);
  }

  removeMarker(id: string): void {
    const obj = this.markerObjects.get(id);
    if (!obj) return;
    this.markerGroup.remove(obj);
    this.markerObjects.delete(id);
  }

  focusMarker(id: string): void {
    const obj = this.markerObjects.get(id);
    if (obj) this.flyTo(obj.position.clone(), { duration: 0.9 });
  }

  private refreshMarkerGround(): void {
    for (const obj of this.markerObjects.values()) obj.setGroundHeight(this.groundY);
  }

  /**
   * 在屏幕坐标处放置标记：优先命中点云表面，落空时落到与相机视线相交的
   * 当前地面高度平面上，保证任何视角都能放置。
   */
  pickPlacementPoint(clientX: number, clientY: number): Vector3 | null {
    if (!this.hasCloud) return null;
    const ndc = this.toNDC(clientX, clientY);
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray;

    const pco = this.pointClouds[0];
    const hit = Potree.pick(this.pointClouds, this.renderer, this.camera, ray, {
      pickOutsideClipRegion: true
    });
    if (hit?.position) return hit.position.clone();

    // 回退：与地面平面相交
    const groundPlane = new Plane(new Vector3(0, 1, 0), -this.groundY);
    const point = new Vector3();
    if (ray.intersectPlane(groundPlane, point)) {
      // 限制在有效范围内，避免放到无穷远
      const bound = this.clipBox ?? this.cloudBox;
      if (bound) point.clamp(bound.min, bound.max);
      return point;
    }
    return null;
  }

  // ---------- 路径 ----------

  syncPath(path: TourPath | null): void {
    // 清空旧的
    for (const obj of this.pathPointObjects.values()) this.pathGroup.remove(obj);
    this.pathPointObjects.clear();
    if (this.pathLine) {
      this.pathGroup.remove(this.pathLine);
      this.pathLine.geometry.dispose();
      (this.pathLine.material as Material).dispose();
      this.pathLine = null;
    }
    if (!path || path.points.length === 0) return;

    path.points.forEach((kp, i) => {
      const obj = new PathPointObject(new Vector3(kp.position.x, kp.position.y, kp.position.z), i);
      obj.pointId = kp.id;
      this.pathGroup.add(obj);
      this.pathPointObjects.set(kp.id, obj);
    });

    if (path.points.length >= 2) {
      const pts = path.points.map((p) => new Vector3(p.position.x, p.position.y, p.position.z));
      const geo = new BufferGeometry().setFromPoints(pts);
      this.pathLine = new Line(
        geo,
        new LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.85, depthTest: false })
      );
      this.pathLine.renderOrder = 8;
      this.pathGroup.add(this.pathLine);
    }
  }

  /** 在当前相机目标处（或屏幕拾取点）添加路径关键点 */
  pickPathPoint(clientX?: number, clientY?: number): Vector3 {
    if (clientX !== undefined && clientY !== undefined) {
      const p = this.pickPlacementPoint(clientX, clientY);
      if (p) return p;
    }
    return this.controls.target.clone();
  }

  // ---------- 飞行与漫游 ----------

  flyTo(target: Vector3, options: FlyOptions = {}): Promise<void> {
    const duration = options.duration ?? 1.1;
    // 相机停在目标点斜上方，距离按当前包围盒尺度自适应
    const box = this.clipBox ?? this.cloudBox;
    const radius = box ? box.getSize(new Vector3).length() / 2 : 5;
    const standoff = Math.max(1.5, radius * 0.25);
    const dir = new Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0.7, 0.6, 1).normalize();
    const toPos = target.clone().addScaledVector(dir, standoff);

    const lookAt = options.lookAt ?? target.clone();
    return new Promise<void>((resolve) => {
      this.tween = {
        fromPos: this.camera.position.clone(),
        toPos,
        fromTarget: this.controls.target.clone(),
        toTarget: lookAt.clone(),
        elapsed: 0,
        duration,
        resolve
      };
    });
  }

  cancelFlight(): void {
    if (this.tween) {
      this.tween.resolve();
      this.tween = null;
    }
  }

  /** 沿路径播放漫游；返回播放结束的 Promise */
  playTour(path: TourPath): Promise<void> {
    this.stopTour();
    const pts = path.points.map((p) => new Vector3(p.position.x, p.position.y, p.position.z));
    if (pts.length < 2) {
      if (pts.length === 1) return this.flyTo(pts[0]);
      return Promise.resolve();
    }
    const curve = new CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const total = curve.getLength();
    const duration = Math.max(2, total / Math.max(path.speed, 0.01));
    const lookAts = path.points.map((p) =>
      p.lookAt ? new Vector3(p.lookAt.x, p.lookAt.y, p.lookAt.z) : null
    );

    // 起点对齐
    const start = curve.getPointAt(0);
    this.camera.position.copy(start);
    this.controls.target.copy(curve.getPointAt(Math.min(0.01, 1)));
    this.controls.enabled = false;

    return new Promise<void>((resolve) => {
      this.tourState = { curve, total, elapsed: 0, duration, resolve, lookAts };
    });
  }

  stopTour(): void {
    if (this.tourState) {
      this.tourState.resolve();
      this.tourState = null;
    }
    this.controls.enabled = true;
  }

  get isTouring(): boolean {
    return this.tourState !== null;
  }

  // ---------- 视角工具 ----------

  setTopView(): void {
    const box = this.clipBox ?? this.cloudBox;
    if (!box) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const dist = Math.max(size.x, size.z) * 1.1;
    this.flyTo(center.clone().add(new Vector3(0, dist, 0.0001)), {
      lookAt: center,
      duration: 0.8
    });
  }

  // ---------- 坐标拾取与拖拽 ----------

  private toNDC(clientX: number, clientY: number): Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  private bindPointerEvents(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
  }

  private pickDraggable(clientX: number, clientY: number): { kind: 'marker' | 'pathPoint'; id: string; point: Vector3 } | null {
    const ndc = this.toNDC(clientX, clientY);
    this.raycaster.setFromCamera(ndc, this.camera);
    const candidates: Object3D[] = [];
    for (const m of this.markerObjects.values()) candidates.push(m);
    for (const p of this.pathPointObjects.values()) candidates.push(p);
    const hits = this.raycaster.intersectObjects(candidates, true);
    if (hits.length === 0) return null;
    let obj: Object3D | null = hits[0].object;
    while (obj && !obj.userData.draggable) obj = obj.parent;
    if (!obj) return null;
    return {
      kind: obj.userData.kind,
      id: obj.userData.kind === 'marker' ? (obj as MarkerObject).markerId : (obj as PathPointObject).pointId,
      point: hits[0].point.clone()
    };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    // 放置标记/记录走位模式下，点击应穿透标记与路径点，避免误触发拖拽
    if (this.placeMode || this.recordMode) {
      this.pointerDownOnObject = false;
      this.pointerDragMoved = false;
      return;
    }
    const hit = this.pickDraggable(e.clientX, e.clientY);
    this.pointerDownOnObject = !!hit;
    this.pointerDragMoved = false;
    if (!hit) return;
    const root =
      hit.kind === 'marker' ? this.markerObjects.get(hit.id)! : this.pathPointObjects.get(hit.id)!;
    // 拖拽平面：过物体中心、朝向相机的水平面（保持 y 不变，符合现场平面挪动语义）
    const plane = new Plane(new Vector3(0, 1, 0), -root.position.y);
    const planePoint = new Vector3();
    this.raycaster.setFromCamera(this.toNDC(e.clientX, e.clientY), this.camera);
    this.raycaster.ray.intersectPlane(plane, planePoint);
    const offset = root.position.clone().sub(planePoint);
    this.drag = { kind: hit.kind, id: hit.id, plane, offset, moved: false };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag) return;
    this.raycaster.setFromCamera(this.toNDC(e.clientX, e.clientY), this.camera);
    const point = new Vector3();
    if (!this.raycaster.ray.intersectPlane(this.drag.plane, point)) return;
    point.add(this.drag.offset);
    const bound = this.clipBox ?? this.cloudBox;
    if (bound) point.clamp(bound.min, bound.max);
    const obj =
      this.drag.kind === 'marker'
        ? this.markerObjects.get(this.drag.id)
        : this.pathPointObjects.get(this.drag.id);
    if (obj) {
      obj.position.x = point.x;
      obj.position.z = point.z;
      this.drag.moved = true;
      this.pointerDragMoved = true;
      if (this.drag.kind === 'marker') (obj as MarkerObject).setGroundHeight(this.groundY);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.drag) return;
    const { kind, id } = this.drag;
    const obj =
      kind === 'marker' ? this.markerObjects.get(id) : this.pathPointObjects.get(id);
    const pos = obj ? obj.position.clone() : null;
    this.drag = null;
    this.controls.enabled = true;
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
    if (pos) {
      if (kind === 'marker') this.onMarkerMoved?.(id, pos);
      else this.onPathPointMoved?.(id, pos);
    }
    setTimeout(() => {
      this.pointerDownOnObject = false;
      this.pointerDragMoved = false;
    }, 0);
  };

  // ---------- 渲染循环 ----------

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private loop = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    const dt = 1 / 60;

    if (this.tween) {
      const tw = this.tween;
      tw.elapsed += dt;
      const t = Math.min(1, tw.elapsed / tw.duration);
      const k = easeInOutCubic(t);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (t >= 1) {
        this.tween = null;
        tw.resolve();
      }
    }

    if (this.tourState) {
      const tour = this.tourState;
      tour.elapsed += dt;
      const t = Math.min(1, tour.elapsed / tour.duration);
      const u = t;
      const pos = tour.curve.getPointAt(u);
      this.camera.position.copy(pos);
      // 朝向：固定 lookAt 优先，否则沿切线方向
      const segIndex = this.segmentIndexAt(u, tour.lookAts.length);
      const fixed = tour.lookAts[segIndex];
      if (fixed) this.controls.target.copy(fixed);
      else {
        const tangent = tour.curve.getTangentAt(Math.min(u + 0.002, 1));
        this.controls.target.copy(pos).add(tangent);
      }
      if (t >= 1) {
        this.tourState = null;
        this.controls.enabled = true;
        tour.resolve();
      }
    }

    if (!this.tourState) this.controls.update();

    if (this.pointClouds.length > 0) {
      this.potree.updatePointClouds(this.pointClouds, this.camera, this.renderer);
      // potree 的 updateMatrixWorld 重写不递归子树，渲染前强制整棵场景树更新一次，
      // 保证点云 offset 平移与节点局部矩阵正确传导到 matrixWorld
      this.scene.updateMatrixWorld(true);
    }
    this.renderer.render(this.scene, this.camera);

    this.onCameraChange?.(this.camera.position.clone(), this.camera.getWorldDirection(new Vector3()));
  };

  private segmentIndexAt(u: number, count: number): number {
    if (count <= 1) return 0;
    return Math.min(count - 1, Math.floor(u * (count - 1)));
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerup', this.onPointerUp);
    this.clearCloud();
    this.controls.dispose();
    this.renderer.dispose();
    dom.remove();
  }
}
