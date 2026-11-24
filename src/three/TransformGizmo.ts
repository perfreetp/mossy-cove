// 自定义变换手柄：选中骨骼的局部坐标轴旋转 / 整具骨架的平移+旋转
import * as THREE from 'three';
import type { TransformMode } from '../store/skeletonStore';

const AXIS_COLORS = {
  x: 0xff5348,
  y: 0x6bd968,
  z: 0x4d96ff,
};
type Axis = 'x' | 'y' | 'z';
const AXES: Axis[] = ['x', 'y', 'z'];

export interface DragResult {
  /** 当前累计欧拉角（弧度，XYZ），用于实时回写 */
  rotation: THREE.Euler;
  /** 拖动开始到当前的本轴增量（弧度） */
  deltaAngle: number;
  axis: Axis;
}

export interface TranslateResult {
  pos: THREE.Vector3;
}

interface DragState {
  axis: Axis;
  startAngle: number;
  startEuler: THREE.Euler;
  plane: THREE.Plane;
  center: THREE.Vector3;
}

interface TranslateDragState {
  plane: THREE.Plane;
  startPoint: THREE.Vector3;
  startPos: THREE.Vector3;
}

/**
 * 手柄由若干可拾取的 Mesh 组成（raycast 经 three-mesh-bvh 加速）。
 * 不使用 three/examples 的 TransformControls，保证旋转轴严格对齐局部坐标，
 * 且不会与 OrbitControls 状态互相干扰。
 */
export class TransformGizmo {
  readonly group = new THREE.Group();
  private axisMeshes = new Map<Axis, THREE.Object3D[]>();
  private hoverAxis: Axis | null = null;
  private drag: DragState | null = null;
  private translateDrag: TranslateDragState | null = null;
  private mode: TransformMode = 'rotate';

  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor() {
    this.buildRotateHandle();
    this.buildTranslateHandle();
    this.group.renderOrder = 999;
    this.group.traverse((o) => {
      o.userData.isGizmo = true;
      (o as THREE.Mesh).raycast = THREE.Mesh.prototype.raycast;
    });
  }

