/**
 * 纯逻辑冒烟测试（不依赖浏览器/DOM）：
 * node --import tsx scripts/smoke.mjs  —— 直接用 vite 的 esbuild 转译即可，
 * 这里改为动态 import 编译后的 ts 不现实，因此用 node 的实验性 strip-types。
 */
import assert from 'node:assert/strict';

// Node 26 支持 --experimental-strip-types，直接引入 TS 源文件
const { TerrainModel, DEFAULT_TERRAIN_PARAMS, BRUSH_MAP_SIZE } = await import(
  '../src/lib/noise.ts'
);
const {
  distributeCloudsAlongRidges,
  resolveCloudSeparation,
  clearanceFromHeight,
  refreshCloudDerived
} = await import('../src/lib/clouds.ts');
const { HistoryStack } = await import('../src/lib/history.ts');
const { LIGHTING_PRESETS } = await import('../src/lib/lighting.ts');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 1. 地形高度场确定性
test('地形噪声在相同种子下确定性生成', () => {
  const a = new TerrainModel({ ...DEFAULT_TERRAIN_PARAMS });
  const b = new TerrainModel({ ...DEFAULT_TERRAIN_PARAMS });
  assert.equal(a.baseHeights.length, 193 * 193);
  for (let i = 0; i < a.baseHeights.length; i += 997) {
    assert.ok(Math.abs(a.baseHeights[i] - b.baseHeights[i]) < 1e-9);
  }
  assert.ok(a.baseHeights.some((h) => h !== 0), '高度场不应全为零');
});

// 2. 参数响应范围
test('山脊起伏参数显著影响高度落差', () => {
  const low = new TerrainModel({ ...DEFAULT_TERRAIN_PARAMS, relief: 0.05 });
  const high = new TerrainModel({ ...DEFAULT_TERRAIN_PARAMS, relief: 0.95 });
  const range = (m) => Math.max(...m.baseHeights) - Math.min(...m.baseHeights);
  assert.ok(range(high) > range(low) * 1.5, `高起伏落差 ${range(high)} 应大于低起伏 ${range(low)}`);
});

// 3. 云团山脊分布
test('云团沿山脊分布且满足数量与最小间距', () => {
  const terrain = new TerrainModel({ ...DEFAULT_TERRAIN_PARAMS });
  const blobs = distributeCloudsAlongRidges(terrain, 30, 42);
  assert.equal(blobs.length, 30);
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const d = Math.hypot(blobs[i].x - blobs[j].x, blobs[i].z - blobs[j].z);
      assert.ok(d >= 12.9, `云团间距 ${d} 小于 13`);
    }
    assert.ok([1, 2, 3].includes(blobs[i].density));
    assert.ok(blobs[i].id.startsWith('cloud-'));
  }
});

// 4. 拖拽最小间距约束
test('resolveCloudSeparation 强制云团最小间距', () => {
  const terrain = new TerrainModel({ ...DEFAULT_TERRAIN_PARAMS });
  const blobs = distributeCloudsAlongRidges(terrain, 8, 7);
  const target = blobs[0];
  // 选一个远离边界的邻居，保证推开后仍在世界范围内
  const neighbor =
    blobs
      .filter((b) => b.id !== target.id)
      .find((b) => Math.abs(b.x) < 60 && Math.abs(b.z) < 60) ?? blobs[2];
  const resolved = resolveCloudSeparation(blobs, target.id, neighbor.x + 2, neighbor.z);
  const dToNeighbor = Math.hypot(resolved.x - neighbor.x, resolved.z - neighbor.z);
  const minDist = (target.radius + neighbor.radius) * 0.55;
  assert.ok(dToNeighbor >= minDist - 1e-6, `推开后与邻居距离 ${dToNeighbor} 应 >= ${minDist}`);
  const bound = 110 - 4;
  assert.ok(Math.abs(resolved.x) <= bound && Math.abs(resolved.z) <= bound, '位置不应越出世界边界');
});

// 4b. 完全重叠时也能恢复有效位置
test('resolveCloudSeparation 处理完全重叠（零距离）', () => {
  const terrain = new TerrainModel({ ...DEFAULT_TERRAIN_PARAMS });
  const blobs = distributeCloudsAlongRidges(terrain, 5, 9);
  const target = blobs[0];
  const anchor = blobs[2];
  const resolved = resolveCloudSeparation(blobs, target.id, anchor.x, anchor.z);
  const minDist = (target.radius + anchor.radius) * 0.55;
  const d = Math.hypot(resolved.x - anchor.x, resolved.z - anchor.z);
  assert.ok(d >= minDist - 1e-6, `零重叠恢复后距离 ${d} 应 >= ${minDist}`);
});

