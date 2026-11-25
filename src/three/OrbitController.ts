import * as THREE from 'three';

/**
 * 轻量轨道控制器：左键旋转 / 右键平移 / 滚轮缩放。
 * 仅在 enabled（观察模式）时响应，避免与平面刀/补洞/顶点拖动冲突。
 */
export class OrbitController {
  readonly target = new THREE.Vector3(0, 0, 0);
  enabled = true;
  private spherical = new THREE.Spherical();
  private sphericalDelta = new THREE.Spherical();
  private panOffset = new THREE.Vector3();
  private scale = 1;
  private dom: HTMLElement;
  private camera: THREE.PerspectiveCamera;
  private isAllowed: () => boolean;
  private rotateState: { x: number; y: number } | null = null;
  private panState: { x: number; y: number } | null = null;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, isAllowed: () => boolean) {
    this.camera = camera;
    this.dom = dom;
    this.isAllowed = isAllowed;
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContextMenu);
  }

  private onContextMenu = (e: Event) => e.preventDefault();

  private onPointerDown = (e: PointerEvent) => {
    if (!this.isAllowed()) return;
    if (e.button === 0) {
      this.rotateState = { x: e.clientX, y: e.clientY };
      this.dom.setPointerCapture(e.pointerId);
      this.dom.addEventListener('pointermove', this.onRotateMove);
      this.dom.addEventListener('pointerup', this.onRotateUp, { once: true });
    } else if (e.button === 2) {
      this.panState = { x: e.clientX, y: e.clientY };
      this.dom.setPointerCapture(e.pointerId);
      this.dom.addEventListener('pointermove', this.onPanMove);
      this.dom.addEventListener('pointerup', this.onPanUp, { once: true });
    }
  };

  private onRotateMove = (e: PointerEvent) => {
    if (!this.rotateState) return;
    const dx = e.clientX - this.rotateState.x;
    const dy = e.clientY - this.rotateState.y;
    this.rotateState = { x: e.clientX, y: e.clientY };
    this.sphericalDelta.theta -= dx * 0.006;
    this.sphericalDelta.phi -= dy * 0.006;
    this.update();
  };

  private onRotateUp = () => {
    this.rotateState = null;
    this.dom.removeEventListener('pointermove', this.onRotateMove);
  };

  private onPanMove = (e: PointerEvent) => {
    if (!this.panState) return;
    const dx = e.clientX - this.panState.x;
    const dy = e.clientY - this.panState.y;
    this.panState = { x: e.clientX, y: e.clientY };
    this.pan(dx, dy);
    this.update();
  };

  private onPanUp = () => {
    this.panState = null;
    this.dom.removeEventListener('pointermove', this.onPanMove);
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.isAllowed()) return;
    e.preventDefault();
    this.scale *= Math.pow(0.95, Math.sign(e.deltaY));
    this.update();
  };

  private pan(dx: number, dy: number) {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.target);
    const targetDistance = offset.length() * Math.tan((this.camera.fov / 2) * Math.PI / 180);
    const panX = (-2 * dx * targetDistance) / this.dom.clientHeight;
    const panY = (2 * dy * targetDistance) / this.dom.clientHeight;
    const matrix = this.camera.matrix;
    const v = new THREE.Vector3();
    v.setFromMatrixColumn(matrix, 0).multiplyScalar(panX);
    const up = new THREE.Vector3().setFromMatrixColumn(matrix, 1).multiplyScalar(panY);
    this.panOffset.add(v).add(up);
  }

  update() {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.target);
    this.spherical.setFromVector3(offset);
    this.spherical.theta += this.sphericalDelta.theta;
    this.spherical.phi += this.sphericalDelta.phi;
    this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi, 0.05, Math.PI - 0.05);
    this.spherical.radius *= this.scale;
    this.spherical.makeSafe();
    this.target.add(this.panOffset);
    offset.setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
    this.camera.userData.target = this.target.clone();

    this.sphericalDelta.set(0, 0, 0);
    this.panOffset.set(0, 0, 0);
    this.scale = 1;
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
    this.dom.removeEventListener('pointermove', this.onRotateMove);
    this.dom.removeEventListener('pointermove', this.onPanMove);
  }
}
