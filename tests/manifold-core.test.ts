// manifold 核心逻辑测试(Node 环境):验证 worker 使用的 API 路径真实可用
import { describe, it, expect, beforeAll } from 'vitest';
import Module from 'manifold-3d/manifold';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ManifoldToplevel, Manifold } from 'manifold-3d/manifold';
import { planeBasis, signedArea2d } from '../src/lib/math';
import type { Vec3 } from '../src/lib/math';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '../node_modules/manifold-3d/manifold.wasm');

let M: ManifoldToplevel;
let box: Manifold;
let sphere: Manifold;

beforeAll(async () => {
  M = await Module({ locateFile: () => wasmPath });
  M.setup();
  expect(M).toBeTruthy();
  box = M.Manifold.cube([2, 2, 2], true);   // 2x2x2,中心原点
  sphere = M.Manifold.sphere(1, 96);        // 单位球
  expect(box.status()).toBe('NoError');
});

/** 复刻 manifold-worker.computeSection 的核心步骤 */
function sectionAt(point: Vec3, normal: Vec3, body: Manifold) {
  const { e1, e2, n } = planeBasis(normal);
  const toLocal = new Array(16).fill(0);
  toLocal[0] = e1[0]; toLocal[1] = e1[1]; toLocal[2] = e1[2];
  toLocal[4] = e2[0]; toLocal[5] = e2[1]; toLocal[6] = e2[2];
  toLocal[8] = n[0];  toLocal[9] = n[1];  toLocal[10] = n[2];
  toLocal[15] = 1;
  toLocal[12] = -(toLocal[0] * point[0] + toLocal[1] * point[1] + toLocal[2] * point[2]);
  toLocal[13] = -(toLocal[4] * point[0] + toLocal[5] * point[1] + toLocal[6] * point[2]);
  toLocal[14] = -(toLocal[8] * point[0] + toLocal[9] * point[1] + toLocal[10] * point[2]);

  const local = body.transform(toLocal as never);
  const cs = local.slice(0);
  const polygons = cs.toPolygons() as Array<Array<[number, number]>>;
  let triangles: Array<[number, number, number]> = [];
  if (polygons.length) triangles = M.triangulate(polygons, -1, false) as Array<[number, number, number]>;
  const total = polygons.reduce((s, p) => s + signedArea2d(p), 0);
  const worldPts = polygons.flatMap(poly => poly.map(([u, v]) => [
    e1[0] * u + e2[0] * v + point[0],
    e1[1] * u + e2[1] * v + point[1],
    e1[2] * u + e2[2] * v + point[2]
  ] as Vec3));
  cs.delete();
  local.delete();
  return { polygons, triangles, totalArea: Math.abs(total), worldPts };
}

describe('Manifold 实体与截面', () => {
  it('基本体是有效流形且包围盒正确', () => {
    expect(box.numVert()).toBeGreaterThan(0);
    const b = box.boundingBox();
    expect(b.max[0] - b.min[0]).toBeCloseTo(2, 5);
    expect(sphere.status()).toBe('NoError');
  });

  it('立方体中心截面面积为 4,为单个闭合环并可三角化', () => {
    const r = sectionAt([0, 0, 0], [0, 0, 1], box);
    expect(r.polygons.length).toBe(1);
    expect(r.polygons[0].length).toBeGreaterThanOrEqual(4);
    expect(r.totalArea).toBeCloseTo(4, 4);
    expect(r.triangles.length).toBeGreaterThan(0);
  });

  it('球体偏置平面面积与解析解 π(1-d²) 吻合(验证平移真正生效)', () => {
    for (const d of [-0.9, -0.5, 0.5, 0.9]) {
      const r = sectionAt([0, 0, d], [0, 0, 1], sphere);
      const expected = Math.PI * (1 - d * d);
      // 曲面细分带来约 1% 内误差
      expect(Math.abs(r.totalArea - expected) / expected).toBeLessThan(0.02);
    }
  });

  it('包围盒外的平面得到空截面', () => {
    const r = sectionAt([0, 0, 5], [0, 0, 1], sphere);
    expect(r.polygons.length).toBe(0);
    expect(r.triangles.length).toBe(0);
  });

  it('斜法向截面(45°)+偏移正确,且世界点严格落在平面上', () => {
    const n: Vec3 = [1 / Math.sqrt(2), 0, 1 / Math.sqrt(2)];
    const r0 = sectionAt([0, 0, 0], n, sphere);
    expect(r0.totalArea).toBeCloseTo(Math.PI, 1); // 过大圆
    const d = 0.7;
    const point: Vec3 = [n[0] * d, 0, n[2] * d];
    const r = sectionAt(point, n, sphere);
    expect(r.totalArea).toBeCloseTo(Math.PI * (1 - d * d), 1);
    for (const p of r.worldPts) {
      const residual = n[0] * (p[0] - point[0]) + n[1] * (p[1] - point[1]) + n[2] * (p[2] - point[2]);
      expect(Math.abs(residual)).toBeLessThan(1e-5);
    }
  });

  it('带孔截面:立方体减圆柱后产生外轮廓+孔两个闭合环', () => {
    const cyl = M.Manifold.cylinder(4, 0.5, 0.5, 48, true);
    const hollow = box.subtract(cyl);
    expect(hollow.status()).toBe('NoError');
    const r = sectionAt([0, 0, 0], [0, 0, 1], hollow);
    expect(r.polygons.length).toBe(2);
    const holes = r.polygons.filter(p => signedArea2d(p) < 0);
    expect(holes.length).toBe(1);
    expect(r.totalArea).toBeCloseTo(4 - Math.PI * 0.25, 2);
    const nVerts = r.polygons.reduce((s, p) => s + p.length, 0);
    for (const t of r.triangles) for (const i of t) expect(i).toBeLessThan(nVerts);
    cyl.delete();
    hollow.delete();
  });

  it('12 张批量切片:球的面积关于中心对称、向两端递减', () => {
    const count = 12;
    const areas: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const z = -0.95 + 1.9 * t;
      areas.push(sectionAt([0, 0, z], [0, 0, 1], sphere).totalArea);
    }
    for (let i = 0; i < count / 2; i++) {
      expect(areas[i]).toBeCloseTo(areas[count - 1 - i], 4);
    }
    expect(areas[5]).toBeGreaterThan(areas[1]);
    expect(areas[0]).toBeLessThan(areas[5] * 0.4);
  });

  it('非闭合网格构造 Manifold 会抛出可捕获错误', () => {
    const mesh = new M.Mesh({
      numProp: 3,
      vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triVerts: new Uint32Array([0, 1, 2])
    });
    expect(() => new M.Manifold(mesh)).toThrow();
  });
});
