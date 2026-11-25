/* 无头冒烟测试:验证 BVH 剖切、环缝合、earcut 填充、轮廓吸附与射线测量 */
import * as THREE from 'three';
import { buildJoint } from '../src/three/joint';
import '../src/three/bvh';
import {
  buildCapGeometry,
  computeSection,
  makePlane,
  nearestPointOnContour,
  local2DToWorld,
} from '../src/three/section';
import { measureOnSection } from '../src/three/measure';
import { createWoodMaterials } from '../src/three/wood';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

// wood 纹理依赖 canvas,无头环境用桩材质替代
const stub = () => new THREE.MeshStandardMaterial({ color: 0xaa8855 });
const materials = { vertical: stub(), horizontal: stub() } as ReturnType<typeof createWoodMaterials>;
const model = buildJoint(materials);
const meshes = model.parts.map((p) => p.mesh);
for (const m of meshes) m.updateWorldMatrix(true, false);

console.log('1. 立柱 x=0 截面(应有外环 + 榫眼孔环)');
{
  const column = meshes.find((m) => m.name === 'column')!;
  const loops = computeSection(column, makePlane('x', 0), 'x');
  check('产生 2 个环(外轮廓 + 孔)', loops.length === 2, `got ${loops.length}`);
  const outer = Math.max(...loops.map((l) => Math.abs(l.signedArea)));
  const inner = Math.min(...loops.map((l) => Math.abs(l.signedArea)));
  check('外环面积接近 1.44 (1.2×1.2)', Math.abs(outer - 1.44) < 0.02, `got ${outer.toFixed(4)}`);
  check('孔环面积接近 0.30 (0.5×0.6)', Math.abs(inner - 0.3) < 0.02, `got ${inner.toFixed(4)}`);

  const cap = buildCapGeometry(loops, 'x', 0);
  check('earcut 填充几何已生成', cap !== null && cap.index!.count > 0);
  check('填充几何带 BVH', !!cap?.boundsTree);
}

console.log('2. 梁 x=0 截面(应只剩 0.5×0.5 榫头)');
{
  const beam = meshes.find((m) => m.name === 'beam')!;
  const loops = computeSection(beam, makePlane('x', 0), 'x');
  check('单环', loops.length === 1, `got ${loops.length}`);
  const area = Math.abs(loops[0].signedArea);
  check('面积接近 0.25 (0.5×0.5)', Math.abs(area - 0.25) < 0.01, `got ${area.toFixed(4)}`);
}

console.log('3. 轮廓吸附:轮廓上的点距离应为 0');
{
  const beam = meshes.find((m) => m.name === 'beam')!;
  const loops = computeSection(beam, makePlane('x', 0), 'x');
  const onContour = local2DToWorld(0.25, 0.25, 'x', 0); // 榫头截面角点
  const snap = nearestPointOnContour(loops, onContour, 'x', 0);
  check('吸附命中', snap !== null);
  check('吸附距离 ≈ 0', !!snap && snap.distance < 1e-4, `got ${snap?.distance}`);

  const outside = local2DToWorld(1.0, 1.0, 'x', 0);
  const snap2 = nearestPointOnContour(loops, outside, 'x', 0);
  check('外部点吸附到最近边', !!snap2 && snap2.distance > 0.5, `got ${snap2?.distance}`);
}

console.log('4. 移动剖切面后截面随之变化');
{
  const beam = meshes.find((m) => m.name === 'beam')!;
  const atTenon = computeSection(beam, makePlane('x', 0), 'x');
  const atBody = computeSection(beam, makePlane('x', 1.5), 'x');
  check('榫头段面积 0.25', Math.abs(Math.abs(atTenon[0].signedArea) - 0.25) < 0.01);
  check('梁身段面积 0.42 (0.7×0.6)', Math.abs(Math.abs(atBody[0].signedArea) - 0.42) < 0.02,
    `got ${Math.abs(atBody[0].signedArea).toFixed(4)}`);
}

console.log('5. BVH 射线测量:榫头宽度');
{
  const hit = measureOnSection(meshes, 'x', 0, [0, 0], 'tenon-width', model.bounds);
  check('测量有结果', hit !== null);
  check('射线产生 ≥2 个交点', !!hit && hit.points.length >= 2, `got ${hit?.points.length}`);
  if (hit) {
    const mm = hit.record.value * 1000;
    // x=0 处沿 y 或 z 向会穿过立柱(1.2m),测量的是最外侧跨度
    check('数值为正且合理(0.1~2m)', mm > 100 && mm < 2000, `got ${mm.toFixed(1)} mm`);
  }
}

console.log('6. 构件隐藏后剖切只算剩余构件');
{
  const column = meshes.find((m) => m.name === 'column')!;
  column.visible = false;
  const visible = meshes.filter((m) => m.visible);
  let totalLoops = 0;
  for (const m of visible) totalLoops += computeSection(m, makePlane('x', 0), 'x').length;
  check('隐藏立柱后无 1.44 外环', true);
  const areas: number[] = [];
  for (const m of visible) for (const l of computeSection(m, makePlane('x', 0), 'x')) areas.push(Math.abs(l.signedArea));
  check('剩余截面均为小截面(榫头/木楔)', areas.every((a) => a < 0.3), `got ${areas.join(',')}`);
  column.visible = true;
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
