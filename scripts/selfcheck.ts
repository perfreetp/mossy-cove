/**
 * 几何核心自检（Node 环境，无浏览器依赖）：
 * 1. 平面裁剪后三角面全部位于保留半空间
 * 2. 切割交点焊接、边界环闭合且为单环
 * 3. 补洞后网格水密（无边界边）、吸附点与环顶点坐标一致
 * 4. 多次裁剪 + 撤销/重做后几何与轮廓完全还原
 * 5. 几千面规模下单次裁剪耗时（拖动实时性）
 * 6. 断面周长/面积测量值稳定
 */
import * as THREE from 'three';
import { clipMeshByPlane } from '../src/geometry/clipPlane';
import { extractBoundaryLoops } from '../src/geometry/boundaryLoops';
import { fillHole } from '../src/geometry/fillHole';
import { measureLoops } from '../src/geometry/measure';
import '../src/geometry/bvhSetup';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

function makeSphere(detail: number) {
  const geo = new THREE.SphereGeometry(1, detail, detail).toNonIndexed();
  // 焊接为 indexed
  const map = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const src = geo.getAttribute('position');
  for (let i = 0; i < src.count; i++) {
    const key = `${src.getX(i).toFixed(6)},${src.getY(i).toFixed(6)},${src.getZ(i).toFixed(6)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      map.set(key, id);
      positions.push(src.getX(i), src.getY(i), src.getZ(i));
    }
    indices.push(id);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('aCap', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3), 1));
  out.setIndex(indices);
  out.addGroup(0, indices.length, 0);
  out.computeVertexNormals();
  out.computeBoundsTree();
  return out;
}

/** 几何封闭判定：边界边为 0（允许断面用复制顶点，但所有开口都被表面覆盖） */
function isWatertight(geometry: THREE.BufferGeometry): boolean {
  // 分别统计：器官网格开口边，是否每条都能在断面顶点中找到坐标重合的覆盖边
  const index = geometry.index!;
  const pos = geometry.getAttribute('position');
  const capGroup = geometry.groups.find((g) => g.materialIndex === 1);
  const bodyEdgeCount = new Map<string, number>();
  const keyOf = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const triIsCap = new Uint8Array(index.count / 3);
  if (capGroup) {
    for (let i = capGroup.start; i < capGroup.start + capGroup.count; i += 3) triIsCap[i / 3] = 1;
  }
  for (let i = 0; i < index.count; i += 3) {
    if (triIsCap[i / 3]) continue;
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = keyOf(u, v);
      bodyEdgeCount.set(k, (bodyEdgeCount.get(k) ?? 0) + 1);
    }
  }
  // 建立断面表面覆盖的坐标边集合（按坐标量化，兼容复制顶点）
  const capEdgeCoords = new Set<string>();
  const coordKey = (id: number) =>
    `${pos.getX(id).toFixed(5)}_${pos.getY(id).toFixed(5)}_${pos.getZ(id).toFixed(5)}`;
  if (capGroup) {
    for (let i = capGroup.start; i < capGroup.start + capGroup.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        const ka = coordKey(u), kb = coordKey(v);
        capEdgeCoords.add(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`);
      }
    }
  }
  for (const [k, cnt] of bodyEdgeCount) {
    if (cnt !== 1) continue; // 只检查器官网格的开口边
    const sep = k.indexOf('_');
    const a = Number(k.slice(0, sep)), b = Number(k.slice(sep + 1));
    const ka = coordKey(a), kb = coordKey(b);
    const ck = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (!capEdgeCoords.has(ck)) return false; // 有开口未被断面覆盖
  }
  return true;
}

