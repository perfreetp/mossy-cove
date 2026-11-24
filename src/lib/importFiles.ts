import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FragmentCategory, SerializedGeometry } from '../types';
import {
  base64ToFloat32,
  base64ToUint32,
  float32ToBase64,
  uint32ToBase64,
  uid,
} from './utils';

export interface LoadedGeometry {
  geometryId: string;
  geometry: THREE.BufferGeometry;
  serialized: SerializedGeometry;
  suggestedCode: string;
  category: FragmentCategory;
  sourceName: string;
}

const CATEGORY_KEYWORDS: Array<{ category: FragmentCategory; keys: string[] }> = [
  { category: '股骨', keys: ['股骨', 'femur'] },
  { category: '胫骨', keys: ['胫骨', 'tibia'] },
  { category: '腓骨', keys: ['腓骨', 'fibula'] },
  { category: '肱骨', keys: ['肱骨', 'humerus'] },
  { category: '桡尺骨', keys: ['桡骨', '尺骨', 'radius', 'ulna'] },
  { category: '椎骨', keys: ['椎骨', '脊椎', 'vertebra'] },
  { category: '骨盆', keys: ['骨盆', 'pelvis', 'pelvic'] },
  { category: '颅骨', keys: ['颅骨', '头骨', 'cran', 'skull'] },
];

export function classifyFileName(fileName: string): { code: string; category: FragmentCategory } {
  const base = fileName.replace(/\.[^.]+$/, '');
  const lower = base.toLowerCase();
  let category: FragmentCategory = '未归类';
  for (const item of CATEGORY_KEYWORDS) {
    if (item.keys.some((key) => lower.includes(key.toLowerCase()))) {
      category = item.category;
      break;
    }
  }

  const codeMatch =
    base.match(/(?:^|[_\-\s().\[])([A-Za-z]{0,4}\d{1,4}[A-Za-z]?)(?:[_\-\s).\]]|$)/) ??
    base.match(/(\d{1,4})/);
  const code = codeMatch?.[1] ?? '';
  return { code, category };
}

export function normalizeGeometry(input: THREE.BufferGeometry): THREE.BufferGeometry {
  let geometry = input;
  if (!geometry.getAttribute('position')) {
    throw new Error('网格缺少 position 顶点数据');
  }

  // Keep only position; normals are rebuilt consistently after welding.
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const clean = new THREE.BufferGeometry();
  clean.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(position.array as Float32Array), 3),
  );

  const welded = mergeVertices(clean, 1e-5);
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  clean.dispose();
  if (geometry !== input) geometry.dispose();
  return welded;
}

export function serializeGeometry(
  geometryId: string,
  geometry: THREE.BufferGeometry,
): SerializedGeometry {
  const normalized = geometry.index ? geometry : normalizeGeometry(geometry);
  const position = normalized.getAttribute('position');
  if (!(position.array instanceof Float32Array)) {
    throw new Error('仅支持 Float32 顶点缓冲');
  }

  let indexBase64: string | undefined;
  let indexCount = 0;
  if (normalized.index) {
    const source = normalized.index.array;
    const index =
      source instanceof Uint32Array ? source : new Uint32Array(source as ArrayLike<number>);
    indexBase64 = uint32ToBase64(index);
    indexCount = index.length;
  }

  return {
    geometryId,
    format: 'bone-pack-geometry-v1',
    vertexCount: position.count,
    indexCount,
    positionBase64: float32ToBase64(position.array as Float32Array),
    indexBase64,
  };
}

export function deserializeGeometry(data: SerializedGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = base64ToFloat32(data.positionBase64);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (data.indexBase64) {
    const indices = base64ToUint32(data.indexBase64);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

async function readFileGeometry(file: File): Promise<THREE.BufferGeometry> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'stl') {
    const buffer = await file.arrayBuffer();
    return new STLLoader().parse(buffer);
  }
  if (extension === 'ply') {
    const buffer = await file.arrayBuffer();
    return new PLYLoader().parse(buffer);
  }
  if (extension === 'obj') {
    const text = await file.text();
    const root = new OBJLoader().parse(text);
    root.updateMatrixWorld(true);
    const pieces: THREE.BufferGeometry[] = [];
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const g = child.geometry.clone();
        g.applyMatrix4(child.matrixWorld);
        pieces.push(g);
      }
    });
    if (!pieces.length) throw new Error('OBJ 中没有网格');
    if (pieces.length === 1) return pieces[0];
    const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    if (!merged) throw new Error('无法合并 OBJ 中的网格');
    return merged;
  }
  throw new Error(`暂不支持 .${extension} 格式，请使用 OBJ / STL / PLY`);
}

export async function loadFragmentFile(file: File): Promise<LoadedGeometry> {
  const raw = await readFileGeometry(file);
  const geometry = normalizeGeometry(raw);
  raw.dispose?.();
  const geometryId = uid('geo');
  const serialized = serializeGeometry(geometryId, geometry);
  const { code, category } = classifyFileName(file.name);
  return {
    geometryId,
    geometry,
    serialized,
    suggestedCode: code,
    category,
    sourceName: file.name,
  };
}
