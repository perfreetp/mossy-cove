// 性能回归测试:截面计算延迟必须能跟上手拖(单帧预算 ~50ms)
import { describe, it, beforeAll, expect } from 'vitest';
import Module from 'manifold-3d/manifold';
import { join } from 'node:path';
import { buildDemoFossil } from '../src/lib/demo-model';
import { planeBasis } from '../src/lib/math';

let M: any;
let body: any;

beforeAll(async () => {
  M = await Module({ locateFile: () => join(process.cwd(), 'node_modules/manifold-3d/manifold.wasm') });
  M.setup();
  const demo = await buildDemoFossil();
  const mesh = new M.Mesh({
    numProp: 3, vertProperties: demo.vertices, triVerts: demo.indices, tolerance: 1e-4
  });
  body = new M.Manifold(mesh);
});

function sliceAt(point: number[], normal: number[]) {
  const { e1, e2, n } = planeBasis(normal as any);
  const m = new Array(16).fill(0);
  m[0] = e1[0]; m[1] = e1[1]; m[2] = e1[2];
  m[4] = e2[0]; m[5] = e2[1]; m[6] = e2[2];
  m[8] = n[0]; m[9] = n[1]; m[10] = n[2]; m[15] = 1;
  m[12] = -(m[0] * point[0] + m[1] * point[1] + m[2] * point[2]);
  m[13] = -(m[4] * point[0] + m[5] * point[1] + m[6] * point[2]);
  m[14] = -(m[8] * point[0] + m[9] * point[1] + m[10] * point[2]);
  const local = body.transform(m);
  const cs = local.slice(0);
  const polys = cs.toPolygons();
  if (polys.length) M.triangulate(polys, -1, false);
  cs.delete();
  local.delete();
}

describe('截面性能(约 1.1 万面模型)', () => {
  it('交互切片 p90 低于 30ms(跟得上拖动)', () => {
    const N = 30;
    const times: number[] = [];
    for (let i = 0; i < N; i++) {
      const z = -0.4 + 0.8 * i / (N - 1);
      const t0 = performance.now();
      sliceAt([0, 0.3, z], [0, 0, 1]);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p90 = times[Math.floor(N * 0.9)];
    expect(p90).toBeLessThan(30);
  });

  it('16 张批量切片 1 秒内完成', () => {
    const t0 = performance.now();
    for (let i = 0; i < 16; i++) {
      const z = -0.45 + 0.9 * i / 15;
      sliceAt([0, 0.3, z], [0, 0, 1]);
    }
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
