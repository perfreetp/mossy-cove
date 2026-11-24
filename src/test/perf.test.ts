// 性能基准：200+ 骨骼下 FK 重算与查找的单帧耗时
import { computeFK, findNearestSlot, collectOccupied } from '../lib/kinematics';
import { buildDemoSkeleton } from '../lib/demoSkeleton';
import { templateByKey } from '../lib/catalog';
import * as THREE from 'three';

const demo = buildDemoSkeleton();
console.log(`骨骼数量：${demo.bones.length}`);

// 预热
computeFK(demo);

const N = 200;
let fkTotal = 0;
let slotTotal = 0;
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const fk = computeFK(demo);
  fkTotal += performance.now() - t0;

  const t1 = performance.now();
  const occupied = collectOccupied(demo.bones);
  findNearestSlot(fk, templateByKey('rib:L'), new THREE.Vector3(0.2, 2, 0), occupied);
  slotTotal += performance.now() - t1;
}
console.log(`computeFK 平均耗时：${(fkTotal / N).toFixed(3)} ms/帧`);
console.log(`插槽查询平均耗时：${(slotTotal / N).toFixed(3)} ms/次`);
console.log(`每帧 FK + 查询合计：${((fkTotal + slotTotal) / N).toFixed(3)} ms（60fps 预算 16.7ms）`);

// 模拟拖动时连续 60 帧重算的最坏情况（每帧旋转都触发全量 FK）
const t0 = performance.now();
for (let i = 0; i < 60; i++) {
  demo.bones[10].rotation[0] += 0.002;
  computeFK(demo);
}
const elapsed = performance.now() - t0;
console.log(`连续 60 帧 FK 重算总耗时：${elapsed.toFixed(1)} ms，平均 ${(elapsed / 60).toFixed(3)} ms/帧`);

if (fkTotal / N > 8) {
  console.error('性能未达标：FK 单帧超过 8ms');
  (globalThis as { process?: { exit: (c: number) => void } }).process?.exit(1);
}
console.log('性能基准通过');