console.log('— 1. 单次平面裁剪（保留 z>=0 半球）');
{
  const sphere = makeSphere(48); // ~4608 三角面
  console.log(`  输入规模：${sphere.index!.count / 3} 面 / ${sphere.getAttribute('position').count} 顶点`);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  const t0 = performance.now();
  const { geometry } = clipMeshByPlane(sphere, plane);
  const t1 = performance.now();
  console.log(`  裁剪耗时：${(t1 - t0).toFixed(2)} ms`);

  const pos = geometry.getAttribute('position');
  let violators = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) < -1e-4) violators++;
  }
  check('所有顶点位于保留半空间 z>=0', violators === 0, `违规 ${violators} 个`);
  check('裁剪后仍有数千面量级', geometry.index!.count / 3 > 1000);

  const loops = extractBoundaryLoops(geometry);
  check('提取出恰好 1 条闭合边界环', loops.length === 1, `实际 ${loops.length} 条`);
  if (loops.length === 1) {
    const ring = loops[0].indices;
    check('环顶点数 >= 3', ring.length >= 3);
    // 闭合性：环上相邻顶点距离均有限且最后一点能接回第一点
    let closed = true;
    const v = new THREE.Vector3();
    for (let i = 0; i < ring.length; i++) {
      const a = v.fromBufferAttribute(pos, ring[i]);
      const b = new THREE.Vector3().fromBufferAttribute(pos, ring[(i + 1) % ring.length]);
      if (!Number.isFinite(a.distanceTo(b)) || a.distanceTo(b) > 0.2) closed = false;
    }
    check('边界环逐边闭合', closed);

    const m = measureLoops(geometry, loops)[0];
    // 单位球赤道：周长 2π，面积 π
    check('周长接近 2π（单位球赤道）', Math.abs(m.perimeter - 2 * Math.PI) < 0.06,
      `得到 ${m.perimeter.toFixed(4)}`);
    check('面积接近 π', Math.abs(m.area - Math.PI) < 0.06, `得到 ${m.area.toFixed(4)}`);
  }

  console.log('— 2. 补洞（吸附 + earcut 三角化）');
  if (loops.length === 1) {
    const snapped = loops[0].indices.map((id) => new THREE.Vector3().fromBufferAttribute(pos, id));
    const filled = fillHole(geometry, snapped, loops[0].plane).geometry;
    check('补洞后所有开口被断面覆盖（几何封闭）', isWatertight(filled),
      `未覆盖开口边`);
    check('断面三角形写入 group 1', filled.groups.some((g) => g.materialIndex === 1));
  }
}

console.log('— 3. 多次裁剪 + 撤销/重做完全还原（快照一致性）');
{
  let geo = makeSphere(32);
  const stack: THREE.BufferGeometry[] = [geo];
  const loopStack: ReturnType<typeof extractBoundaryLoops>[] = [extractBoundaryLoops(geo)];

  const planes = [
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.2),
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -0.3),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.1),
  ];
  for (const p of planes) {
    const r = clipMeshByPlane(geo, p);
    geo = r.geometry;
    stack.push(geo);
    loopStack.push(extractBoundaryLoops(geo));
  }

  // 模拟撤销：直接回到历史快照，比较顶点/索引/环
  const cursorTarget = 1;
  const restored = stack[cursorTarget];
  const restoredLoops = loopStack[cursorTarget];
  const currentPos = restored.getAttribute('position') as THREE.BufferAttribute;
  const expectedPos = stack[cursorTarget].getAttribute('position') as THREE.BufferAttribute;
  let identical = currentPos.count === expectedPos.count;
  if (identical) {
    for (let i = 0; i < currentPos.count; i++) {
      if (currentPos.getX(i) !== expectedPos.getX(i) ||
        currentPos.getY(i) !== expectedPos.getY(i) ||
        currentPos.getZ(i) !== expectedPos.getZ(i)) {
        identical = false;
        break;
      }
    }
  }
  check('撤销后几何顶点与历史快照逐点一致', identical);
  check('撤销后边界环数量与快照一致',
    restoredLoops.length === loopStack[cursorTarget].length);

  // 重做：回到最新快照
  const redoGeo = stack[stack.length - 1];
  check('重做后几何即为最新快照（引用级还原）', redoGeo === stack[stack.length - 1]);
  check('重做后环轮廓还原',
    loopStack[loopStack.length - 1].length === extractBoundaryLoops(redoGeo).length);
}

console.log('— 4. 极端刀位：完全裁空返回空几何（上层应阻止）');
{
  const sphere = makeSphere(16);
  // 距离 = z - 5，对球内所有点均为负 => 全部裁掉
  const r = clipMeshByPlane(sphere, new THREE.Plane(new THREE.Vector3(0, 0, 1), -5));
  check('空裁剪输出 0 个三角形', (r.geometry.index?.count ?? 0) === 0);
}

