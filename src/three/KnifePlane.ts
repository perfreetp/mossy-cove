import * as THREE from 'three';
import type { AxisPreset } from '../types';

export interface KnifeState {
  normal: THREE.Vector3;
  center: THREE.Vector3;
  offset: number; // 相对模型中心的有符号偏移
  preset: AxisPreset;
}

/**
 * 可拖拽的平面刀：半透明刀面 + 法向手柄 + 边框。
 * 内部维护 center/normal，同步为 THREE.Plane 供裁剪算法使用。
 */
export class KnifePlane {
  readonly object = new THREE.Group();
  readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  readonly center = new THREE.Vector3();
  normal = new THREE.Vector3(0, 0, 1);
  private preset: AxisPreset = 'Z';
  private size = 2;

  private blade: THREE.Mesh;
  private frame: THREE.LineSegments;
  private arrow: THREE.ArrowHelper;

  constructor() {
    const bladeGeo = new THREE.PlaneGeometry(1, 1);
    const bladeMat = new THREE.MeshBasicMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.blade = new THREE.Mesh(bladeGeo, bladeMat);
    this.object.add(this.blade);

    const edges = new THREE.EdgesGeometry(bladeGeo);
    this.frame = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x81d4fa }),
    );
    this.object.add(this.frame);

    this.arrow = new THREE.ArrowHelper(
      this.normal,
      new THREE.Vector3(),
      0.35,
      0x29b6f6,
      0.09,
      0.05,
    );
    this.object.add(this.arrow);
    this.object.visible = false;
  }

  /** 按模型包围盒初始化刀位：居中、尺寸覆盖包围盒 */
  fitTo(geometry: THREE.BufferGeometry) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    this.size = Math.max(size.x, size.y, size.z) * 1.25;
    this.blade.scale.set(this.size, this.size, 1);
    this.frame.scale.set(this.size, this.size, 1);
    this.modelCenter.copy(center);
    this.center.copy(center);
    this.applyPreset(this.preset === 'FREE' ? 'Z' : this.preset, center);
  }

  applyPreset(preset: AxisPreset, modelCenter: THREE.Vector3) {
    this.preset = preset;
    this.center.copy(modelCenter);
    if (preset === 'X') this.normal.set(1, 0, 0);
    else if (preset === 'Y') this.normal.set(0, 1, 0);
    else if (preset === 'Z') this.normal.set(0, 0, 1);
    // FREE：保留当前法向
    this.syncPlaneFromState();
  }

  setNormal(normal: THREE.Vector3) {
    this.normal.copy(normal).normalize();
    this.preset = 'FREE';
    this.syncPlaneFromState();
  }

  setOffset(offset: number) {
    // offset 沿法向相对当前刀心调整（UI 滑块以模型中心为零点）
    const target = this.modelCenter.clone().addScaledVector(this.normal, offset);
    this.center.copy(target);
    this.syncPlaneFromState();
  }

  private modelCenter = new THREE.Vector3();
  setModelCenter(c: THREE.Vector3) {
    this.modelCenter.copy(c);
  }

  applyRotation(q: THREE.Quaternion) {
    this.normal.applyQuaternion(q).normalize();
    this.preset = 'FREE';
  }

  flip() {
    this.normal.negate();
    this.syncPlaneFromState();
  }

  /** center/normal 变化后同步 THREE.Plane、刀面朝向与箭头 */
  syncPlaneFromState() {
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.center);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      this.normal,
    );
    this.object.quaternion.copy(q);
    this.object.position.copy(this.center);
    this.arrow.position.copy(this.center);
    this.arrow.setDirection(this.normal);
    this.arrow.setLength(this.size * 0.22, this.size * 0.055, this.size * 0.03);
  }

  getState(): KnifeState {
    const offset = this.center.clone().sub(this.modelCenter).dot(this.normal);
    return {
      normal: this.normal.clone(),
      center: this.center.clone(),
      offset,
      preset: this.preset,
    };
  }

  /** 每帧更新钩子（当前无逐帧逻辑，保留接口） */
  update() {
    /* no-op */
  }

  dispose() {
    this.blade.geometry.dispose();
    (this.blade.material as THREE.Material).dispose();
    this.frame.geometry.dispose();
    (this.frame.material as THREE.Material).dispose();
    this.arrow.dispose();
  }
}
