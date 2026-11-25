// three.js 化石查看器:裁剪、Gizmo 交互、截面渲染、测量拾取
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PlaneGizmo, type GizmoHitPart } from './plane-gizmo';
import type { AxisName, PlanesState, SectionResult, Measurement } from './types';
import {
  normalize, add, scale, distance, clamp,
  type Vec3
} from './math';

const AXES: AxisName[] = ['x', 'y', 'z'];

interface SectionObjects {
  fill: THREE.Mesh | null;
  lines: THREE.LineSegments | null;
  result: SectionResult | null;
}

type InteractionMode = 'none' | 'translate' | 'rotate' | 'measure-point' | 'measure-area';

export interface ViewerCallbacks {
  onPlaneDrag?: (axis: AxisName, point: Vec3, normal: Vec3, dragging: boolean) => void;
  onMeasure?: (m: Omit<Measurement, 'id'>) => void;
  onHover?: (hint: string) => void;
}

export class FossilViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private container: HTMLElement;

  private model: THREE.Mesh | null = null;
  private modelMaterial: THREE.MeshStandardMaterial | null = null;
  private gizmos = new Map<AxisName, PlaneGizmo>();
  private sectionGroup = new THREE.Group();
  private measureGroup = new THREE.Group();
  private labelGroup = new THREE.Group();
  private grid: THREE.GridHelper;

  private planes: PlanesState;
  private sectionObjects: Record<AxisName, SectionObjects> = {
    x: { fill: null, lines: null, result: null },
    y: { fill: null, lines: null, result: null },
    z: { fill: null, lines: null, result: null }
  };

  private mode: InteractionMode = 'none';
  private activeAxis: AxisName | null = null;
  private activePart: GizmoHitPart | null = null;
  private dragPlane = new THREE.Plane();
  private dragStart = new THREE.Vector3();
  private dragOrigin = new THREE.Vector3();
  private rotateStartAngle = 0;
  private rotateStartNormal: Vec3 = [0, 0, 1];
  private boundsMin: Vec3 = [-1, -1, -1];
  private boundsMax: Vec3 = [1, 1, 1];
  private gizmoSize = 2;

  angleLock = false;
  snapDegrees = 15;
  measureMode: 'off' | 'distance' | 'area' = 'off';
  private measureFirst: Vec3 | null = null;
  private measurePreview: THREE.Line | null = null;

  private cb: ViewerCallbacks;
  private resizeObserver: ResizeObserver;
  private raf = 0;
  private disposed = false;

  constructor(container: HTMLElement, planes: PlanesState, cb: ViewerCallbacks = {}) {
    this.container = container;
    this.planes = planes;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x10141b);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 1e4);
    this.camera.position.set(3, 2.4, 3.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    // 光照
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 6, 5);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
    fill.position.set(-5, -2, -4);
    this.scene.add(key, fill);

    this.grid = new THREE.GridHelper(4, 20, 0x3a4356, 0x232a38);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(this.grid);

    this.scene.add(this.sectionGroup, this.measureGroup, this.labelGroup);

    for (const axis of AXES) {
      const g = new PlaneGizmo(axis, this.gizmoSize);
      g.setPose(planes[axis].point, planes[axis].normal);
      this.gizmos.set(axis, g);
      this.scene.add(g.group);
    }

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.loop();
  }

  // ---------- 模型 ----------

  setModel(vertices: Float32Array, indices: Uint32Array, bounds: { min: Vec3; max: Vec3; center: Vec3; size: Vec3 }) {
    this.clearModel();
    this.boundsMin = bounds.min;
    this.boundsMax = bounds.max;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    this.modelMaterial = new THREE.MeshStandardMaterial({
      color: 0xc8b392,
      roughness: 0.72,
      metalness: 0.05,
      side: THREE.DoubleSide,
      clippingPlanes: this.activeClippingPlanes()
    });
    this.model = new THREE.Mesh(geo, this.modelMaterial);
    this.scene.add(this.model);

    // 平面尺寸/网格/相机适配包围盒
    const maxDim = Math.max(...bounds.size);
    this.gizmoSize = maxDim * 1.25;
    for (const g of this.gizmos.values()) g.dispose();
    this.gizmos.clear();
    for (const axis of AXES) {
      const g = new PlaneGizmo(axis, this.gizmoSize);
      g.setPose(this.planes[axis].point, this.planes[axis].normal);
      this.gizmos.set(axis, g);
      this.scene.add(g.group);
    }
    this.grid.scale.setScalar(maxDim / 4);
    this.grid.position.y = bounds.min[1];

    const center = new THREE.Vector3(...bounds.center);
    this.controls.target.copy(center);
    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, maxDim * 2.2);
    this.camera.near = maxDim / 1000;
    this.camera.far = maxDim * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  clearModel() {
    if (this.model) {
      this.scene.remove(this.model);
      this.model.geometry.dispose();
      this.modelMaterial?.dispose();
      this.model = null;
    }
    for (const axis of AXES) this.clearSection(axis);
  }

  hasModel() { return this.model !== null; }

  // ---------- 裁剪平面 ----------

  private activeClippingPlanes(): THREE.Plane[] {
    const out: THREE.Plane[] = [];
    for (const axis of AXES) {
      const p = this.planes[axis];
      if (!p.enabled || p.hidden) continue;
      const n = new THREE.Vector3(...p.normal);
      // three 裁剪:保留 dot(n, x) + constant >= 0 一侧,即 n·(x-point) >= 0
      out.push(new THREE.Plane(n, -n.dot(new THREE.Vector3(...p.point))));
    }
    return out;
  }

  private refreshClipping() {
    if (!this.modelMaterial) return;
    this.modelMaterial.clippingPlanes = this.activeClippingPlanes();
    this.modelMaterial.needsUpdate = true;
  }

  /** 外部状态变化后同步 Gizmo 位姿与可见性 */
  syncPlanes(planes: PlanesState) {
    this.planes = planes;
    for (const axis of AXES) {
      const g = this.gizmos.get(axis)!;
      g.setPose(planes[axis].point, planes[axis].normal);
      g.setVisible(planes[axis].enabled);
    }
    this.refreshClipping();
  }

  // ---------- 截面渲染 ----------

  updateSection(axis: AxisName, result: SectionResult | null) {
    this.clearSection(axis);
    if (!result) return;
    const state = this.planes[axis];
    const color = new THREE.Color(state.fillColor);
    const lineColor = new THREE.Color(state.lineColor);

    if (result.fillVertices.length >= 9 && result.fillIndices.length >= 3) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(result.fillVertices, 3));
      geo.setIndex(new THREE.BufferAttribute(result.fillIndices, 1));
      geo.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 3;
      mesh.userData.axis = axis;
      this.sectionGroup.add(mesh);
      this.sectionObjects[axis].fill = mesh;
    }

    // 闭合轮廓线:每个轮廓一条闭合环,合并为 LineSegments
    const linePts: number[] = [];
    for (const c of result.contours) {
      const p3 = c.points3d;
      for (let i = 0; i < p3.length; i++) {
        const a = p3[i];
        const b = p3[(i + 1) % p3.length];
        linePts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
    }
    if (linePts.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
      const lm = new THREE.LineBasicMaterial({ color: lineColor, linewidth: 2 });
      const lines = new THREE.LineSegments(lg, lm);
      lines.renderOrder = 4;
      lines.userData.axis = axis;
      this.sectionGroup.add(lines);
      this.sectionObjects[axis].lines = lines;
    }
    this.sectionObjects[axis].result = result;
  }

  clearSection(axis: AxisName) {
    const o = this.sectionObjects[axis];
    if (o.fill) {
      this.sectionGroup.remove(o.fill);
      o.fill.geometry.dispose();
      (o.fill.material as THREE.Material).dispose();
      o.fill = null;
    }
    if (o.lines) {
      this.sectionGroup.remove(o.lines);
      o.lines.geometry.dispose();
      (o.lines.material as THREE.Material).dispose();
      o.lines = null;
    }
    o.result = null;
  }

  getSection(axis: AxisName): SectionResult | null {
    return this.sectionObjects[axis].result;
  }

  setSectionVisible(axis: AxisName, visible: boolean) {
    const o = this.sectionObjects[axis];
    if (o.fill) o.fill.visible = visible;
    if (o.lines) o.lines.visible = visible;
  }

  /** 只更新截面材质颜色(避免颜色调整触发几何重建) */
  updateSectionStyle(axis: AxisName, fillColor: string, lineColor: string) {
    const o = this.sectionObjects[axis];
    if (o.fill) (o.fill.material as THREE.MeshBasicMaterial).color.set(fillColor);
    if (o.lines) (o.lines.material as THREE.LineBasicMaterial).color.set(lineColor);
  }

  // ---------- 指针交互 ----------

  private updatePointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickGizmo(): { gizmo: PlaneGizmo; part: GizmoHitPart; hit: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: THREE.Object3D[] = [];
    for (const axis of AXES) {
      const g = this.gizmos.get(axis)!;
      if (g.group.visible) targets.push(...g.pickables);
    }
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const ud = hits[0].object.userData as { gizmo: PlaneGizmo; part: GizmoHitPart };
    return { gizmo: ud.gizmo, part: ud.part, hit: hits[0].point };
  }

  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.updatePointer(e);

    // 测量模式优先
    if (this.measureMode !== 'off') {
      this.handleMeasureDown(e);
      return;
    }

    const picked = this.pickGizmo();
    if (!picked) return;
    e.preventDefault();
    this.activeAxis = picked.gizmo.axis;
    this.activePart = picked.part;
    this.controls.enabled = false;
    const state = this.planes[this.activeAxis];

    if (picked.part === 'translate' || picked.part === 'plane') {
      this.mode = 'translate';
      // 用过 Gizmo 中心、面向相机的平面接收指针,再把位移投影到平面法向。
      // 这样即使视线与法向近乎平行(正看平面)也能正常拖动。
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const n = new THREE.Vector3(...state.normal);
      const center = new THREE.Vector3(...state.point);
      const viewDir = this.raycaster.ray.direction.clone().negate();
      this.dragPlane.setFromNormalAndCoplanarPoint(viewDir, center);
      const p = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(this.dragPlane, p);
      this.dragStart = p.clone();
      this.dragOrigin = new THREE.Vector3(...state.point);
      (this as unknown as { _dragNormal: THREE.Vector3 })._dragNormal = n;
    } else {
      this.mode = 'rotate';
      const n = new THREE.Vector3(...state.normal);
      const g = this.gizmos.get(this.activeAxis!)!;
      const center = g.group.position.clone();
      // 旋转环在面向相机的平面内操作,记录起始方位角
      const viewDir = this.raycaster.ray.direction.clone().negate();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir, center);
      const p = new THREE.Vector3();
      this.raycaster.setFromCamera(this.pointer, this.camera);
      this.raycaster.ray.intersectPlane(plane, p);
      // 屏幕右方向与上方向作为角度参考
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      const rel = p.sub(center);
      this.rotateStartAngle = Math.atan2(rel.dot(up), rel.dot(right));
      this.rotateStartNormal = state.normal;
      (this as unknown as { _e1: THREE.Vector3; _e2: THREE.Vector3 })._e1 = right;
      (this as unknown as { _e1: THREE.Vector3; _e2: THREE.Vector3; _rotAxis: THREE.Vector3 })
        ._e2 = up;
      (this as unknown as { _rotAxis: THREE.Vector3 })._rotAxis = n;
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    this.updatePointer(e);

    if (this.mode === 'translate' && this.activeAxis) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const p = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, p)) return;
      const state = this.planes[this.activeAxis];
      const n = (this as unknown as { _dragNormal: THREE.Vector3 })._dragNormal;
      // 基于拖动起始点做增量,避免逐帧累积漂移
      const delta = p.clone().sub(this.dragStart).dot(n);
      const candidate = this.dragOrigin.clone().addScaledVector(n, delta);
      const clamped = this.clampAlongNormal(
        this.activeAxis,
        [candidate.x, candidate.y, candidate.z],
        [n.x, n.y, n.z]
      );
      this.applyPlanePose(this.activeAxis, clamped, state.normal, true);
      return;
    }

    if (this.mode === 'rotate' && this.activeAxis) {
      const state = this.planes[this.activeAxis];
      const g = this.gizmos.get(this.activeAxis)!;
      const center = g.group.position.clone();
      // 在与按下时相同的相机朝向平面内求当前方位角
      const viewDir = this.camera.getWorldDirection(new THREE.Vector3()).negate();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir, center);
      const p = new THREE.Vector3();
      this.raycaster.setFromCamera(this.pointer, this.camera);
      if (!this.raycaster.ray.intersectPlane(plane, p)) return;
      const right = (this as unknown as { _e1: THREE.Vector3 })._e1;
      const up = (this as unknown as { _e1: THREE.Vector3; _e2: THREE.Vector3 })._e2;
      const rotAxis = (this as unknown as { _rotAxis: THREE.Vector3 })._rotAxis;
      const rel = p.sub(center);
      const ang = Math.atan2(rel.dot(up), rel.dot(right));
      let deltaDeg = THREE.MathUtils.radToDeg(ang - this.rotateStartAngle);
      if (this.angleLock) {
        const step = this.snapDegrees;
        deltaDeg = Math.round(deltaDeg / step) * step;
      }
      // 绕按下时的平面法向轴旋转"初始法向",得到当前法向
      const q = new THREE.Quaternion().setFromAxisAngle(rotAxis, THREE.MathUtils.degToRad(deltaDeg));
      const rotated = new THREE.Vector3(...this.rotateStartNormal).applyQuaternion(q);
      let normal: Vec3 = [rotated.x, rotated.y, rotated.z];
      if (this.angleLock) {
        normal = normalize(this.snapNormalOrthogonal(normal));
      }
      this.applyPlanePose(this.activeAxis, state.point, normal, true);
      return;
    }

    // 悬停高亮
    if (this.measureMode === 'off') {
      const picked = this.pickGizmo();
      for (const g of this.gizmos.values()) g.setHighlight(null);
      if (picked) {
        picked.gizmo.setHighlight(picked.part);
        this.renderer.domElement.style.cursor = 'grab';
        this.cb.onHover?.(picked.part === 'rotate' ? '拖动旋转剖切平面' : '拖动平移剖切平面');
      } else {
        this.renderer.domElement.style.cursor = '';
        this.cb.onHover?.('');
      }
    }
  };

  private onPointerUp = () => {
    if (this.mode !== 'none' && this.activeAxis) {
      const state = this.planes[this.activeAxis];
      // 松手:再触发一次,dirty 机制保证最终位姿一定被计算
      this.cb.onPlaneDrag?.(this.activeAxis, state.point, state.normal, false);
    }
    this.mode = 'none';
    this.activeAxis = null;
    this.activePart = null;
    this.controls.enabled = true;
  };

  /** 角度锁定时把法向吸附到最近正交方向(偏差小才吸附) */
  private snapNormalOrthogonal(n: Vec3): Vec3 {
    const dirs: Vec3[] = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
    ];
    let best = n;
    let bestD = Infinity;
    for (const d of dirs) {
      const dot = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
      const ang = Math.acos(clamp(dot, -1, 1));
      if (ang < bestD) { bestD = ang; best = d; }
    }
    const threshold = THREE.MathUtils.degToRad(this.snapDegrees * 0.6);
    return bestD <= threshold ? best : n;
  }

  /** 把平面点沿法向限制在模型投影范围(含少量外扩余量) */
  private clampAlongNormal(axis: AxisName, point: Vec3, normal: Vec3): Vec3 {
    const corners: THREE.Vector3[] = [];
    const [min, max] = [this.boundsMin, this.boundsMax];
    for (const x of [min[0], max[0]]) {
      for (const y of [min[1], max[1]]) {
        for (const z of [min[2], max[2]]) {
          corners.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of corners) {
      const pr = c.x * normal[0] + c.y * normal[1] + c.z * normal[2];
      lo = Math.min(lo, pr);
      hi = Math.max(hi, pr);
    }
    const margin = (hi - lo) * 0.02;
    lo -= margin;
    hi += margin;
    const cur = point[0] * normal[0] + point[1] * normal[1] + point[2] * normal[2];
    const clamped = clamp(cur, lo, hi);
    const d = clamped - cur;
    return [point[0] + normal[0] * d, point[1] + normal[1] * d, point[2] + normal[2] * d];
  }

  /** Gizmo 拖动 → 更新状态对象、Gizmo 位姿、裁剪,并回调通知重算截面 */
  private applyPlanePose(axis: AxisName, point: Vec3, normal: Vec3, dragging: boolean) {
    const state = this.planes[axis];
    state.point = point;
    state.normal = normalize(normal);
    const g = this.gizmos.get(axis)!;
    g.setPose(state.point, state.normal);
    this.refreshClipping();
    this.cb.onPlaneDrag?.(axis, state.point, state.normal, dragging);
  }

  // ---------- 测量 ----------

  private handleMeasureDown(e: PointerEvent) {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.measureMode === 'distance') {
      // 在所有启用的截面填充上求交
      const fills = AXES.map(a => this.sectionObjects[a].fill).filter(Boolean) as THREE.Mesh[];
      const hits = this.raycaster.intersectObjects(fills, false);
      if (!hits.length) return;
      const p3: Vec3 = [hits[0].point.x, hits[0].point.y, hits[0].point.z];
      const axis = hits[0].object.userData.axis as AxisName;
      if (!this.measureFirst) {
        this.measureFirst = p3;
        this.addMeasureMarker(p3, 0xffffff);
      } else {
        const d = distance(this.measureFirst, p3);
        this.addMeasureLine(this.measureFirst, p3);
        this.addMeasureLabel(`d = ${d.toFixed(4)}`, scale(add(this.measureFirst, p3), 0.5) as Vec3);
        this.cb.onMeasure?.({
          kind: 'distance',
          plane: axis,
          points: [this.measureFirst, p3],
          distance: d,
          label: `距离 ${d.toFixed(4)}`
        });
        this.measureFirst = null;
      }
      void e;
      return;
    }

    if (this.measureMode === 'area') {
      // 点选闭合轮廓:找射线到各轮廓的最近距离
      const found = this.pickContour();
      if (found) {
        const { axis, contourIndex } = found;
        const result = this.sectionObjects[axis].result!;
        const c = result.contours[contourIndex];
        const center = this.contourCenter(c.points3d);
        this.addMeasureLabel(`${c.isHole ? '孔面积' : '面积'} = ${c.area.toFixed(4)}`, center);
        this.highlightContour(axis, contourIndex);
        this.cb.onMeasure?.({
          kind: 'area',
          plane: axis,
          area: c.area,
          contourIndex,
          label: `${c.isHole ? '孔' : '轮廓'}面积 ${c.area.toFixed(4)}`
        });
      }
    }
  }

  /** 射线到轮廓折线的最近轮廓(屏幕距离阈值) */
  private pickContour(): { axis: AxisName; contourIndex: number } | null {
    const thresholdPx = 8;
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best: { axis: AxisName; contourIndex: number; distPx: number } | null = null;

    for (const axis of AXES) {
      const result = this.sectionObjects[axis].result;
      if (!result || !this.planes[axis].enabled || this.planes[axis].hidden) continue;
      result.contours.forEach((c, ci) => {
        for (let i = 0; i < c.points3d.length; i++) {
          const a = new THREE.Vector3(...c.points3d[i]);
          const b = new THREE.Vector3(...c.points3d[(i + 1) % c.points3d.length]);
          const d = this.rayToSegmentDistancePx(a, b, rect);
          if (d !== null && d <= thresholdPx && (!best || d < best.distPx)) {
            best = { axis, contourIndex: ci, distPx: d };
          }
        }
      });
    }
    return best;
  }

  private rayToSegmentDistancePx(a: THREE.Vector3, b: THREE.Vector3, rect: DOMRect): number | null {
    // 采样线段点投影到屏幕,取到指针的最小像素距离
    const samples = 12;
    let minD = Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i <= samples; i++) {
      v.lerpVectors(a, b, i / samples).project(this.camera);
      if (v.z < -1 || v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      const px = ((this.pointer.x + 1) / 2) * rect.width;
      const py = ((-this.pointer.y + 1) / 2) * rect.height;
      minD = Math.min(minD, Math.hypot(sx - px, sy - py));
    }
    return minD === Infinity ? null : minD;
  }

  private contourCenter(points: Vec3[]): Vec3 {
    const c: Vec3 = [0, 0, 0];
    for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    return scale(c, 1 / points.length) as Vec3;
  }

  private highlightContour(axis: AxisName, contourIndex: number) {
    const result = this.sectionObjects[axis].result!;
    const c = result.contours[contourIndex];
    const pts: number[] = [];
    c.points3d.forEach((p, i) => {
      const q = c.points3d[(i + 1) % c.points3d.length];
      pts.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffd23f, linewidth: 3 }));
    line.renderOrder = 5;
    this.measureGroup.add(line);
  }

  private addMeasureMarker(p: Vec3, color: number) {
    const s = this.gizmoSize * 0.02;
    const m = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 12), new THREE.MeshBasicMaterial({ color }));
    m.position.set(...p);
    this.measureGroup.add(m);
  }

  private addMeasureLine(a: Vec3, b: Vec3) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...a), new THREE.Vector3(...b)
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd23f }));
    line.renderOrder = 5;
    this.measureGroup.add(line);
    this.addMeasureMarker(b, 0xffd23f);
  }

  private addMeasureLabel(text: string, worldPos: Vec3) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const fontSize = 42;
    ctx.font = `bold ${fontSize}px sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + 28;
    canvas.width = w;
    canvas.height = fontSize + 22;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = 'rgba(16,20,27,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffd23f';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 14, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    const scale0 = this.gizmoSize * 0.12;
    sprite.scale.set(scale0 * (canvas.width / canvas.height), scale0, 1);
    sprite.position.set(...worldPos);
    sprite.renderOrder = 6;
    this.labelGroup.add(sprite);
  }

  clearMeasurements() {
    for (const child of [...this.measureGroup.children, ...this.labelGroup.children]) {
      const obj = child as THREE.Mesh | THREE.Line | THREE.Sprite;
      (obj as THREE.Mesh).geometry?.dispose?.();
      const mat = (obj as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) {
        (mat as THREE.SpriteMaterial).map?.dispose?.();
        mat.dispose();
      }
    }
    this.measureGroup.clear();
    this.labelGroup.clear();
    this.measureFirst = null;
  }

  setMeasureMode(mode: 'off' | 'distance' | 'area') {
    this.measureMode = mode;
    this.measureFirst = null;
    this.renderer.domElement.style.cursor = mode === 'off' ? '' : 'crosshair';
  }

  // ---------- 工具 ----------

  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  fitView() {
    if (!this.model) return;
    const box = new THREE.Box3().setFromObject(this.model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(size * 1.4));
    this.controls.update();
  }

  private onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerUp);
    this.clearModel();
    for (const g of this.gizmos.values()) g.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

