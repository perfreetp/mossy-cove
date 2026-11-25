/* 纯 Node 逻辑自检：npx tsx scripts/sanity.ts */
import { Heightfield } from '../src/core/terrain';
import {
  countInstances,
  createInitialState,
  eraseAtDabs,
  resampleAll,
} from '../src/core/actions';
import { EditorStore } from '../src/core/store';
import { parseProjectFile, serializeProject } from '../src/core/project-io';
import { TERRAIN_RULES } from '../src/core/config';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

const hf = new Heightfield(20240517);
const state = createInitialState(hf);
const total = state.instances.length;
const c0 = countInstances(state);
console.log(`初始实例: ${total} (树 ${c0.trees} / 灌 ${c0.bushes})，区域 ${state.zones.length}`);
assert(total > 2000, `初始实例数量充足 (${total})`);

// 高度 / 坡度规则
let badTerrain = 0;
for (const i of state.instances) {
  if (
    i.h < TERRAIN_RULES.waterLevel - 0.02 ||
    i.h >= TERRAIN_RULES.maxHeight ||
    i.slope >= TERRAIN_RULES.maxSlope + 0.5
  ) {
    badTerrain++;
  }
}
assert(badTerrain === 0, `没有植株落在水下/极限高度/极限陡坡 (异常 ${badTerrain})`);

// 最小间距（同层）
function minPairDist(layer: 'trees' | 'bushes'): number {
  const pts = state.instances.filter((i) => i.layer === layer);
  let min = Infinity;
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      const d = Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
      if (d < min) min = d;
    }
  }
  return min;
}
const minTree = minPairDist('trees');
const minBush = minPairDist('bushes');
console.log(`  最小树间距 ${minTree.toFixed(1)} (要求 ≥ ${state.params.minSpacing})`);
console.log(`  最小灌间距 ${minBush.toFixed(1)} (要求 ≥ ${(state.params.minSpacing * 0.5).toFixed(1)})`);
assert(minTree + 0.01 >= state.params.minSpacing, '树木最小间距成立');
assert(minBush + 0.01 >= state.params.minSpacing * 0.5, '灌木最小间距成立');

// 密度档位应改变数量
const nNormal = state.instances.length;
state.params.density = 'dense';
resampleAll(state, hf);
const nDense = state.instances.length;
state.params.density = 'sparse';
resampleAll(state, hf);
const nSparse = state.instances.length;
console.log(`  稀疏 ${nSparse} / 标准 ${nNormal} / 密集 ${nDense}`);
assert(nDense > nNormal && nNormal > nSparse, '密度档位数量单调');
state.params.density = 'normal';
resampleAll(state, hf);

// 撤销重做 + 参数手势
const store = new EditorStore(state);
const beforeSpacing = store.state.params.minSpacing;
const beforeCount = store.state.instances.length;
store.beginGesture();
store.updateGesture((d) => {
  d.params.minSpacing = 38;
  resampleAll(d, hf);
});
store.commitGesture('调整散布参数');
assert(store.canUndo, '调参后可撤销');
assert(store.state.params.minSpacing === 38, '手势中参数已更新');
store.undo();
assert(store.state.params.minSpacing === beforeSpacing, '撤销恢复间距');
assert(store.state.instances.length === beforeCount, '撤销恢复实例集合');
store.redo();
assert(store.state.params.minSpacing === 38, '重做再次应用');
store.undo();

// 高度带
store.run('band test', (d) => {
  d.bandLow = 0.4;
  d.bandHigh = 0.6;
});
const cBand = countInstances(store.state);
assert(cBand.visible <= store.state.instances.length, '高度带统计可见数不超过总数');
assert(cBand.visible < store.state.instances.length, '窄高度带隐藏了部分实例');
store.undo();
assert(store.state.bandLow === 0 && store.state.bandHigh === 1, '撤销恢复高度带');

// 擦除 + 重撒保持擦除
const target = store.state.instances[0];
const erased = eraseAtDabs(store.state, [{ x: target.x, y: target.y, r: 60 }]);
assert(erased > 0, `笔刷擦除了实例 (${erased})`);
const aroundAfter = store.state.instances.filter(
  (i) => Math.hypot(i.x - target.x, i.y - target.y) <= 60,
).length;
assert(aroundAfter === 0, '笔刷范围内已清空');
store.state.strokes.push({
  id: 's1',
  dabs: [{ x: target.x, y: target.y, r: 60 }],
});
resampleAll(store.state, hf);
const aroundResample = store.state.instances.filter(
  (i) => Math.hypot(i.x - target.x, i.y - target.y) <= 58,
).length;
assert(aroundResample === 0, '重新散布后擦除掩码仍生效');

// 序列化往返
const json = serializeProject(store.state);
const restored = parseProjectFile(json);
assert(restored.instances.length === store.state.instances.length, '导出/导入实例数一致');
assert(restored.zones.length === store.state.zones.length, '导出/导入区域数一致');
assert(restored.params.minSpacing === store.state.params.minSpacing, '导出/导入参数一致');

// 性能：模拟拖动参数 30 次重撒
const t0 = performance.now();
for (let i = 0; i < 30; i++) {
  store.state.params.minSpacing = 14 + (i % 20);
  resampleAll(store.state, hf);
}
const dt = performance.now() - t0;
console.log(`  30 次全量重撒耗时 ${dt.toFixed(0)}ms，平均 ${(dt / 30).toFixed(1)}ms/次，实例 ${store.state.instances.length}`);
assert(dt / 30 < 60, `单次重撒足够快 (${(dt / 30).toFixed(1)}ms < 60ms)`);

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
