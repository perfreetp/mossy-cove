import * as THREE from 'three';
import { WORLD_SIZE } from './config';
import { indexAt } from './heightfield';

type RangeAttribute = THREE.BufferAttribute & {
  clearUpdateRanges?: () => void;
  addUpdateRange?: (start: number, count: number) => void;
};

export function createTerrainGeometry(resolution: number, heights: Float32Array): THREE.BufferGeometry {
  const row = resolution + 1;
  const vertexCount = row * row;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const cell = WORLD_SIZE / resolution;

  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      const id = indexAt(i, j, row);
      positions[id * 3] = (i - resolution / 2) * cell;
      positions[id * 3 + 1] = heights[id];
      positions[id * 3 + 2] = (j - resolution / 2) * cell;
      uvs[id * 2] = i / resolution;
      uvs[id * 2 + 1] = j / resolution;
    }
  }

  const indexCount = resolution * resolution * 6;
  const indices = new Uint32Array(indexCount);
  let p = 0;
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const a = indexAt(i, j, row);
      const b = indexAt(i + 1, j, row);
      const c = indexAt(i, j + 1, row);
      const d = indexAt(i + 1, j + 1, row);
      indices[p++] = a; indices[p++] = c; indices[p++] = b;
      indices[p++] = b; indices[p++] = c; indices[p++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  computeNormalRegion(heights, resolution, 0, resolution, 0, resolution, normals);
  geometry.attributes.normal.needsUpdate = true;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 34);
  return geometry;
}

export function computeNormalRegion(
  heights: Float32Array,
  resolution: number,
  i0: number,
  i1: number,
  j0: number,
  j1: number,
  normals: Float32Array
): void {
  const row = resolution + 1;
  const cell = WORLD_SIZE / resolution;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const id = indexAt(i, j, row);
      const il = Math.max(0, i - 1);
      const ir = Math.min(resolution, i + 1);
      const jd = Math.max(0, j - 1);
      const ju = Math.min(resolution, j + 1);
      const hL = heights[indexAt(il, j, row)];
      const hR = heights[indexAt(ir, j, row)];
      const hD = heights[indexAt(i, jd, row)];
      const hU = heights[indexAt(i, ju, row)];
      const dx = (hR - hL) / ((ir - il) * cell);
      const dz = (hU - hD) / ((ju - jd) * cell);
      const inv = 1 / Math.hypot(dx, 1, dz);
      normals[id * 3] = -dx * inv;
      normals[id * 3 + 1] = inv;
      normals[id * 3 + 2] = -dz * inv;
    }
  }
}

export function uploadRowRanges(
  attribute: THREE.BufferAttribute,
  resolution: number,
  i0: number,
  i1: number,
  j0: number,
  j1: number
): void {
  const attr = attribute as RangeAttribute;
  attr.clearUpdateRanges?.();
  const row = resolution + 1;
  if (attr.addUpdateRange) {
    for (let j = j0; j <= j1; j++) {
      const start = (j * row + i0) * attribute.itemSize;
      const count = (i1 - i0 + 1) * attribute.itemSize;
      attr.addUpdateRange(start, count);
    }
  }
  attribute.needsUpdate = true;
}

export function uploadWholeAttribute(attribute: THREE.BufferAttribute): void {
  const attr = attribute as RangeAttribute;
  attr.clearUpdateRanges?.();
  attribute.needsUpdate = true;
}