  private makeCylinder(axis: Axis, radius: number, height: number, mat: THREE.Material) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 8), mat);
    if (axis === 'x') m.rotation.z = -Math.PI / 2;
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    return m;
  }

  private buildRotateHandle() {
    const root = new THREE.Group();
    root.name = 'gizmo-rotate';
    for (const axis of AXES) {
      const color = AXIS_COLORS[axis];
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const len = 0.55;
      const shaft = this.makeCylinder(axis, 0.018, len, mat);
      if (axis === 'x') shaft.position.x = len / 2;
      if (axis === 'y') shaft.position.y = len / 2;
      if (axis === 'z') shaft.position.z = len / 2;

      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 12), mat);
      if (axis === 'x') {
        cone.rotation.z = -Math.PI / 2;
        cone.position.x = len + 0.07;
      } else if (axis === 'y') {
        cone.position.y = len + 0.07;
      } else {
        cone.rotation.x = Math.PI / 2;
        cone.position.z = len + 0.07;
      }

      // 加粗的隐形拾取体，方便点选
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hit = this.makeCylinder(axis, 0.09, len + 0.2, hitMat);
      if (axis === 'x') hit.position.x = (len + 0.2) / 2;
      if (axis === 'y') hit.position.y = (len + 0.2) / 2;
      if (axis === 'z') hit.position.z = (len + 0.2) / 2;

      for (const o of [shaft, cone, hit]) {
        o.userData.gizmoAxis = axis;
        root.add(o);
        this.axisMeshes.set(axis, [...(this.axisMeshes.get(axis) ?? []), o]);
      }
    }
    this.group.add(root);
    this.rotateRoot = root;
  }

  private rotateRoot!: THREE.Group;
  private translateRoot!: THREE.Group;

  private buildTranslateHandle() {
    const root = new THREE.Group();
    root.name = 'gizmo-translate';
    root.visible = false;
    for (const axis of AXES) {
      const color = AXIS_COLORS[axis];
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const len = 0.6;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 12), mat);
      if (axis === 'x') {
        arrow.rotation.z = -Math.PI / 2;
        arrow.position.x = len;
      } else if (axis === 'y') {
        arrow.position.y = len;
      } else {
        arrow.rotation.x = Math.PI / 2;
        arrow.position.z = len;
      }
      const shaft = this.makeCylinder(axis, 0.02, len, mat);
      if (axis === 'x') shaft.position.x = len / 2;
      if (axis === 'y') shaft.position.y = len / 2;
      if (axis === 'z') shaft.position.z = len / 2;

      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hit = this.makeCylinder(axis, 0.1, len, hitMat);
      if (axis === 'x') hit.position.x = len / 2;
      if (axis === 'y') hit.position.y = len / 2;
      if (axis === 'z') hit.position.z = len / 2;

      for (const o of [arrow, shaft, hit]) {
        o.userData.gizmoAxis = axis;
        root.add(o);
        this.axisMeshes.set(axis, [...(this.axisMeshes.get(axis) ?? []), o]);
      }
    }
    this.group.add(root);
    this.translateRoot = root;
  }

  setMode(mode: TransformMode) {
    this.mode = mode;
    this.rotateRoot.visible = mode === 'rotate';
    this.translateRoot.visible = mode === 'root';
  }

  getMode(): TransformMode {
    return this.mode;
  }

  /** 手柄定位：matrix 为关节（或根）世界矩阵 */
  place(matrix: THREE.Matrix4) {
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(matrix);
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  /** 命中检测：返回拾取到的轴；用于 hover 与 pointerdown */
  pickAxis(camera: THREE.Camera, ndc: THREE.Vector2): Axis | null {
    if (!this.group.visible) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const targets: THREE.Object3D[] = [];
    for (const [axis, arr] of this.axisMeshes) {
      const root = axis && this.mode === 'root' ? this.translateRoot : this.rotateRoot;
      for (const o of arr) if (o.parent === root) targets.push(o);
    }
    const hits = this.raycaster.intersectObjects(targets, false);
    return hits.length ? (hits[0].object.userData.gizmoAxis as Axis) : null;
  }

  setHover(axis: Axis | null) {
    if (axis === this.hoverAxis) return;
    this.hoverAxis = axis;
    for (const [a, arr] of this.axisMeshes) {
      const scale = a === axis ? 1.35 : 1;
      for (const o of arr) o.scale.setScalar(scale);
    }
  }

  // ---------- 旋转拖拽 ----------

  startRotate(
    axis: Axis,
    camera: THREE.Camera,
    ndc: THREE.Vector2,
    centerWorld: THREE.Vector3,
    basisWorld: THREE.Quaternion,
    startEuler: THREE.Euler,
  ): boolean {
    this.raycaster.setFromCamera(ndc, camera);
    const axisVec = new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0,
    ).applyQuaternion(basisWorld);

    // 过关节中心、垂直于该轴的平面
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisVec, centerWorld);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return false;

    this.drag = {
      axis,
      startAngle: Math.atan2(
        p.clone().sub(centerWorld).dot(this.perp(axisVec, 1)),
        p.clone().sub(centerWorld).dot(this.perp(axisVec, 0)),
      ),
      startEuler: startEuler.clone(),
      plane,
      center: centerWorld.clone(),
    };
    this.tmpQ.copy(basisWorld);
    return true;
  }

  /** 求平面内两个互相垂直的参考方向（用于 atan2） */
  private perp(axisVec: THREE.Vector3, which: 0 | 1): THREE.Vector3 {
    const ref = Math.abs(axisVec.dot(new THREE.Vector3(0, 1, 0))) > 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(axisVec, ref).normalize();
    const v = new THREE.Vector3().crossVectors(axisVec, u).normalize();
    return which === 0 ? u : v;
  }

  updateRotate(camera: THREE.Camera, ndc: THREE.Vector2): DragResult | null {
    if (!this.drag) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.drag.plane, p)) return null;
    const rel = p.sub(this.drag.center);
    const basis = this.tmpQ;
    const axisVec = new THREE.Vector3(
      this.drag.axis === 'x' ? 1 : 0,
      this.drag.axis === 'y' ? 1 : 0,
      this.drag.axis === 'z' ? 1 : 0,
    ).applyQuaternion(basis);
    const angle = Math.atan2(
      rel.dot(this.perp(axisVec, 1)),
      rel.dot(this.perp(axisVec, 0)),
    );
    let delta = angle - this.drag.startAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;

    const e = this.drag.startEuler.clone();
    const idx = this.drag.axis === 'x' ? 0 : this.drag.axis === 'y' ? 1 : 2;
    e.set(e.x + (idx === 0 ? delta : 0), e.y + (idx === 1 ? delta : 0), e.z + (idx === 2 ? delta : 0));
    return { rotation: e, deltaAngle: delta, axis: this.drag.axis };
  }

  endRotate() {
    this.drag = null;
  }

  isRotating(): boolean {
    return this.drag !== null;
  }

  // ---------- 平移拖拽（整具骨架） ----------

  startTranslate(camera: THREE.Camera, ndc: THREE.Vector2, startPos: THREE.Vector3): boolean {
    this.raycaster.setFromCamera(ndc, camera);
    // 平移平面：过根位置、面向相机
    const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, startPos);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return false;
    this.translateDrag = { plane, startPoint: p, startPos: startPos.clone() };
    return true;
  }

  updateTranslate(camera: THREE.Camera, ndc: THREE.Vector2): TranslateResult | null {
    if (!this.translateDrag) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.translateDrag.plane, p)) return null;
    this.tmpV.copy(p).sub(this.translateDrag.startPoint);
    this.tmpV2.copy(this.translateDrag.startPos).add(this.tmpV);
    return { pos: this.tmpV2.clone() };
  }

  endTranslate() {
    this.translateDrag = null;
  }

  isTranslating(): boolean {
    return this.translateDrag !== null;
  }

  /** 是否点中手柄任意部分（pointerdown 时先问它） */
  hitTest(camera: THREE.Camera, ndc: THREE.Vector2): Axis | null {
    return this.pickAxis(camera, ndc);
  }
}
