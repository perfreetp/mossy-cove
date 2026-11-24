// 剖面平面挂件：可拖动的半透明平面 + 法线手柄，仅沿法线平移
import * as THREE from 'three';

export class ClipPlaneWidget {
  readonly group = new THREE.Group();
  private planeMesh: THREE.Mesh;
  private normalShaft: THREE.Mesh;
  private normalCone: THREE.Mesh;
  private hitCylinder: THREE.Mesh;
  private dragging = false;
  private raycaster = new THREE.Raycaster();
  private dragPlane = new THREE.Plane();
  private dragOffset = new THREE.Vector3();

  /** 当前世界裁切平面（渲染裁切与拖动逻辑共用） */
  readonly clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);

  constructor(size = 6) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x39d0d8,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), mat);
    this.group.add(this.planeMesh);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(size, size)),
      new THREE.LineBasicMaterial({ color: 0x39d0d8 }),
    );
    this.group.add(edge);

    const nmat = new THREE.MeshBasicMaterial({ color: 0x8ff5fb, depthTest: false });
    this.normalShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8), nmat);
    this.group.add(this.normalShaft);
    this.normalCone = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 12), nmat);
    this.group.add(this.normalCone);

    this.hitCylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 1.6, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.hitCylinder.userData.isClipHandle = true;
    this.group.add(this.hitCylinder);

    this.group.traverse((o) => {
      o.userData.isClipWidget = true;
    });
    this.group.visible = false;
  }

  /** 由项目数据同步：pos/normal 均为世界坐标 */
  update(pos: THREE.Vector3, normal: THREE.Vector3) {
    const n = normal.clone().normalize();
    this.clipPlane.normal.copy(n);
    this.clipPlane.constant = -n.dot(pos);

    // 让平面朝向法线（PlaneGeometry 默认法线 +Z）
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.group.position.copy(pos);
    this.group.quaternion.copy(q);

    // 法线指示箭头（从平面沿 +normal 伸出）
    const qY = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    this.normalShaft.quaternion.copy(qY);
    this.normalShaft.position.copy(n).multiplyScalar(0.6);
    this.normalCone.quaternion.copy(qY);
    this.normalCone.position.copy(n).multiplyScalar(1.3);
    this.hitCylinder.quaternion.copy(qY);
    this.hitCylinder.position.copy(n).multiplyScalar(0.6);
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  /** 裁切材质用的平面（世界空间） */
  getClipPlane(): THREE.Plane {
    return this.clipPlane;
  }

  hitTest(camera: THREE.Camera, ndc: THREE.Vector2): boolean {
    if (!this.group.visible) return false;
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObjects([this.planeMesh, this.hitCylinder], false);
    return hits.length > 0;
  }

  startDrag(camera: THREE.Camera, ndc: THREE.Vector2): boolean {
    this.raycaster.setFromCamera(ndc, camera);
    // 拖动沿法线方向进行，拾取平面是“垂直于屏幕、包含法线”的平面
    const viewDir = camera.getWorldDirection(new THREE.Vector3());
    const dragNormal = new THREE.Vector3().crossVectors(this.clipPlane.normal, viewDir).normalize();
    if (dragNormal.lengthSq() < 1e-6) dragNormal.set(1, 0, 0);
    this.dragPlane.setFromNormalAndCoplanarPoint(dragNormal, this.group.position);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, p)) return false;
    this.dragOffset.copy(p).sub(this.group.position);
    this.dragging = true;
    return true;
  }

  /** 返回新的平面位置（沿法线方向移动后的点） */
  updateDrag(camera: THREE.Camera, ndc: THREE.Vector2): THREE.Vector3 | null {
    if (!this.dragging) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, p)) return null;
    const worldPoint = p.sub(this.dragOffset);
    // 投影到法线直线：平面方程 n·x + c = 0，直线上点为 n·(n·x + c)
    const n = this.clipPlane.normal;
    const dist = worldPoint.dot(n) + this.clipPlane.constant;
    return n.clone().multiplyScalar(dist);
  }

  endDrag() {
    this.dragging = false;
  }

  isDragging(): boolean {
    return this.dragging;
  }
}
