import * as THREE from 'three';
import type { BoundaryLoop } from '../types';
import { polygonArea3D, polygonPerimeter3D } from './fillHole';

export interface SectionMeasurement {
  loopIndex: number;
  vertexCount: number;
  perimeter: number;
  area: number;
  normal: THREE.Vector3;
}

/** 对全部断面边界环量取周长与面积（模型空间单位） */
export function measureLoops(geometry: THREE.BufferGeometry, loops: BoundaryLoop[]): SectionMeasurement[] {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  return loops.map((loop, i) => {
    const pts = loop.indices.map((id) => new THREE.Vector3().fromBufferAttribute(pos, id));
    return {
      loopIndex: i,
      vertexCount: loop.indices.length,
      perimeter: polygonPerimeter3D(pts),
      area: polygonArea3D(pts),
      normal: loop.plane.normal.clone(),
    };
  });
}
