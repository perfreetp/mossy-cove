// 模型文件解析:STL / OBJ / PLY(手写)、GLB/GLTF(three GLTFLoader)
// 统一输出非交织顶点 Float32Array(x,y,z 连续)与 Uint32Array 索引
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

export interface RawMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

function isBinarySTL(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 84) return false;
  const reader = new DataView(buf);
  const triCount = reader.getUint32(80, true);
  return 84 + triCount * 50 === buf.byteLength;
}

function parseSTL(buf: ArrayBuffer): RawMesh {
  if (isBinarySTL(buf)) {
    const reader = new DataView(buf);
    const triCount = reader.getUint32(80, true);
    const vertices = new Float32Array(triCount * 9);
    const indices = new Uint32Array(triCount * 3);
    let o = 84;
    for (let t = 0; t < triCount; t++) {
      o += 12; // 跳过法向
      const base = t * 9;
      for (let k = 0; k < 9; k++) {
        vertices[base + k] = reader.getFloat32(o, true);
        o += 4;
      }
      o += 2; // 属性位
      indices[t * 3] = t * 3;
      indices[t * 3 + 1] = t * 3 + 1;
      indices[t * 3 + 2] = t * 3 + 2;
    }
    return { vertices, indices };
  }

  // ASCII STL
  const text = new TextDecoder().decode(buf);
  const nums = text.match(/vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g) ?? [];
  const vertices = new Float32Array(nums.length * 3);
  const indices = new Uint32Array(nums.length);
  nums.forEach((line, i) => {
    const m = line.trim().split(/\s+/);
    vertices[i * 3] = parseFloat(m[1]);
    vertices[i * 3 + 1] = parseFloat(m[2]);
    vertices[i * 3 + 2] = parseFloat(m[3]);
    indices[i] = i;
  });
  return { vertices, indices };
}

function parseOBJ(buf: ArrayBuffer): RawMesh {
  const text = new TextDecoder().decode(buf);
  const positions: number[] = [];
  const outVerts: number[] = [];
  const outIdx: number[] = [];
  const remap = new Map<string, number>();

  const getVert = (token: string): number => {
    const vi = parseInt(token.split('/')[0], 10);
    const key = String(vi);
    const existing = remap.get(key);
    if (existing !== undefined) return existing;
    const src = (vi > 0 ? vi - 1 : positions.length / 3 + vi) * 3;
    const idx = outVerts.length / 3;
    outVerts.push(positions[src], positions[src + 1], positions[src + 2]);
    remap.set(key, idx);
    return idx;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/).slice(1).map(Number);
      positions.push(p[0], p[1], p[2]);
    } else if (line.startsWith('f ')) {
      const tokens = line.split(/\s+/).slice(1);
      const face = tokens.map(getVert);
      for (let i = 1; i < face.length - 1; i++) {
        outIdx.push(face[0], face[i], face[i + 1]);
      }
    }
  }
  return {
    vertices: new Float32Array(outVerts),
    indices: new Uint32Array(outIdx)
  };
}

