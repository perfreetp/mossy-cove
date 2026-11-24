// 生成一个最小合法 GLB（三角化立方体，positions + indices，无材质），用于模型导入测试
const fs = require('fs');
const path = require('path');
const os = require('os');

// 立方体 8 顶点，边长 2，中心原点
const positions = new Float32Array([
  -1, -1, -1,  1, -1, -1,  1, 1, -1, -1, 1, -1,
  -1, -1,  1,  1, -1,  1,  1, 1,  1, -1, 1,  1,
]);
// 12 个三角形
const indices = new Uint16Array([
  0, 1, 2, 0, 2, 3,
  4, 6, 5, 4, 7, 6,
  0, 4, 5, 0, 5, 1,
  3, 2, 6, 3, 6, 7,
  0, 3, 7, 0, 7, 4,
  1, 5, 6, 1, 6, 2,
]);

const posBytes = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
const idxBytes = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
// 4 字节对齐。GLB 规范要求 JSON chunk 用空格(0x20)填充、BIN chunk 用零字节填充
const pad4Zero = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
const pad4Space = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), 0x20)]) : b);
const bin = pad4Zero(Buffer.concat([posBytes, idxBytes]));
const posOffset = 0;
const idxOffset = posBytes.length;

const gltf = {
  asset: { version: '2.0', generator: 'btr-test' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: posOffset, byteLength: posBytes.length, target: 34962 },
    { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes.length, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3',
      min: [-1, -1, -1], max: [1, 1, 1] },
    { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
  ],
};
const jsonBuf = pad4Space(Buffer.from(JSON.stringify(gltf), 'utf8'));
const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonBuf.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"
const glb = Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]);

const out = path.join(os.tmpdir(), 'btr-io', 'test-cube.glb');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, glb);
console.log('GLB written:', out, glb.length, 'bytes');
module.exports = { out };
