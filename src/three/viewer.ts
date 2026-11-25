import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { AnnotationRecord, AxisName, MeasureRecord, ToolMode } from '../types';
import type { AppStore } from '../store';
import { buildJoint, PLANE_FRAMES, type JointModel } from './joint';
import { createWoodMaterials } from './wood';
import { PlaneHandle } from './planeHandle';
import { AnnotationLayer, AnnotationView } from './annotation';
import {
  buildCapGeometry,
  computeSection,
  local2DToWorld,
  makePlane,
  nearestPointOnContour,
  worldToLocal2D,
  type SectionLoop,
  type SectionResult,
} from './section';
import { measureOnSection, nearestSectionAxis } from './measure';
import './bvh';

const AXES: AxisName[] = ['x', 'y', 'z'];
const SNAP_LIMIT_M = 0.08; // 距轮廓 8cm 内允许吸附(拾取容差)

interface SectionRuntime extends SectionResult {
  cap: THREE.Mesh | null;
  outline: THREE.LineSegments;
}

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private store: AppStore;
  private model: JointModel;
  private handles = new Map<AxisName, PlaneHandle>();
  private annotationLayer = new AnnotationLayer();
  private sections = new Map<AxisName, SectionRuntime>();
  private clipPlanes = new Map<AxisName, THREE.Plane>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private container: HTMLElement;

  private dragging: { axis: AxisName; startOffset: number } | null = null;
  private downInfo: { x: number; y: number; button: number } | null = null;
  private sectionDirty = false;
  private hoverMarker: THREE.Mesh;
  private measurePreview: THREE.LineSegments;
  private frameId = 0;
  private disposed = false;
  private onMeasure?: (record: MeasureRecord) => void;

  constructor(container: HTMLElement, store: AppStore) {
    this.container = container;
    this.store = store;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x20242b);
    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.05,
      100,
    );
    this.camera.position.set(4.2, 3.2, 5.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0.6, 0, 0);

    this.setupLights();

    const materials = createWoodMaterials();
    this.model = buildJoint(materials);
    const modelGroup = new THREE.Group();
    modelGroup.name = 'joint-model';
    for (const part of this.model.parts) {
      part.mesh.castShadow = true;
      part.mesh.receiveShadow = true;
      modelGroup.add(part.mesh);
    }
    this.scene.add(modelGroup);
    this.addGround();

    for (const axis of AXES) {
      const handle = new PlaneHandle(axis, this.handleSize());
      this.handles.set(axis, handle);
      this.scene.add(handle.group);
      this.clipPlanes.set(axis, makePlane(axis, 0));

      const outline = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
          color: 0xffe082,
          depthTest: false,
          transparent: true,
        }),
      );
      outline.renderOrder = 15;
      this.scene.add(outline);
      this.sections.set(axis, {
        axis,
        loops: [],
        capGeometry: null,
        cap: null,
        outline,
      });
    }

    this.scene.add(this.annotationLayer.root);

    // 悬停吸附标记
    this.hoverMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff5252, depthTest: false }),
    );
    this.hoverMarker.visible = false;
    this.hoverMarker.renderOrder = 30;
    this.scene.add(this.hoverMarker);

    // 测量临时线
    this.measurePreview = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x69f0ae, depthTest: false }),
    );
    this.measurePreview.renderOrder = 29;
    this.scene.add(this.measurePreview);

    this.bindEvents();
    this.syncPartVisibility();
    this.rebuildAllSections();
    this.loop();
  }

  // ---------------- 场景基础 ----------------

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x4a3b2c, 1.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(4, 6, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe8c8, 0.5);
    fill.position.set(-4, 2, -3);
    this.scene.add(fill);
  }

  private addGround(): void {
    const geo = new THREE.PlaneGeometry(20, 20);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.95 });
    const ground = new THREE.Mesh(geo, mat);
    ground.position.y = this.model.bounds.min.y - 0.05;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(20, 40, 0x444a55, 0x353a43);
    grid.position.y = this.model.bounds.min.y - 0.045;
    this.scene.add(grid);
  }

  private handleSize(): number {
    return Math.max(this.model?.bounds.getSize(new THREE.Vector3()).length() ?? 4, 3.5) * 0.9;
  }

  // ---------------- 外部回调 ----------------

  setMeasureCallback(cb: (record: MeasureRecord) => void): void {
    this.onMeasure = cb;
  }

  // ---------------- 构件显隐 ----------------

  syncPartVisibility(): void {
    for (const part of this.model.parts) {
      const state = this.store.state.parts.find((p) => p.id === part.id);
      part.mesh.visible = state?.visible ?? true;
    }
    this.requestSectionRebuild();
  }

  private visibleMeshes(): THREE.Mesh[] {
    return this.model.parts.filter((p) => p.mesh.visible).map((p) => p.mesh);
  }

  // ---------------- 剖切重建 ----------------

  /** 状态变化后调度一次重建(同一帧内合并) */
  requestSectionRebuild(): void {
    if (this.sectionDirty) return;
    this.sectionDirty = true;
    queueMicrotask(() => {
      this.sectionDirty = false;
      if (!this.disposed) this.rebuildAllSections();
    });
  }

  rebuildAllSections(): void {
    const activeClip: THREE.Plane[] = [];
    const meshes = this.visibleMeshes();

    for (const axis of AXES) {
      const planeState = this.store.state.planes[axis];
      const handle = this.handles.get(axis)!;
      handle.setOffset(planeState.offset);
      handle.setVisible(planeState.visible);

      const clip = this.clipPlanes.get(axis)!;
      clip.copy(makePlane(axis, planeState.offset));
      if (planeState.enabled) activeClip.push(clip);

      const runtime = this.sections.get(axis)!;
      const loops: SectionLoop[] = [];
      if (planeState.enabled) {
        for (const mesh of meshes) {
          loops.push(...computeSection(mesh, clip, axis));
        }
      }
      runtime.loops = loops;
      runtime.capGeometry = loops.length
        ? buildCapGeometry(loops, axis, planeState.offset)
        : null;

      // 轮廓线
      const pts: number[] = [];
      for (const loop of loops) {
        for (let i = 0; i < loop.points.length; i++) {
          const a = loop.points[i];
          const b = loop.points[(i + 1) % loop.points.length];
          pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      runtime.outline.geometry.dispose();
      runtime.outline.geometry = new THREE.BufferGeometry();
      runtime.outline.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      runtime.outline.visible = planeState.enabled && planeState.visible;

      // 截面填充
      if (runtime.cap) {
        this.scene.remove(runtime.cap);
        runtime.cap.geometry.dispose();
        runtime.cap = null;
      }
      if (runtime.capGeometry) {
        const capMat = new THREE.MeshStandardMaterial({
          color: 0xd8b184,
          roughness: 0.85,
          metalness: 0,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        capMat.clippingPlanes = activeClip.filter((p) => p !== clip);
        capMat.clipShadows = true;
        const cap = new THREE.Mesh(runtime.capGeometry, capMat);
        cap.renderOrder = 5;
        runtime.cap = cap;
        this.scene.add(cap);
      }
    }

    // 实体材料统一使用全部活动裁剪面
    for (const part of this.model.parts) {
      const mat = part.mesh.material as THREE.MeshStandardMaterial;
      mat.clippingPlanes = activeClip.length ? activeClip : null;
      mat.clipShadows = true;
    }

    this.refreshAnnotations();
    this.refreshMeasures();
  }

  // ---------------- 标注联动 ----------------

  /** 依据当前截面轮廓重算所有标注锚点(拖动剖切面时调用) */
  refreshAnnotations(): void {
    for (const view of this.annotationLayer.all()) {
      const rec = view.record;
      const runtime = this.sections.get(rec.plane);
      const offset = this.store.state.planes[rec.plane].offset;
      if (!runtime || runtime.loops.length === 0) {
        view.update(null, null, offset, this.camera);
        continue;
      }
      const p1 = this.relocate(rec, rec.p1, runtime.loops, offset);
      const p2 = this.relocate(rec, rec.p2, runtime.loops, offset);
      view.update(p1, p2, offset, this.camera);
    }
    this.annotationLayer.scheduleTextRedraw();
  }

  /** 局部 2D 锚点重新吸附到最新轮廓 */
  private relocate(
    rec: AnnotationRecord,
    local: [number, number],
    loops: SectionLoop[],
    offset: number,
  ): THREE.Vector3 | null {
    const world = local2DToWorld(local[0], local[1], rec.plane, offset);
    const nearest = nearestPointOnContour(loops, world, rec.plane, offset);
    return nearest ? nearest.world : null;
  }

  /** 从文档恢复标注集合(导入/启动) */
  syncAnnotationViews(records: AnnotationRecord[]): void {
    const keep = new Set(records.map((r) => r.id));
    for (const id of [...this.annotationLayer.all().map((v) => v.record.id)]) {
      if (!keep.has(id)) this.annotationLayer.remove(id);
    }
    for (const rec of records) {
      if (!this.annotationLayer.has(rec.id)) this.annotationLayer.add(rec);
    }
    this.refreshAnnotations();
    this.annotationLayer.redrawAllNow();
  }

  getAnnotationLayer(): AnnotationLayer {
    return this.annotationLayer;
  }

  // ---------------- 指针交互 ----------------

  private bindEvents(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointerleave', this.onPointerLeave);
    dom.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.updatePointer(e);
    this.downInfo = { x: e.clientX, y: e.clientY, button: e.button };
    const dragAxis = this.pickHandleAxis();
    if (dragAxis && this.store.state.planes[dragAxis].visible) {
      const startOffset = this.store.state.planes[dragAxis].offset;
      this.dragging = { axis: dragAxis, startOffset };
      this.store.beginInteraction();
      this.controls.enabled = false;
      this.renderer.domElement.style.cursor = 'grabbing';
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.updatePointer(e);

    if (this.dragging) {
      const offset = this.handles.get(this.dragging.axis)!.projectRay(this.raycaster);
      if (offset !== null) {
        const [min, max] = this.axisRange(this.dragging.axis);
        this.store.setPlaneOffset(
          this.dragging.axis,
          THREE.MathUtils.clamp(offset, min, max),
        );
        this.rebuildAllSections();
      }
      return;
    }

    // 悬停高亮手柄
    const hoverAxis = this.pickHandleAxis();
    for (const [axis, handle] of this.handles) handle.setHover(axis === hoverAxis);
    if (hoverAxis) {
      this.renderer.domElement.style.cursor = 'grab';
      this.hoverMarker.visible = false;
      return;
    }

    if (this.store.state.mode === 'annotate') this.updateAnnotateHover();
    else this.renderer.domElement.style.cursor = 'default';
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasDragging = this.dragging;
    this.dragging = null;
    this.controls.enabled = true;
    this.renderer.domElement.style.cursor = 'default';

    if (!this.downInfo) return;
    const moved = Math.hypot(e.clientX - this.downInfo.x, e.clientY - this.downInfo.y);
    const isClick = moved < 5;
    this.downInfo = null;
    if (wasDragging || !isClick) return;

    if (this.store.state.mode === 'annotate') this.handleAnnotateClick(e);
    else if (this.store.state.mode === 'measure') this.handleMeasureClick();
  };

  private onPointerLeave = (): void => {
    this.hoverMarker.visible = false;
    for (const handle of this.handles.values()) handle.setHover(false);
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    this.updatePointer(e as PointerEvent);
    const targetId = this.pickAnnotationId(12);
    if (targetId) {
      this.store.removeAnnotation(targetId);
      this.syncAnnotationViews(this.store.state.annotations);
    }
  };

  /** 屏幕距离拾取标注(端点或文字附近),阈值为像素 */
  private pickAnnotationId(pixelLimit: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const sx = this.pointer.x * 0.5 + 0.5;
    const sy = -this.pointer.y * 0.5 + 0.5;
    const px = sx * rect.width;
    const py = sy * rect.height;
    let best: { id: string; d: number } | null = null;
    const v = new THREE.Vector3();

    for (const view of this.annotationLayer.all()) {
      if (!view.group.visible) continue;
      const rec = view.record;
      const runtime = this.sections.get(rec.plane);
      const offset = this.store.state.planes[rec.plane].offset;
      if (!runtime || runtime.loops.length === 0) continue;
      const a1 = this.relocate(rec, rec.p1, runtime.loops, offset);
      const a2 = this.relocate(rec, rec.p2, runtime.loops, offset);
      const candidates = [a1, a2].filter((p): p is THREE.Vector3 => p !== null);
      candidates.push(view.labelPosition(v));
      for (const p of candidates) {
        v.copy(p).project(this.camera);
        if (v.z > 1) continue;
        const d = Math.hypot((v.x * 0.5 + 0.5) * rect.width - px, (-v.y * 0.5 + 0.5) * rect.height - py);
        if (!best || d < best.d) best = { id: rec.id, d };
      }
    }
    return best && best.d <= pixelLimit ? best.id : null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
      this.afterHistoryChange();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.store.redo();
      this.afterHistoryChange();
    }
  };

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private afterHistoryChange(): void {
    this.syncPartVisibility();
    this.syncAnnotationViews(this.store.state.annotations);
    this.rebuildAllSections();
  }

  private pickHandleAxis(): AxisName | null {
    const objects: THREE.Object3D[] = [];
    for (const [axis, handle] of this.handles) {
      if (this.store.state.planes[axis].visible) objects.push(...handle.pickables());
    }
    const hits = this.raycaster.intersectObjects(objects, false);
    return hits.length ? (hits[0].object.userData.dragAxis as AxisName) : null;
  }

  private axisRange(axis: AxisName): [number, number] {
    const b = this.model.bounds;
    if (axis === 'x') return [b.min.x, b.max.x];
    if (axis === 'y') return [b.min.y, b.max.y];
    return [b.min.z, b.max.z];
  }

  // ---------------- 标注点击/悬停 ----------------

  private activeSectionAtRay(): {
    axis: AxisName;
    offset: number;
    loops: SectionLoop[];
    point: THREE.Vector3;
  } | null {
    for (const axis of AXES) {
      const state = this.store.state.planes[axis];
      const runtime = this.sections.get(axis)!;
      if (!state.enabled || runtime.loops.length === 0 || !runtime.capGeometry) continue;
      const hit = this.raycaster.ray.intersectPlane(
        makePlane(axis, state.offset),
        new THREE.Vector3(),
      );
      if (!hit) continue;
      // 用截面填充 BVH 判断点是否落在截面区域内
      const capMesh = runtime.cap;
      if (capMesh) {
        const hits = this.raycaster.intersectObject(capMesh, false);
        if (hits.length && hits[0].object === capMesh) {
          return { axis, offset: state.offset, loops: runtime.loops, point: hits[0].point };
        }
      }
    }
    return null;
  }

  private updateAnnotateHover(): void {
    const target = this.activeSectionAtRay();
    if (!target) {
      this.hoverMarker.visible = false;
      this.renderer.domElement.style.cursor = 'default';
      return;
    }
    const nearest = nearestPointOnContour(
      target.loops,
      target.point,
      target.axis,
      target.offset,
    );
    if (nearest && nearest.distance <= SNAP_LIMIT_M) {
      this.hoverMarker.position.copy(nearest.world);
      this.hoverMarker.visible = true;
      this.renderer.domElement.style.cursor = 'crosshair';
    } else {
      this.hoverMarker.visible = false;
      this.renderer.domElement.style.cursor = 'default';
    }
  }

  /** 单击放置尺寸标注:取点击点和反方向同一射线与轮廓的另一交点作为两端 */
  private handleAnnotateClick(e: PointerEvent): void {
    void e;
    const target = this.activeSectionAtRay();
    if (!target) return;
    const nearest = nearestPointOnContour(
      target.loops,
      target.point,
      target.axis,
      target.offset,
    );
    if (!nearest || nearest.distance > SNAP_LIMIT_M) return;

    // 第二点:沿相机视线在截面内的投影方向,找轮廓上另一侧的点
    const other = this.findOppositeContourPoint(target, nearest.local);
    if (!other) return;

    const record: AnnotationRecord = {
      id: `a-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      plane: target.axis,
      p1: nearest.local,
      p2: other,
      createdAt: Date.now(),
    };
    this.store.addAnnotation(record);
    this.syncAnnotationViews(this.store.state.annotations);
  }

  private findOppositeContourPoint(
    target: { axis: AxisName; offset: number; loops: SectionLoop[] },
    from: [number, number],
  ): [number, number] | null {
    const frame = PLANE_FRAMES[target.axis];
    // 视线方向投影到截面
    const viewDir = this.camera.getWorldDirection(new THREE.Vector3());
    const projected = viewDir.projectOnPlane(frame.normal);
    if (projected.lengthSq() < 1e-10) projected.copy(frame.uDir);
    projected.normalize();

    const origin = local2DToWorld(from[0], from[1], target.axis, target.offset);
    const ray = new THREE.Raycaster(
      origin.clone().addScaledVector(projected, 1e-4),
      projected,
      0,
      10,
    );
    const cap = this.sections.get(target.axis)!.cap;
    if (!cap) return null;
    const hits = ray.intersectObject(cap, false);
    // 穿过截面区域后,取最后一个交点再吸附回轮廓
    if (hits.length === 0) return null;
    const farPoint = hits[hits.length - 1].point;
    const snap = nearestPointOnContour(target.loops, farPoint, target.axis, target.offset);
    if (!snap) return null;
    const d = Math.hypot(snap.local[0] - from[0], snap.local[1] - from[1]);
    if (d < 0.02) return null;
    return snap.local;
  }

  // ---------------- 测量点击 ----------------

  private handleMeasureClick(): void {
    // 优先命中实体表面,再判定贴近哪个活动截面
    const meshes = this.visibleMeshes();
    const surfaceHits = this.raycaster.intersectObjects(meshes, false);
    const point = surfaceHits[0]?.point ?? null;
    if (!point) return;

    const sectionInfo = nearestSectionAxis(
      point,
      AXES.map((axis) => ({
        axis,
        offset: this.store.state.planes[axis].offset,
        loops: this.sections.get(axis)!.loops,
      })),
    );
    if (!sectionInfo) return;

    const anchor = worldToLocal2D(point, sectionInfo.axis);
    const result = measureOnSection(
      meshes,
      sectionInfo.axis,
      sectionInfo.offset,
      anchor,
      'tenon-width',
      this.model.bounds,
    );
    if (!result) return;
    this.drawMeasurePreview(result.points);
    this.onMeasure?.(result.record);
  }

  /** 截面/构件变化后重算全部测量,数值随剖切位置联动 */
  private refreshMeasures(): void {
    const meshes = this.visibleMeshes();
    for (const record of this.store.state.measures) {
      const planeState = this.store.state.planes[record.plane];
      if (!planeState.enabled) {
        this.store.updateMeasureValue(record.id, 0, '剖切面已停用');
        continue;
      }
      const hit = measureOnSection(
        meshes,
        record.plane,
        planeState.offset,
        record.anchor,
        record.kind,
        this.model.bounds,
      );
      if (hit) {
        this.store.updateMeasureValue(record.id, hit.record.value, hit.record.detail);
        if (record.id === this.store.state.measures[0]?.id) this.drawMeasurePreview(hit.points);
      } else {
        this.store.updateMeasureValue(record.id, 0, '当前截面无实体');
      }
    }
  }

  private drawMeasurePreview(points: THREE.Vector3[]): void {
    const verts: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      verts.push(
        points[i].x, points[i].y, points[i].z,
        points[i + 1].x, points[i + 1].y, points[i + 1].z,
      );
    }
    this.measurePreview.geometry.dispose();
    this.measurePreview.geometry = new THREE.BufferGeometry();
    this.measurePreview.geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  }

  // ---------------- 渲染循环 ----------------

  private loop = (): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.loop);
    this.controls.update();
    this.annotationLayer.refreshSpriteScales(this.camera);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointerleave', this.onPointerLeave);
    dom.removeEventListener('contextmenu', this.onContextMenu);
    this.controls.dispose();
    this.renderer.dispose();
    dom.remove();
  }
}

export { worldToLocal2D };
export type { ToolMode, AnnotationView };
