import * as THREE from 'three';
import type { FragmentCategory, Vec3Tuple } from '../types';
import { normalizeGeometry, serializeGeometry, type LoadedGeometry } from './importFiles';
import { uid } from './utils';

export interface DemoSeed {
  loaded: LoadedGeometry;
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  code: string;
  category: FragmentCategory;
}

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic by position so duplicated face vertices deform identically and can be welded. */
function positionNoise(x: number, y: number, z: number, salt: number): number {
  const ix = Math.round(x * 100000);
  const iy = Math.round(y * 100000);
  const iz = Math.round(z * 100000);
  let h = (salt ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function createShardGeometry(index: number, compact: boolean): THREE.BufferGeometry {
  const radius = compact ? 0.34 : 0.72;
  const geometry = new THREE.IcosahedronGeometry(radius, compact ? 0 : 1);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();

  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    const { x: ox, y: oy, z: oz } = vertex;
    const radial = 0.74 + positionNoise(ox, oy, oz, index + 1) * 0.46;
    vertex.multiplyScalar(radial);
    vertex.x *= 0.72 + positionNoise(ox, oy, oz, index + 2) * 0.2;
    vertex.y *= compact
      ? 1.05 + positionNoise(ox, oy, oz, index + 3) * 0.35
      : 1.35 + positionNoise(ox, oy, oz, index + 3) * 0.55;
    vertex.z *= 0.62 + positionNoise(ox, oy, oz, index + 4) * 0.3;

    // Flatten an irregular cap to suggest a fracture face.
    if (vertex.y > radius * 0.55) {
      vertex.y = radius * (0.48 + positionNoise(ox, oy, oz, index + 5) * 0.16);
      vertex.x *= 1.08;
      vertex.z *= 1.08;
    }
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createDemoSeeds(count = 12): DemoSeed[] {
  const compact = count > 40;
  const columns = Math.ceil(Math.sqrt(count));
  const spacing = compact ? 1.05 : 2.35;
  const rowOffset = ((Math.ceil(count / columns) - 1) * spacing) / 2;
  const columnOffset = ((columns - 1) * spacing) / 2;
  const categories: FragmentCategory[] = ['股骨', '胫骨', '肱骨', '未归类'];

  return Array.from({ length: count }, (_, index) => {
    const rawGeometry = createShardGeometry(index, compact);
    const geometry = normalizeGeometry(rawGeometry);
    rawGeometry.dispose();
    const geometryId = uid('geo');
    const serialized = serializeGeometry(geometryId, geometry);
    const row = Math.floor(index / columns);
    const column = index % columns;
    const jitter = seeded(index * 7919 + 17);
    const code = compact ? `S${String(index + 1).padStart(3, '0')}` : `F${String(index + 1).padStart(3, '0')}`;
    return {
      loaded: {
        geometryId,
        geometry,
        serialized,
        suggestedCode: code,
        category: compact ? '未归类' : categories[index % categories.length],
        sourceName: `演示碎片-${code}.stl`,
      } satisfies LoadedGeometry,
      position: [
        column * spacing - columnOffset + (jitter() - 0.5) * 0.35,
        (jitter() - 0.5) * 0.25,
        row * spacing - rowOffset + (jitter() - 0.5) * 0.35,
      ],
      rotation: [jitter() * Math.PI, jitter() * Math.PI, jitter() * Math.PI],
      code,
      category: compact ? '未归类' : categories[index % categories.length],
    };
  });
}
