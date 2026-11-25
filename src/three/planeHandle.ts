import * as THREE from 'three';
import type { AxisName } from '../types';
import { PLANE_FRAMES } from './joint';

const HANDLE_COLORS: Record<AxisName, number> = {
  x: 0x4fc3f7,
  y: 0x81c784,
  z: 0xba68c8,
};

/** 单个可拖动剖切面:半透明平面 + 中央手柄方块,手柄拾取优先级更高 */
export class PlaneHandle {
  readonly axis: AxisName;
  readonly group: THREE.Group;
  readonly planeMesh: THREE.Mesh;
  readonly knob: THREE.Mesh;
  readonly frame: { normal: THREE.Vector3; uDir: THREE.Vector3; vDir: THREE.Vector3 };

  constructor(axis: AxisName, size: number) {
    this.axis = axis;
    this.frame = PLANE_FRAMES[axis];
    this.group = new THREE.Group();
    this.group.name = `plane-handle-${axis}`;

    const geo = new THREE.PlaneGeometry(size, size);
    // PlaneGeometry 默认法线 +Z,旋到对应轴
    if (axis === 'x') geo.rotateY(Math.PI / 2);
    if (axis === 'y') geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: HANDLE_COLORS[axis],
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.planeMesh = new THREE.Mesh(geo, mat);
    this.planeMesh.userData.dragAxis = axis;
    this.group.add(this.planeMesh);

    // 边框线
    const borderGeo = new THREE.EdgesGeometry(geo);
    const border = new THREE.LineSegments(
      borderGeo,
      new THREE.LineBasicMaterial({
        color: HANDLE_COLORS[axis],
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.group.add(border);

    // 中央手柄
    const knobGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    const knobMat = new THREE.MeshBasicMaterial({ color: HANDLE_COLORS[axis] });
    this.knob = new THREE.Mesh(knobGeo, knobMat);
    this.knob.userData.dragAxis = axis;
    this.group.add(this.knob);
  }

  setOffset(offset: number): void {
    this.group.position.copy(this.frame.normal).multiplyScalar(offset);
  }

  setHover(hover: boolean): void {
    const mat = this.planeMesh.material as THREE.MeshBasicMaterial;
    mat.opacity = hover ? 0.22 : 0.1;
    (this.knob.material as THREE.MeshBasicMaterial).color.setHex(
      hover ? 0xfff176 : HANDLE_COLORS[this.axis],
    );
  }

  /** 屏幕指针射线与无限轴平面求交,返回沿轴的新偏移 */
  projectRay(raycaster: THREE.Raycaster): number | null {
    const plane = new THREE.Plane(this.frame.normal);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    return hit.dot(this.frame.normal);
  }

  /** 手柄/平面的可拾取对象 */
  pickables(): THREE.Object3D[] {
    return [this.planeMesh, this.knob];
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    this.planeMesh.geometry.dispose();
    (this.planeMesh.material as THREE.Material).dispose();
    this.knob.geometry.dispose();
    (this.knob.material as THREE.Material).dispose();
  }
}
