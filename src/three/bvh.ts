import * as THREE from 'three';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';

/** 挂载 three-mesh-bvh 的原型扩展,整个应用导入一次即可 */
declare module 'three' {
  interface BufferGeometry {
    boundsTree?: import('three-mesh-bvh').MeshBVH;
    computeBoundsTree: typeof computeBoundsTree;
    disposeBoundsTree: typeof disposeBoundsTree;
  }
  interface Mesh {
    raycast: typeof acceleratedRaycast;
  }
}

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export {};
