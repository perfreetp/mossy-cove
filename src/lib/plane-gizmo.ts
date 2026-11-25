// 剖切平面 Gizmo:半透明平面 + 边缘 + 法向平移手柄 + 旋转环
import * as THREE from 'three';
import type { AxisName } from './types';
import { normalize, type Vec3 } from './math';

const PLANE_COLORS: Record<AxisName, number> = {
  x: 0xff5a5f,
  y: 0x4cc38a,
  z: 0x4d96ff
};

/** Gizmo 上的命中部件类型 */
export type GizmoHitPart = 'plane' | 'translate' | 'rotate';

export class PlaneGizmo {
  readonly axis: AxisName;
  readonly group = new THREE.Group();
  readonly color: number;
  private size: number;
  private planeMesh: THREE.Mesh;
  private frame: THREE.LineSegments;
  private translateHandle: THREE.Mesh;
  private rotateHandle: THREE.Mesh;
  private normalArrow: THREE.ArrowHelper;
  private fillMat: THREE.MeshBasicMaterial;

  constructor(axis: AxisName, size: number) {
    this.axis = axis;
    this.size = size;
    this.color = PLANE_COLORS[axis];

    this.fillMat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.fillMat);
    this.planeMesh.userData = { gizmo: this, part: 'plane' as GizmoHitPart };
    this.planeMesh.renderOrder = 2;

    // 边框
    const h = size / 2;
    const framePts = new Float32Array([
      -h, -h, 0, h, -h, 0, h, -h, 0, h, h, 0,
      h, h, 0, -h, h, 0, -h, h, 0, -h, -h, 0
    ]);
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.BufferAttribute(framePts, 3));
    this.frame = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 0.9 }));
    this.frame.userData = { gizmo: this, part: 'plane' as GizmoHitPart };

    // 平移手柄:法向末端的小方块
    this.translateHandle = new THREE.Mesh(
      new THREE.BoxGeometry(size * 0.06, size * 0.06, size * 0.06),
      new THREE.MeshBasicMaterial({ color: this.color })
    );
    this.translateHandle.position.set(0, 0, h);
    this.translateHandle.userData = { gizmo: this, part: 'translate' as GizmoHitPart };

    // 旋转环:平面内的圆环,拾取后绕法向旋转
    const ringGeo = new THREE.TorusGeometry(h * 0.82, size * 0.012, 8, 96);
    this.rotateHandle = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.55, depthWrite: false })
    );
    this.rotateHandle.userData = { gizmo: this, part: 'rotate' as GizmoHitPart };

    // 法向箭头
    this.normalArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0),
      size * 0.18, this.color, size * 0.05, size * 0.03
    );
    (this.normalArrow.line as THREE.Line).userData = { gizmo: this, part: 'translate' as GizmoHitPart };
    (this.normalArrow.cone as THREE.Mesh).userData = { gizmo: this, part: 'translate' as GizmoHitPart };

    this.group.add(this.planeMesh, this.frame, this.rotateHandle, this.translateHandle, this.normalArrow);
  }

  /** 由世界坐标的点与法向更新位姿 */
  setPose(point: Vec3, normal: Vec3) {
    const n = new THREE.Vector3(...normalize(normal));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.group.quaternion.copy(q);
    this.group.position.set(point[0], point[1], point[2]);
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  setHighlight(part: GizmoHitPart | null) {
    this.fillMat.opacity = part === 'plane' ? 0.22 : 0.08;
    (this.translateHandle.material as THREE.MeshBasicMaterial)
      .color.set(part === 'translate' ? 0xffffff : this.color);
    (this.rotateHandle.material as THREE.MeshBasicMaterial)
      .color.set(part === 'rotate' ? 0xffffff : this.color);
  }

  get pickables(): THREE.Object3D[] {
    return [this.planeMesh, this.frame, this.translateHandle, this.rotateHandle,
      this.normalArrow.line as THREE.Object3D, this.normalArrow.cone as THREE.Object3D];
  }

  /** 当前世界法向 */
  worldNormal(): Vec3 {
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion);
    return [v.x, v.y, v.z];
  }

  dispose() {
    this.planeMesh.geometry.dispose();
    this.frame.geometry.dispose();
    this.translateHandle.geometry.dispose();
    this.rotateHandle.geometry.dispose();
    (this.fillMat as THREE.Material).dispose();
    (this.frame.material as THREE.Material).dispose();
    (this.translateHandle.material as THREE.Material).dispose();
    (this.rotateHandle.material as THREE.Material).dispose();
  }
}
