// 纯数学层单元测试：通过 esbuild 即时打包后在 Node 中运行
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'btr-math-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
  entry,
  `export * from ${JSON.stringify('D:/ccfb/runs/1000305/workspace/src/lib/math.ts')};`,
);
const outfile = join(dir, 'math.bundle.mjs');
await build({ entryPoints: [entry], outfile, format: 'esm', bundle: true, platform: 'node' });
const m = await import(pathToFileURL(outfile).href);

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log('  ✓', name);
};

// 1. 向量归一化
check('normalize 零向量回退到 Z 轴', () => {
  assert.deepEqual(m.normalize([0, 0, 0]), [0, 0, 1]);
  const n = m.normalize([3, 0, 4]);
  assert.ok(Math.abs(m.length(n) - 1) < 1e-9);
});

// 2. Hermite 拟合：固定 201 采样、端点精确通过、端点方向与给定方向一致
check('fitTrajectory 端点通过且采样数固定 201', () => {
  const r = m.fitTrajectory(
    [
      { p: [0, 0, 0], dir: [0, 0, 1] },
      { p: [0, 0, 10], dir: [0, 0, 1] },
    ],
    3,
    true,
  );
  assert.equal(r.samples.length, 201);
  assert.deepEqual(r.samples[0], [0, 0, 0]);
  assert.deepEqual(r.samples[200], [0, 0, 10]);
});

check('fitTrajectory 吸附时精确穿过中间约束点', () => {
  const r = m.fitTrajectory(
    [
      { p: [0, 0, 0], dir: [1, 0, 0] },
      { p: [5, 2, 0] },
      { p: [10, 0, 0], dir: [1, 0, 0] },
    ],
    3,
    true,
  );
  const mid = r.samples[100];
  assert.ok(Math.abs(mid[0] - 5) < 1e-6 && Math.abs(mid[1] - 2) < 1e-6, `中点=${mid}`);
});

check('fitTrajectory 软约束时偏离约束点（松弛生效）', () => {
  const rSnap = m.fitTrajectory(
    [
      { p: [0, 0, 0], dir: [1, 0, 0] },
      { p: [5, 3, 0] },
      { p: [10, 0, 0], dir: [1, 0, 0] },
    ],
    3,
    true,
  );
  const rSoft = m.fitTrajectory(
    [
      { p: [0, 0, 0], dir: [1, 0, 0] },
      { p: [5, 3, 0] },
      { p: [10, 0, 0], dir: [1, 0, 0] },
    ],
    3,
    false,
  );
  assert.ok(Math.abs(rSoft.samples[100][1] - 3) > 0.5, '软约束应明显偏离 y=3');
  assert.ok(Math.abs(rSnap.samples[100][1] - 3) < 1e-6);
});

check('弯曲档位改变曲线形状', () => {
  const knots = [
    { p: [0, 0, 0], dir: [0, 1, 0] },
    { p: [5, 0, 0] },
    { p: [10, 0, 0], dir: [0, 1, 0] },
  ];
  const low = m.fitTrajectory(knots, 1, true).samples[25];
  const high = m.fitTrajectory(knots, 5, true).samples[25];
  // 首段节点切线由射入点方向 [0,1,0] 给出，档位越高切线越长、拱起越大
  assert.ok(Math.abs(high[1]) > Math.abs(low[1]), `low=${low} high=${high}`);
  assert.ok(Math.abs(high[1]) > 0.01, `高档位应有明显拱起 high=${high}`);
});

// 3. OBB 线段相交：已知几何
check('segmentOBB 命中并返回区间', () => {
  const obb = {
    center: [0, 0, 0],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfExtents: [1, 1, 1],
  };
  const hit = m.segmentOBB([0, 0, -5], [0, 0, 5], obb);
  assert.ok(hit);
  const enter = hit.enterPoint[2];
  const exit = hit.exitPoint[2];
  assert.ok(Math.abs(enter - -1) < 1e-6 && Math.abs(exit - 1) < 1e-6, `${enter},${exit}`);
});

check('segmentOBB 旋转 45° 后正确判定', () => {
  const c = Math.SQRT1_2;
  const obb = {
    center: [0, 0, 0],
    axes: [
      [c, c, 0],
      [-c, c, 0],
      [0, 0, 1],
    ],
    halfExtents: [1, 1, 1],
  };
  // 沿 X 轴的线在旋转盒局部坐标下必然穿过
  assert.ok(m.segmentOBB([-5, 0, 0], [5, 0, 0], obb));
  // 平行于 Z 轴、x=3 的线不相交
  assert.equal(m.segmentOBB([3, 0, -5], [3, 0, 5], obb), null);
});

check('segmentOBB 未命中返回 null', () => {
  const obb = {
    center: [0, 0, 0],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfExtents: [1, 1, 1],
  };
  assert.equal(m.segmentOBB([5, 5, 0], [6, 6, 0], obb), null);
});

// 4. 哈希网格：宽相召回正确
check('HashGrid DDA 召回候选且不误报远处对象', () => {
  const obstacles = [
    { id: 'near', visible: true, position: [0, 0, 0], rotation: [0, 0, 0], halfExtents: [1, 1, 1] },
    { id: 'far', visible: true, position: [40, 40, 40], rotation: [0, 0, 0], halfExtents: [1, 1, 1] },
    { id: 'hidden', visible: false, position: [0, 0, 0], rotation: [0, 0, 0], halfExtents: [1, 1, 1] },
  ];
  const grid = new m.HashGrid(3);
  grid.build(obstacles, (o) => ({
    center: o.position,
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfExtents: o.halfExtents,
  }));
  const got = grid.querySegment([-2, 0, 0], [2, 0, 0]);
  assert.ok(got.has('near'));
  assert.ok(!got.has('far'));
  assert.ok(!got.has('hidden'));
});

// 5. 端到端遮挡：折线穿过盒子 -> 一段遮挡，区间与入/出点合理
check('computeOcclusions 识别穿盒区间', () => {
  const samples = [];
  for (let i = 0; i <= 200; i++) samples.push([-10 + (20 * i) / 200, 0, 0]);
  const obstacles = [
    { id: 'box1', name: '墙', visible: true, position: [0, 0, 0], rotation: [0, 0, 0], halfExtents: [1, 1, 1] },
  ];
  const grid = new m.HashGrid(3);
  const obbOf = (o) => ({
    center: o.position,
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfExtents: o.halfExtents,
  });
  grid.build(obstacles, obbOf);
  const segs = m.computeOcclusions(samples, obstacles, obbOf, grid);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].obstacleName, '墙');
  assert.ok(Math.abs(segs[0].tStart - 0.45) < 0.02, `tStart=${segs[0].tStart}`);
  assert.ok(Math.abs(segs[0].tEnd - 0.55) < 0.02, `tEnd=${segs[0].tEnd}`);
  assert.ok(Math.abs(segs[0].enterPosition[0] - -1) < 0.05);
  assert.ok(Math.abs(segs[0].exitPosition[0] - 1) < 0.05);
});

console.log(`\n数学层 ${passed} 项测试全部通过`);
