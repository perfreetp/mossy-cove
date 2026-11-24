import * as THREE from 'three';
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel, Mesh as ManifoldMeshType } from 'manifold-3d';
// Vite emits and fingerprints the WASM asset for production builds.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import type { InterferenceReport, Vec3Tuple } from '../types';

let modulePromise: Promise<ManifoldToplevel> | null = null;

export function getManifold(): Promise<ManifoldToplevel> {
  if (!modulePromise) {
    modulePromise = Module({
      locateFile: () => manifoldWasmUrl,
    }).then((instance) => {
      instance.setup?.();
      return instance;
    });
  }
  return modulePromise;
}

export function geometryToManifold(
  wasm: ManifoldToplevel,
  geometry: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4,
): Manifold {
  if (!geometry.index) {
    throw new Error('实体网格必须包含索引');
  }

  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  const vertProperties = new Float32Array(position.count * 3);

  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i).applyMatrix4(worldMatrix);
    vertProperties[i * 3] = vertex.x;
    vertProperties[i * 3 + 1] = vertex.y;
    vertProperties[i * 3 + 2] = vertex.z;
  }

  const sourceIndex = geometry.index.array;
  const triVerts =
    sourceIndex instanceof Uint32Array
      ? sourceIndex
      : Uint32Array.from(sourceIndex as ArrayLike<number>);

  const mesh: ManifoldMeshType = new wasm.Mesh({
    numProp: 3,
    vertProperties,
    triVerts,
  });
  return new wasm.Manifold(mesh);
}

function manifoldMeshToGeometry(mesh: ManifoldMeshType): THREE.BufferGeometry {
  const numProp = mesh.numProp ?? 3;
  const source = mesh.vertProperties;
  const vertexCount = source.length / numProp;
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i += 1) {
    positions[i * 3] = source[i * numProp];
    positions[i * 3 + 1] = source[i * numProp + 1];
    positions[i * 3 + 2] = source[i * numProp + 2];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export interface InterferenceResult {
  report: Omit<InterferenceReport, 'aId' | 'bId' | 'evaluatedAt'>;
  intersectionGeometry?: THREE.BufferGeometry;
}

export async function evaluateInterference(
  aGeometry: THREE.BufferGeometry,
  aMatrix: THREE.Matrix4,
  bGeometry: THREE.BufferGeometry,
  bMatrix: THREE.Matrix4,
  overlapRatioLimit: number,
  gapSearchLength: number,
): Promise<InterferenceResult> {
  const wasm = await getManifold();
  let manifoldA: Manifold | null = null;
  let manifoldB: Manifold | null = null;
  let intersection: Manifold | null = null;

  try {
    manifoldA = geometryToManifold(wasm, aGeometry, aMatrix);
    manifoldB = geometryToManifold(wasm, bGeometry, bMatrix);

    const volumeA = Math.abs(manifoldA.volume());
    const volumeB = Math.abs(manifoldB.volume());
    const smallerVolume = Math.min(volumeA, volumeB);

    intersection = manifoldA.intersect(manifoldB);
    const intersectionVolume = Math.abs(intersection.volume());
    const overlapRatio = smallerVolume > 1e-12 ? intersectionVolume / smallerVolume : 0;

    let minGap = 0;
    if (intersectionVolume <= 1e-8) {
      minGap = manifoldA.minGap(manifoldB, gapSearchLength);
    }

    const blocking = overlapRatio > overlapRatioLimit;
    const message = blocking
      ? `Manifold 布尔交集体积占较小碎片 ${(overlapRatio * 100).toFixed(2)}%，存在穿插，已阻止锁定。`
      : intersectionVolume > 1e-8
        ? `检测到轻微重叠 ${(overlapRatio * 100).toFixed(3)}%，低于锁定阈值。`
        : `未检测到实体穿插；Manifold 最小间隙 ${minGap.toFixed(3)}。`;

    let intersectionGeometry: THREE.BufferGeometry | undefined;
    if (intersectionVolume > 1e-8 && intersection.numVert?.() > 0) {
      try {
        intersectionGeometry = manifoldMeshToGeometry(intersection.getMesh());
      } catch {
        intersectionGeometry = undefined;
      }
    }

    return {
      report: {
        intersectionVolume,
        smallerVolume,
        overlapRatio,
        minGap,
        blocking,
        manifold: true,
        message,
      },
      intersectionGeometry,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? `Manifold 无法将网格构造为闭合实体：${error.message}。请修复/焊接网格后再锁定。`
        : 'Manifold 实体接触判定失败。';
    return {
      report: {
        intersectionVolume: 0,
        smallerVolume: 0,
        overlapRatio: 0,
        minGap: gapSearchLength,
        blocking: true,
        manifold: false,
        message,
      },
    };
  } finally {
    intersection?.delete();
    manifoldA?.delete();
    manifoldB?.delete();
  }
}

export function matrixWorldToTuple(matrix: THREE.Matrix4): Vec3Tuple {
  return [matrix.elements[12], matrix.elements[13], matrix.elements[14]];
}
