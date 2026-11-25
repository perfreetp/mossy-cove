import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface LoadedModel {
  geometry: THREE.BufferGeometry;
  name: string;
}

/** 导入 OBJ / STL / GLTF/GLB，统一为带 aCap 标记、BVH 的 indexed 网格 */
export async function loadModelFile(file: File): Promise<LoadedModel> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const buffer = await file.arrayBuffer();
  let geometry: THREE.BufferGeometry;

  if (ext === 'obj') {
    const text = new TextDecoder().decode(buffer);
    const group = new OBJLoader().parse(text);
    geometry = extractFirstGeometry(group);
  } else if (ext === 'stl') {
    const raw = new STLLoader().parse(buffer);
    geometry = raw.index ? raw : mergeVertices(raw, 1e-4);
  } else if (ext === 'gltf' || ext === 'glb') {
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    geometry = extractFirstGeometry(gltf.scene);
  } else {
    throw new Error(`不支持的格式：.${ext}（支持 OBJ / STL / GLTF / GLB）`);
  }

  geometry = normalizeGeometry(geometry);
  return { geometry, name: file.name.replace(/\.[^.]+$/, '') };
}

function extractFirstGeometry(root: THREE.Object3D): THREE.BufferGeometry {
  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && mesh.geometry.getAttribute('position')) {
      meshes.push(mesh);
    }
  });
  if (meshes.length === 0) throw new Error('文件中未找到网格');
  return meshes[0].geometry.clone();
}

/** 统一 indexed、居中到原点、缩放到 2 个单位量级，补齐 aCap / group / BVH */
function normalizeGeometry(input: THREE.BufferGeometry): THREE.BufferGeometry {
  let geometry = input;
  if (!geometry.index) geometry = mergeVertices(geometry, 1e-4);
  geometry = geometry.clone();

  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 2 / maxDim;

  geometry.scale(scale, scale, scale);
  geometry.translate(-center.x * scale, -center.y * scale, -center.z * scale);

  const posCount = geometry.getAttribute('position').count;
  geometry.setAttribute('aCap', new THREE.Float32BufferAttribute(new Float32Array(posCount), 1));
  geometry.clearGroups();
  geometry.addGroup(0, geometry.index!.count, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeBoundsTree();
  return geometry;
}