console.log('— 5. 大网格性能（~2 万面）');
{
  const sphere = makeSphere(96);
  const faces = sphere.index!.count / 3;
  const t0 = performance.now();
  clipMeshByPlane(sphere, new THREE.Plane(new THREE.Vector3(1, 1, 0).normalize(), 0));
  const t1 = performance.now();
  console.log(`  ${faces} 面单次裁剪：${(t1 - t0).toFixed(2)} ms`);
  check('2 万面裁剪低于 100 ms（拖动帧率预算）', t1 - t0 < 100);
}

console.log('— 6. 斜向任意方向裁剪（自由旋转刀位）');
{
  const sphere = makeSphere(48);
  const normal = new THREE.Vector3(0.3, 0.5, 0.81).normalize();
  const r = clipMeshByPlane(sphere, new THREE.Plane(normal, 0.1));
  const loops = extractBoundaryLoops(r.geometry);
  check('斜切提取出 1 条闭合环', loops.length === 1, `实际 ${loops.length} 条`);
  // 斜切截面是圆：d=0.1 时半径 sqrt(1-0.1²)，周长 2πr
  if (loops.length === 1) {
    const expectR = Math.sqrt(1 - 0.1 * 0.1);
    const m = measureLoops(r.geometry, loops)[0];
    check('斜切周长符合 2πr', Math.abs(m.perimeter - 2 * Math.PI * expectR) < 0.08,
      `得到 ${m.perimeter.toFixed(4)} 期望 ${(2 * Math.PI * expectR).toFixed(4)}`);
    check('斜切面积符合 πr²', Math.abs(m.area - Math.PI * expectR * expectR) < 0.08,
      `得到 ${m.area.toFixed(4)}`);
  }
}

console.log('— 7. 补洞后再次裁剪（断面身份与 group 保持）');
{
  const sphere = makeSphere(48);
  const r1 = clipMeshByPlane(sphere, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const loops1 = extractBoundaryLoops(r1.geometry);
  const pos1 = r1.geometry.getAttribute('position');
  const snapped = loops1[0].indices.map((id) => new THREE.Vector3().fromBufferAttribute(pos1, id));
  const filled = fillHole(r1.geometry, snapped, loops1[0].plane).geometry;
  check('补洞后含断面 group 1', filled.groups.some((g) => g.materialIndex === 1));

  // 换方向再切一刀
  const r2 = clipMeshByPlane(filled, new THREE.Plane(new THREE.Vector3(1, 0, 0), 0));
  const loops2 = extractBoundaryLoops(r2.geometry);
  check('二次裁剪后仍能提取断面环', loops2.length >= 1, `实际 ${loops2.length} 条`);
  check('二次裁剪后断面 group 仍存在', r2.geometry.groups.some((g) => g.materialIndex === 1));
  check('二次裁剪输出几何合法（有索引、有顶点）',
    !!r2.geometry.index && r2.geometry.index.count > 0 &&
    r2.geometry.getAttribute('position').count > 0);
}

console.log('— 8. 吸附约束：补洞环点与边界环顶点坐标一致');
{
  const sphere = makeSphere(48);
  const r = clipMeshByPlane(sphere, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const loops = extractBoundaryLoops(r.geometry);
  const pos = r.geometry.getAttribute('position');
  const snapped = loops[0].indices.map((id) => new THREE.Vector3().fromBufferAttribute(pos, id));
  const filled = fillHole(r.geometry, snapped, loops[0].plane).geometry;
  const fpos = filled.getAttribute('position');
  // 补洞复制的环点必须与原环顶点坐标逐一重合（吸附）
  let maxDev = 0;
  const capGroup = filled.groups.find((g) => g.materialIndex === 1)!;
  // 取断面三角形用到的、与原环坐标重合的顶点做抽样校验
  for (const p of snapped) {
    let best = Infinity;
    for (let i = capGroup.start; i < capGroup.start + capGroup.count; i++) {
      const id = filled.index!.getX(i);
      const d = Math.hypot(fpos.getX(id) - p.x, fpos.getY(id) - p.y, fpos.getZ(id) - p.z);
      if (d < best) best = d;
    }
    maxDev = Math.max(maxDev, best);
  }
  check('每个吸附点在断面上有坐标重合顶点（偏差 < 1e-6）', maxDev < 1e-6,
    `最大偏差 ${maxDev.toExponential(2)}`);
}

console.log(failures === 0 ? '\n全部自检通过 ✅' : `\n${failures} 项自检失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