// 4c. 边界邻居：间距优先于边界，保证不穿透相邻云团
test('resolveCloudSeparation 在边界处优先保证云团不重叠', () => {
  const terrain = new TerrainModel({ ...DEFAULT_TERRAIN_PARAMS });
  const blobs = distributeCloudsAlongRidges(terrain, 8, 7);
  const target = blobs[0];
  const neighbor = blobs[1]; // 位于 x≈96 的边界附近
  const resolved = resolveCloudSeparation(blobs, target.id, neighbor.x + 2, neighbor.z);
  const minDist = (target.radius + neighbor.radius) * 0.55;
  const d = Math.hypot(resolved.x - neighbor.x, resolved.z - neighbor.z);
  assert.ok(d >= minDist - 1e-6, `边界处距离 ${d} 应 >= ${minDist}，宁可临时越过边界也不重叠`);
});

// 5. 笔刷修改与高度合成
test('笔刷抬升后 heightAt 增大且影响范围受限', () => {
  const terrain = new TerrainModel({ ...DEFAULT_TERRAIN_PARAMS });
  const before = terrain.heightAt(0, 0);
  const patch = terrain.applyBrush(0, 0, 18, 8, 1);
  assert.ok(patch.indices.length > 0);
  assert.ok(patch.indices.every((i) => i >= 0 && i < BRUSH_MAP_SIZE * BRUSH_MAP_SIZE));
  const after = terrain.heightAt(0, 0);
  assert.ok(after > before, `抬升后 ${after} 应大于抬升前 ${before}`);
  // 笔刷半径外不受影响
  assert.ok(Math.abs(terrain.brushOffsetAt(95, 95)) < 1e-6, '远处不应有笔刷位移');
  assert.ok(Math.abs(terrain.brushOffsetAt(-95, -95)) < 1e-6);
});

// 6. 撤销重做
test('HistoryStack 覆盖 push/commit 两类动作语义', () => {
  const history = new HistoryStack();
  let value = 10;
  // push：立即执行 redo（参数滑杆类）
  history.push({ label: 'a', undo: () => (value = 10), redo: () => (value = 20) });
  assert.equal(value, 20);
  // commit：动作已在外部发生，仅入栈（拖拽/笔刷类）
  value = 30;
  history.commit({ label: 'b', undo: () => (value = 20), redo: () => (value = 30) });
  assert.equal(value, 30);
  history.undo();
  assert.equal(value, 20);
  history.undo();
  assert.equal(value, 10);
  assert.equal(history.canUndo(), false);
  history.redo();
  assert.equal(value, 20);
  history.redo();
  assert.equal(value, 30);
  assert.equal(history.canRedo(), false);
  // 新动作清空 redo 栈
  history.push({ label: 'c', undo: () => (value = 0), redo: () => (value = 40) });
  assert.equal(value, 40);
  assert.equal(history.canRedo(), false);
});

// 7. 贴合高度
test('云团 clearance 随高度档位与贴合程度单调变化', () => {
  const terrain = new TerrainModel({ ...DEFAULT_TERRAIN_PARAMS });
  const blobs = distributeCloudsAlongRidges(terrain, 4, 1);
  refreshCloudDerived(blobs, 0.2);
  const low = clearanceFromHeight(1, 0.2);
  const high = clearanceFromHeight(3, 0.2);
  assert.ok(high > low);
  const lifted = clearanceFromHeight(1, 0.9);
  assert.ok(lifted > low);
});

// 8. 光照预设完整性
test('三套光照预设字段完整且太阳高度角合理', () => {
  for (const id of ['dawn', 'noon', 'dusk']) {
    const p = LIGHTING_PRESETS[id];
    assert.ok(p.elevation > 0 && p.elevation < Math.PI / 2);
    assert.ok(p.sunIntensity > 0);
    assert.equal(p.cloudLit.length, 3);
  }
  assert.ok(LIGHTING_PRESETS.noon.elevation > LIGHTING_PRESETS.dawn.elevation);
});

console.log(`\n全部 ${passed} 项冒烟测试通过 ✔`);
