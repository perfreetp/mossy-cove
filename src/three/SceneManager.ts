import * as THREE from 'three';
import { OrbitController } from './OrbitController';
import { KnifePlane, type KnifeState } from './KnifePlane';
import { makeLoopHighlights, type LoopHighlight } from './loopHighlights';
import { makeTextSprite } from './textSprite';
import { editorStore } from '../state/editorStore';
import type { AxisPreset, InteractionMode } from '../types';

/**
 * 三维裁剪工作区的场景总管：渲染循环、网格同步、平面刀交互、
 * 各交互模式下的射线拾取与拖动。
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private orbit: OrbitController;
  readonly knife: KnifePlane;

  private mesh: THREE.Mesh | null = null;
  private bodyMaterial: THREE.MeshStandardMaterial;
  private capMaterial: THREE.MeshStandardMaterial;
  private loopGroup = new THREE.Group();
  private handleGroup = new THREE.Group();
  private loopLabels: THREE.Sprite[] = [];
  private highlights: LoopHighlight[] = [];

  private container: HTMLElement;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  mode: InteractionMode = 'orbit';
  private selectedLoopIndex = 0;
  private manualPicks: number[] = []; // 手动补洞已吸附的边界顶点 id
  private onManualPicksChange?: (count: number) => void;
  private knifeStateListeners = new Set<(s: KnifeState) => void>();

  // 拖动状态
  private dragKind: 'none' | 'knife-translate' | 'knife-rotate' | 'cap-vertex' | 'cap-translate' | 'manual' = 'none';
  private dragPlane = new THREE.Plane();
  private dragOffset = new THREE.Vector3();
  private dragVertexId = -1;
  private dragStartPoint = new THREE.Vector3();
  private lastPreviewTime = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0d1420);
    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.01,
      200,
    );
    this.camera.position.set(2.6, 2.0, 3.2);

    // 灯光
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-4, -2, -3);
    this.scene.add(fill);

    // 参考网格
    const grid = new THREE.GridHelper(6, 24, 0x2b4160, 0x1c2a40);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.position.y = -1.6;
    this.scene.add(grid);
    const axes = new THREE.AxesHelper(0.6);
    this.scene.add(axes);

    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xc96f5b,
      roughness: 0.62,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    this.capMaterial = new THREE.MeshStandardMaterial({
      color: 0xffb347,
      roughness: 0.45,
      metalness: 0.1,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.knife = new KnifePlane();
    this.scene.add(this.knife.object);

    this.scene.add(this.loopGroup);
    this.scene.add(this.handleGroup);

    this.orbit = new OrbitController(this.camera, this.renderer.domElement, () => this.isOrbitAllowed());

    this.bindPointerEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    // store 变更（导入/撤销/重做/提交/预览）→ 同步场景
    this.unsubscribeStore = editorStore.subscribe(() => this.syncFromStore());
    this.syncFromStore();

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.knife.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private unsubscribeStore: () => void;

  private isOrbitAllowed() {
    return this.mode === 'orbit';
  }

  // ------------------------------------------------------------ 尺寸
  private handleResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // ------------------------------------------------------------ 网格同步
  syncFromStore() {
    const geometry = editorStore.getPresentGeometry();
    if (!geometry) {
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh = null;
      }
      this.rebuildOverlays();
      return;
    }

    if (!this.mesh) {
      this.mesh = new THREE.Mesh(geometry, [this.bodyMaterial, this.capMaterial]);
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
      this.knife.fitTo(geometry);
      this.frameView();
    } else {
      this.mesh.geometry = geometry;
    }
    this.rebuildOverlays();
  }

  /** 重建边界环高亮、序号标签与断面调整点 */
  private rebuildOverlays() {
    this.loopGroup.clear();
    this.handleGroup.clear();
    this.loopLabels = [];

    const geometry = editorStore.getPresentGeometry();
    const loops = editorStore.getPresentLoops();
    if (!geometry) {
      this.highlights = [];
      return;
    }
    this.highlights = makeLoopHighlights(geometry, loops);
    for (const hl of this.highlights) this.loopGroup.add(hl.line);

    loops.forEach((loop, i) => {
      const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
      const center = new THREE.Vector3();
      for (const id of loop.indices) center.add(new THREE.Vector3().fromBufferAttribute(pos, id));
      center.multiplyScalar(1 / loop.indices.length);
      center.addScaledVector(loop.plane.normal, 0.03);
      const sprite = makeTextSprite(`${i + 1}`, i === this.selectedLoopIndex ? '#ffd54a' : '#7fd4ff');
      sprite.position.copy(center);
      sprite.scale.setScalar(0.16);
      this.loopGroup.add(sprite);
      this.loopLabels.push(sprite);
    });

    // 断面内部调整点（aCap=2）
    const capAttr = geometry.getAttribute('aCap') as THREE.BufferAttribute | undefined;
    if (capAttr) {
      const p = new THREE.Vector3();
      const sphereGeo = new THREE.SphereGeometry(0.022, 16, 12);
      const mat = new THREE.MeshBasicMaterial({ color: 0x36e2c3, depthTest: true });
      for (let i = 0; i < capAttr.count; i++) {
        if (capAttr.getX(i) > 1.5) {
          p.fromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute, i);
          const s = new THREE.Mesh(sphereGeo, mat);
          s.position.copy(p);
          s.userData.vertexId = i;
          this.handleGroup.add(s);
        }
      }
    }

    // 手动补洞已吸附点标记（持久化，不被预览/重建清空）
    if (this.manualPicks.length > 0) {
      const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
      const markerGeo = new THREE.SphereGeometry(0.028, 12, 10);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
      for (const vertexId of this.manualPicks) {
        const m = new THREE.Mesh(markerGeo, markerMat);
        m.position.fromBufferAttribute(pos, vertexId);
        m.userData.isPickMarker = true;
        this.handleGroup.add(m);
      }
    }
  }

  frameView() {
    const geometry = this.mesh?.geometry;
    if (!geometry) return;
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere!;
    const dist = (sphere.radius * 1.8) / Math.sin((this.camera.fov * Math.PI) / 360);
    const dir = this.camera.position.clone().sub(this.camera.userData.target ?? new THREE.Vector3()).normalize();
    const target = sphere.center.clone();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.userData.target = target;
    this.orbit.target.copy(target);
    this.camera.near = Math.max(dist / 100, 0.001);
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ 模式
  setMode(mode: InteractionMode) {
    this.mode = mode;
    this.manualPicks = [];
    this.onManualPicksChange?.(0);
    this.renderer.domElement.style.cursor = mode === 'orbit' ? 'grab' : 'crosshair';
    this.knife.object.visible = mode === 'knife-translate' || mode === 'knife-rotate';
  }

  setManualPicksListener(fn: (count: number) => void) {
    this.onManualPicksChange = fn;
  }

  /** 订阅刀位状态变化（支持多个监听者，返回取消订阅函数） */
  setKnifeStateListener(fn: (s: KnifeState) => void): () => void {
    this.knifeStateListeners.add(fn);
    fn(this.knife.getState());
    return () => this.knifeStateListeners.delete(fn);
  }

  private notifyKnifeState() {
    const state = this.knife.getState();
    for (const fn of this.knifeStateListeners) fn(state);
  }

  // ------------------------------------------------------------ 平面刀控制
  applyPreset(preset: AxisPreset) {
    const geometry = this.mesh?.geometry;
    if (!geometry) return;
    geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    geometry.boundingBox!.getCenter(center);
    this.knife.applyPreset(preset, center);
    this.notifyKnifeState();
    if (preset !== 'FREE') this.requestPreview();
  }

  setKnifeNormal(normal: THREE.Vector3) {
    this.knife.setNormal(normal);
    this.notifyKnifeState();
    this.requestPreview();
  }

  setKnifeOffset(offset: number) {
    this.knife.setOffset(offset);
    this.notifyKnifeState();
    this.requestPreview();
  }

  flipKnife() {
    this.knife.flip();
    this.notifyKnifeState();
    this.requestPreview();
  }

  commitClip() {
    try {
      editorStore.commitClip(this.knife.plane.clone());
      this.knife.fitTo(editorStore.getPresentGeometry()!);
      this.notifyKnifeState();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  cancelPreview() {
    editorStore.clearPreview();
  }

  // ------------------------------------------------------------ 补洞
  getManualPickCount() {
    return this.manualPicks.length;
  }

  getSelectedLoop() {
    const loops = editorStore.getPresentLoops();
    return loops[Math.min(this.selectedLoopIndex, loops.length - 1)];
  }

  selectLoop(index: number) {
    this.selectedLoopIndex = index;
    this.rebuildOverlays();
  }

  /** 一键自动补洞（store 内对全部环执行） */
  autoFill() {
    editorStore.autoFillAll();
  }

  /** 提交手动补洞：按拾取顺序的吸附点做 earcut 三角化 */
  commitManualFill() {
    const geometry = editorStore.getPresentGeometry();
    const loop = this.getSelectedLoop();
    if (!geometry || !loop) return;
    if (this.manualPicks.length < 3) {
      alert('请至少沿边界环依次拾取 3 个吸附点');
      return;
    }
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const pts = this.manualPicks.map((id) => new THREE.Vector3().fromBufferAttribute(pos, id));
    editorStore.fillHole(pts, loop.plane);
    this.manualPicks = [];
    this.onManualPicksChange?.(0);
  }

  undoManualPick() {
    this.manualPicks.pop();
    this.onManualPicksChange?.(this.manualPicks.length);
    this.rebuildOverlays();
  }

  // ------------------------------------------------------------ 指针事件
  private updatePointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private bindPointerEvents() {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    switch (this.mode) {
      case 'knife-translate':
        this.beginKnifeTranslate();
        break;
      case 'knife-rotate':
        this.beginKnifeRotate();
        break;
      case 'manual-fill':
        this.pickBoundaryVertex();
        break;
      case 'cap-vertex':
        this.beginCapVertexDrag(e);
        break;
      default:
        break;
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.dragKind === 'none') return;
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.dragKind === 'knife-translate') this.dragKnifeTranslate();
    else if (this.dragKind === 'knife-rotate') this.dragKnifeRotate(e);
    else if (this.dragKind === 'cap-vertex') this.dragCapVertex();
  };

  private onPointerUp = () => {
    if (this.dragKind === 'cap-vertex') {
      const point = this.raycastToPlane(this.dragPlane) ?? this.dragStartPoint;
      editorStore.moveCapVertex(this.dragVertexId, point);
    }
    this.dragKind = 'none';
  };

  // ---- 平面刀平移：射线与过刀心、平行于刀面的平面求交 ---------------------
  private beginKnifeTranslate() {
    const hitPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      this.knife.plane.normal,
      this.knife.center,
    );
    const hit = this.raycastToPlane(hitPlane);
    if (!hit) return;
    this.dragKind = 'knife-translate';
    this.dragPlane.copy(hitPlane);
    this.dragOffset.copy(hit).sub(this.knife.center);
  }

  private dragKnifeTranslate() {
    const hit = this.raycastToPlane(this.dragPlane);
    if (!hit) return;
    this.knife.center.copy(hit).sub(this.dragOffset);
    this.knife.syncPlaneFromState();
    this.requestPreviewThrottled();
    this.notifyKnifeState();
  }

  // ---- 平面刀自由旋转：指针位移转 yaw/pitch，四元数累积 --------------------
  private beginKnifeRotate() {
    this.dragKind = 'knife-rotate';
  }

  private dragKnifeRotate(e: PointerEvent) {
    if (!e.movementX && !e.movementY) return;
    const sensitivity = 0.006;
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -e.movementX * sensitivity,
    );
    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -e.movementY * sensitivity,
    );
    this.knife.applyRotation(yawQuat.multiply(pitchQuat));
    this.knife.syncPlaneFromState();
    this.requestPreviewThrottled();
    this.notifyKnifeState();
  }

  // ---- 手动补洞：拾取最近边界环顶点并吸附 ----------------------------------
  private pickBoundaryVertex() {
    const geometry = editorStore.getPresentGeometry();
    const loops = editorStore.getPresentLoops();
    if (!geometry || !this.mesh || loops.length === 0) return;
    const hits = this.raycaster.intersectObject(this.mesh, false);
    if (hits.length === 0) return;
    const hitPoint = hits[0].point;
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;

    // 在当前选中环（未指定则取最近环）上找最近顶点 —— 即"吸附"
    const loop = this.getSelectedLoop() ?? loops[0];
    let bestId = -1;
    let bestDist = Infinity;
    const v = new THREE.Vector3();
    for (const id of loop.indices) {
      v.fromBufferAttribute(pos, id);
      const d = v.distanceTo(hitPoint);
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }
    if (bestId < 0) return;
    // 吸附阈值：模型包围球半径的 8%
    const radius = geometry.boundingSphere?.radius ?? 1;
    if (bestDist > radius * 0.12) return;
    if (this.manualPicks[this.manualPicks.length - 1] !== bestId) {
      this.manualPicks.push(bestId);
      this.onManualPicksChange?.(this.manualPicks.length);
      this.rebuildOverlays();
    }
  }

  // ---- 顶点级微调：拖动 aCap=2 的调整点 ------------------------------------
  private beginCapVertexDrag(e: PointerEvent) {
    const handles = this.handleGroup.children.filter(
      (o) => (o as THREE.Mesh).userData.vertexId !== undefined,
    );
    if (handles.length === 0) {
      // 没有可调点时，点断面空白处尝试新增调整点
      if (this.mesh) {
        const meshHits = this.raycaster.intersectObject(this.mesh, false);
        const capHit = meshHits.find((h) => h.face && this.isCapFace(h.face.materialIndex));
        if (capHit) editorStore.addHandle(capHit.point);
      }
      return;
    }
    const hits = this.raycaster.intersectObjects(handles, false);
    if (hits.length === 0) {
      // 空白处点击：在断面上插入新调整点
      if (this.mesh) {
        const meshHits = this.raycaster.intersectObject(this.mesh, false);
        const capHit = meshHits.find((h) => h.face && this.isCapFace(h.face.materialIndex));
        if (capHit) editorStore.addHandle(capHit.point);
      }
      return;
    }
    const vertexId = hits[0].object.userData.vertexId as number;
    this.dragKind = 'cap-vertex';
    this.dragVertexId = vertexId;
    const pos = this.mesh!.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.dragStartPoint.fromBufferAttribute(pos, vertexId);
    // 拖动平面：过调整点、面向相机，保证任意视角下都能自由移动
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, this.dragStartPoint);
    e.stopPropagation();
  }

  private isCapFace(materialIndex: number) {
    return materialIndex === 1;
  }

  private dragCapVertex() {
    const hit = this.raycastToPlane(this.dragPlane);
    if (!hit) return;
    // 实时移动句柄视觉（几何在 pointerup 时才入栈，避免拖动产生大量历史）
    const marker = this.handleGroup.children.find(
      (o) => (o as THREE.Mesh).userData.vertexId === this.dragVertexId,
    );
    if (marker) marker.position.copy(hit);
    this.dragStartPoint.copy(hit); // 同时记录最终落点，供 pointerup 入栈
  }

  // ---- 通用：射线与数学平面求交 --------------------------------------------
  private raycastToPlane(plane: THREE.Plane): THREE.Vector3 | null {
    const ray = this.raycaster.ray;
    const point = new THREE.Vector3();
    return ray.intersectPlane(plane, point) ? point : null;
  }

  // ---- 预览节流：拖动中约每帧最多一次重算 ----------------------------------
  private requestPreview() {
    this.lastPreviewTime = performance.now();
    const result = editorStore.updateClipPreview(this.knife.plane.clone());
    if (result.empty) this.renderer.domElement.style.cursor = 'not-allowed';
    else this.renderer.domElement.style.cursor = this.mode === 'orbit' ? 'grab' : 'crosshair';
  }

  private requestPreviewThrottled() {
    const now = performance.now();
    if (now - this.lastPreviewTime < 16) return;
    this.requestPreview();
  }

  // ------------------------------------------------------------ 销毁
  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.unsubscribeStore();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.orbit.dispose();
    this.knife.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