function parsePLY(buf: ArrayBuffer): RawMesh {
  const bytes = new Uint8Array(buf);
  // 找 header 结束
  let headerEnd = -1;
  const decoder = new TextDecoder();
  for (let i = 0; i < bytes.length - 10; i++) {
    if (bytes[i] === 101 && bytes[i + 1] === 110 && bytes[i + 2] === 100 &&
        bytes[i + 3] === 95 && bytes[i + 4] === 104 && bytes[i + 5] === 101 &&
        bytes[i + 6] === 97 && bytes[i + 7] === 100 && bytes[i + 8] === 101 &&
        bytes[i + 9] === 114) {
      // "end_header",跳到行尾
      let j = i + 10;
      while (j < bytes.length && bytes[j] !== 10) j++;
      headerEnd = j + 1;
      break;
    }
  }
  if (headerEnd < 0) throw new Error('PLY: 找不到 end_header');
  const header = decoder.decode(bytes.subarray(0, headerEnd));
  const lines = header.split(/\r?\n/);

  let format: 'ascii' | 'binary_little_endian' = 'ascii';
  let vertexCount = 0;
  let faceCount = 0;
  let vProps: string[] = [];
  let fProps: string[] = [];
  let current = '';
  for (const line of lines) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'format') {
      format = t[1] as typeof format;
    } else if (t[0] === 'element') {
      current = t[1];
      if (current === 'vertex') vertexCount = parseInt(t[2], 10);
      if (current === 'face') faceCount = parseInt(t[2], 10);
    } else if (t[0] === 'property') {
      if (current === 'vertex') vProps.push(t[2]);
      if (current === 'face') fProps.push(t.slice(1).join(' '));
    }
  }
  const xI = vProps.indexOf('x');
  const yI = vProps.indexOf('y');
  const zI = vProps.indexOf('z');
  if (xI < 0 || yI < 0 || zI < 0) throw new Error('PLY: 顶点缺少 x/y/z 属性');

  const vertices = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  if (format === 'ascii') {
    const body = decoder.decode(bytes.subarray(headerEnd)).split(/\r?\n/).filter(l => l.trim());
    let lineNo = 0;
    for (let v = 0; v < vertexCount; v++) {
      const p = body[lineNo++].trim().split(/\s+/).map(Number);
      vertices[v * 3] = p[xI];
      vertices[v * 3 + 1] = p[yI];
      vertices[v * 3 + 2] = p[zI];
    }
    for (let f = 0; f < faceCount; f++) {
      const p = body[lineNo++].trim().split(/\s+/).map(Number);
      const n = p[0];
      for (let k = 1; k <= n - 2; k++) indices.push(p[1], p[k + 1], p[k + 2]);
    }
  } else {
    const dv = new DataView(buf, headerEnd);
    let off = 0;
    const sizeOf = (t: string): number =>
      t === 'float' || t === 'int' || t === 'uint' ? 4 : t === 'short' || t === 'uchar' ? 2 : 1;
    const vSizes = vProps.map(p => {
      const t = p.split(/\s+/);
      return t.includes('double') ? 8 : sizeOf(t[t.length - 2] ?? 'float');
    });
    const readProp = (type: string): number => {
      const le = true;
      let val = 0;
      if (type === 'float' || type === 'float32') { val = dv.getFloat32(off, le); off += 4; }
      else if (type === 'double' || type === 'float64') { val = dv.getFloat64(off, le); off += 8; }
      else if (type === 'uchar' || type === 'uint8') { val = dv.getUint8(off); off += 1; }
      else if (type === 'int' || type === 'int32') { val = dv.getInt32(off, le); off += 4; }
      else if (type === 'uint' || type === 'uint32') { val = dv.getUint32(off, le); off += 4; }
      else if (type === 'short' || type === 'int16') { val = dv.getInt16(off, le); off += 2; }
      else if (type === 'ushort' || type === 'uint16') { val = dv.getUint16(off, le); off += 2; }
      else throw new Error('PLY: 不支持的属性类型 ' + type);
      return val;
    };
    for (let v = 0; v < vertexCount; v++) {
      const row: number[] = [];
      for (let k = 0; k < vProps.length; k++) {
        const type = vProps[k].split(/\s+/)[0] === 'list' ? '' : vProps[k].split(/\s+/)[0];
        if (type) row.push(readProp(type));
        else off += vSizes[k];
      }
      vertices[v * 3] = row[xI];
      vertices[v * 3 + 1] = row[yI];
      vertices[v * 3 + 2] = row[zI];
    }
    for (let f = 0; f < faceCount; f++) {
      // 面属性通常只有一个 list
      const listProp = fProps.find(p => p.startsWith('list'));
      if (!listProp) continue;
      const t = listProp.split(/\s+/);
      const cntType = t[1];
      const idxType = t[2];
      const n = readProp(cntType);
      const face: number[] = [];
      for (let k = 0; k < n; k++) face.push(readProp(idxType));
      for (let k = 1; k <= n - 2; k++) indices.push(face[0], face[k], face[k + 1]);
    }
  }
  return { vertices, indices: new Uint32Array(indices) };
}

async function parseGLTF(buf: ArrayBuffer, fileName: string): Promise<RawMesh> {
  const loader = new GLTFLoader();
  const data = fileName.toLowerCase().endsWith('.gltf')
    ? new TextDecoder().decode(buf)
    : buf;
  const gltf = await loader.parseAsync(data, '');
  const outVerts: number[] = [];
  const outIdx: number[] = [];
  gltf.scene.updateMatrixWorld(true);

  gltf.scene.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    const geo = mesh.geometry;
    if (!geo?.attributes?.position) return;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const base = outVerts.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      outVerts.push(v.x, v.y, v.z);
    }
    if (mesh.geometry.index) {
      const idx = mesh.geometry.index;
      for (let i = 0; i < idx.count; i++) outIdx.push(base + idx.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) outIdx.push(base + i);
    }
  });
  return {
    vertices: new Float32Array(outVerts),
    indices: new Uint32Array(outIdx)
  };
}

export async function parseModel(fileName: string, buf: ArrayBuffer): Promise<RawMesh> {
  const name = fileName.toLowerCase();
  if (name.endsWith('.stl')) return parseSTL(buf);
  if (name.endsWith('.obj')) return parseOBJ(buf);
  if (name.endsWith('.ply')) return parsePLY(buf);
  if (name.endsWith('.glb') || name.endsWith('.gltf')) return parseGLTF(buf, fileName);
  throw new Error(`不支持的文件格式:${fileName}(支持 STL / OBJ / PLY / GLB / GLTF)`);
}
