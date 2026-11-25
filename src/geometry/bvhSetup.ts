/**
 * three-mesh-bvh 装配：把加速结构挂到 BufferGeometry / Mesh 原型上。
 * 只需在应用入口 import 一次。
 */
import { BufferGeometry, Mesh } from 'three';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';

declare module 'three' {
  interface BufferGeometry {
    computeBoundsTree: typeof computeBoundsTree;
    disposeBoundsTree: typeof disposeBoundsTree;
  }
  interface Mesh {
    raycast: typeof acceleratedRaycast;
  }
}

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

export {};
