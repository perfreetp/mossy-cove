// 模型解析器测试:二进制 STL 与 ASCII OBJ
import { describe, it, expect } from 'vitest';
import { parseModel } from '../src/lib/mesh-loaders';

function makeBinarySTL(triangles: Array<{ n: [number, number, number]; v: number[][] }>): ArrayBuffer {
  const buf = new ArrayBuffer(84 + triangles.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triangles.length, true);
  let o = 84;
  for (const tri of triangles) {
    dv.setFloat32(o, tri.n[0], true); dv.setFloat32(o + 4, tri.n[1], true); dv.setFloat32(o + 8, tri.n[2], true);
    o += 12;
    for (const v of tri.v) {
      dv.setFloat32(o, v[0], true); dv.setFloat32(o + 4, v[1], true); dv.setFloat32(o + 8, v[2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

describe('模型解析器', () => {
  it('解析二进制 STL(单三角)', async () => {
    const stl = makeBinarySTL([{
      n: [0, 0, 1],
      v: [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    }]);
    const { vertices, indices } = await parseModel('cube.stl', stl);
    expect(vertices).toHaveLength(9);
    expect(Array.from(indices)).toEqual([0, 1, 2]);
    expect(vertices[3]).toBeCloseTo(1);
    expect(vertices[7]).toBeCloseTo(1);
  });

  it('解析 ASCII OBJ(四边面拆为两个三角形)', async () => {
    const obj = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`;
    const { vertices, indices } = await parseModel('quad.obj', new TextEncoder().encode(obj).buffer);
    expect(vertices).toHaveLength(12);
    expect(indices).toHaveLength(6);
    expect(Array.from(indices)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('不支持的格式抛出明确错误', async () => {
    await expect(parseModel('model.xyz', new ArrayBuffer(0))).rejects.toThrow(/不支持/);
  });
});
