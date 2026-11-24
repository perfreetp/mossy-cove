// 地形：起伏地面的高度函数与 three.js 网格生成
import * as THREE from 'three';

/** 地面高度函数：多正弦叠加的缓丘地形 */
export function terrainHeight(x: number, z: number): number {
  return (
    0.55 * Math.sin(x * 0.22 + 1.3) * Math.cos(z * 0.18 - 0.7) +
    0.28 * Math.sin(x * 0.41 + z * 0.31 + 2.1) +
    0.15 * Math.cos(z * 0.55 - 0.4) -
    0.35
  );
}

/** 生成带顶点高度的地形平面（80×80，128 分段，位移在本地 y 方向） */
export function buildTerrainMesh(size = 80, segments = 128): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8a7a5f,
    roughness: 0.95,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}
