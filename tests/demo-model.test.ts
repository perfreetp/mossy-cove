import { describe, it, expect } from 'vitest';
import { buildDemoFossil } from '../src/lib/demo-model';

describe('示例化石', () => {
  it('生成有效闭合网格(顶点/索引合理、索引不越界)', async () => {
    const t0 = performance.now();
    const demo = await buildDemoFossil();
    const elapsed = performance.now() - t0;
    expect(demo.vertices.length).toBeGreaterThan(100);
    expect(demo.indices.length).toBeGreaterThan(100);
    expect(demo.indices.length % 3).toBe(0);
    const maxIndex = demo.vertices.length / 3 - 1;
    for (const i of demo.indices) expect(i).toBeLessThanOrEqual(maxIndex);
    console.log(`示例构建耗时 ${elapsed.toFixed(0)}ms, 顶点 ${demo.vertices.length / 3}, 三角面 ${demo.indices.length / 3}`);
  }, 120000);
});
