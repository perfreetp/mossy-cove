// 纯逻辑自测：角度钳制、镜像欧拉映射、FK 层级、最近插槽、镜像复制、撤销快照
import * as THREE from 'three';
import { clampRotation, mirrorEuler, DEG, makeBoneId, formatDeg } from '../lib/math3d';
import { computeFK, findNearestSlot, collectOccupied, descendantIds } from '../lib/kinematics';
import { mirrorSubtree, findMirrorPartner } from '../lib/mirror';
import { skeletonStore, emptyProject } from '../store/skeletonStore';
import { templateByKey } from '../lib/catalog';
import { buildDemoSkeleton } from '../lib/demoSkeleton';
import type { BoneInstance, ProjectData } from '../types';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}
function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

// ---------- 1. 角度钳制 ----------
{
  const limits = { x: [DEG(-30), DEG(45)] as [number, number], y: null, z: [DEG(-10), DEG(10)] as [number, number] };
  const r1 = clampRotation([DEG(90), DEG(200), DEG(-50)], limits);
  assert(approx(r1.value[0], DEG(45)), 'X 轴上极限钳制');
  assert(approx(r1.value[1], DEG(200)), 'Y 轴锁定不钳制');
  assert(approx(r1.value[2], DEG(-10)), 'Z 轴下极限钳制');
  assert(r1.hit.x && !r1.hit.y && r1.hit.z, '命中轴标记正确');
  const r2 = clampRotation([0, 0, 0], limits);
  assert(!r2.hit.x && !r2.hit.z, '范围内不产生命中');
  assert(formatDeg(Math.PI) === '-180.0', '角度格式化（π 归一化为 -180）');
  assert(formatDeg(DEG(45)) === '45.0', '角度格式化常规值');
}

// ---------- 2. 镜像欧拉的几何验证 ----------
{
  // 构造 L 侧骨骼层级：父插槽在 +x 方向，子骨带任意旋转
  const project: ProjectData = {
    version: 1,
    bones: [
      {
        id: 'parent:M#1', templateBaseId: 'dorsal', side: 'M',
        parentId: null, parentSlotId: null, localPos: [0, 0, 0], rotation: [0, 0, 0],
      },
      {
        id: 'rib:L#1', templateBaseId: 'rib', side: 'L',
        parentId: 'parent:M#1', parentSlotId: 'ribL',
        localPos: [0, 0, 0], rotation: [0.3, -0.5, 0.8],
      },
    ],
    rootTransform: { pos: [0, 0, 0], rot: [0, 0, 0] },
    settings: { groundSnap: false, clip: { enabled: false, pos: [0, 0, 0], normal: [1, 0, 0] } },
  };
  const fk = computeFK(project);
  const leftWorld = fk.map.get('rib:L#1')!.worldMatrix.clone();

  // 镜像副本
  const result = mirrorSubtree(project, 'rib:L#1');
  assert(result.bones.length === 1, '镜像生成 1 块骨骼');
  const mirrored = result.bones[0];
  assert(mirrored.side === 'R' && mirrored.parentSlotId === 'ribR', '镜像插槽映射 ribL→ribR');

  const project2: ProjectData = {
    ...project,
    bones: [...project.bones, mirrored],
  };
  const fk2 = computeFK(project2);
  const rightWorld = fk2.map.get(mirrored.id)!.worldMatrix;

  // 镜像对称的正确判据：R 模板几何顶点 = S·L几何顶点，
  // 故世界网格重合要求 rightJoint·S = S·leftJoint（对任意几何顶点成立）
  const S = new THREE.Matrix4().makeScale(-1, 1, 1);
  const lhs = rightWorld.clone().multiply(S);
  const rhs = S.clone().multiply(leftWorld);
  let diff = 0;
  const la = lhs.elements;
  const ra = rhs.elements;
  for (let i = 0; i < 16; i++) diff = Math.max(diff, Math.abs(la[i] - ra[i]));
  assert(diff < 1e-9, `镜像世界网格满足 rightJoint·S = S·leftJoint（误差 ${diff.toExponential(2)}）`);

  // 位置反射：x 相反，y/z 相同
  const lp = new THREE.Vector3().setFromMatrixPosition(leftWorld);
  const rp = new THREE.Vector3().setFromMatrixPosition(rightWorld);
  assert(approx(rp.x, -lp.x) && approx(rp.y, lp.y) && approx(rp.z, lp.z), '镜像位置 x 反射');
}

// ---------- 3. 镜像欧拉公式 (+x,-y,-z) 与实现一致（端到端层级验证结论） ----------
{
  const r: [number, number, number] = [0.25, -0.7, 1.1];
  const m = mirrorEuler(r);
  assert(approx(m[0], 0.25) && approx(m[1], 0.7) && approx(m[2], -1.1), 'mirrorEuler 公式 (+x,-y,-z)');
}

// ---------- 4. FK 脊柱链：上游旋转带动下游世界姿态 ----------
{
  const project: ProjectData = {
    version: 1,
    bones: [],
    rootTransform: { pos: [0, 0, 0], rot: [0, 0, 0] },
    settings: { groundSnap: false, clip: { enabled: false, pos: [0, 0, 0], normal: [1, 0, 0] } },
  };
  let parent: BoneInstance | null = null;
  for (let i = 0; i < 4; i++) {
    const b: BoneInstance = {
      id: `caudal:M#${i + 1}`, templateBaseId: 'caudal', side: 'M',
      parentId: parent ? parent.id : null,
      parentSlotId: parent ? 'next' : null,
      localPos: [0, 0, 0],
      rotation: [DEG(10), 0, 0],
    };
    project.bones.push(b);
    parent = b;
  }
  const fk1 = computeFK(project);
  const tip1 = fk1.map.get('caudal:M#4')!.worldPos.clone();

  project.bones[0].rotation = [DEG(30), 0, 0];
  const fk2 = computeFK(project);
  const tip2 = fk2.map.get('caudal:M#4')!.worldPos.clone();
  assert(tip1.distanceTo(tip2) > 0.05, '根椎旋转后尾尖位置发生联动变化');

  const desc = descendantIds(project.bones, 'caudal:M#1');
  assert(desc.length === 3 && desc.includes('caudal:M#4'), '后代收集正确');
}

// ---------- 5. 最近插槽查询与兼容性过滤 ----------
{
  const project: ProjectData = {
    version: 1,
    bones: [
      { id: 'skull:M#1', templateBaseId: 'skull', side: 'M', parentId: null, parentSlotId: null, localPos: [0, 0, 0], rotation: [0, 0, 0] },
    ],
    rootTransform: { pos: [0, 0, 0], rot: [0, 0, 0] },
    settings: { groundSnap: false, clip: { enabled: false, pos: [0, 0, 0], normal: [1, 0, 0] } },
  };
  const fk = computeFK(project);
  const occupied = collectOccupied(project.bones);
  const mandibleTpl = templateByKey('mandible:M');
  const hit = findNearestSlot(fk, mandibleTpl, new THREE.Vector3(0, -0.12, -0.15), occupied);
  assert(hit !== null && hit.slotId === 'jaw', '下颌吸附到 skull.jaw 插槽');

  const femurTpl = templateByKey('femur:L');
  const miss = findNearestSlot(fk, femurTpl, new THREE.Vector3(0, 0, 0), occupied);
  assert(miss === null, '不兼容模板（股骨）无法接入头骨插槽');
}

// ---------- 6. store 快照撤销：拖入/旋转/镜像/吸附类操作精确还原 ----------
{
  const store = skeletonStore;
  store.loadProject(emptyProject());
  const s0 = JSON.stringify(store.getProject());

  const b1 = store.addBone({ templateBaseId: 'skull', side: 'M', parentId: null, parentSlotId: null });
  const s1 = JSON.stringify(store.getProject());
  assert(store.getProject().bones.length === 1, '拖入后 1 块骨骼');

  store.setBoneRotation(b1.id, [0.4, 0.2, -0.1]);
  assert(store.getProject().bones[0].rotation[0] === 0.4, '角度写入');

  store.undo();
  assert(JSON.stringify(store.getProject()) === s1, '撤销角度输入精确还原');
  store.undo();
  assert(JSON.stringify(store.getProject()) === s0, '撤销拖入精确还原到空场景');
  store.redo();
  assert(store.getProject().bones.length === 1, '重做恢复拖入');

  // 连续交互的检查点机制
  store.beginInteraction();
  store.applyLiveRotation(b1.id, [0.9, 0, 0]);
  store.applyLiveRotation(b1.id, [1.2, 0, 0]);
  store.endInteraction(null); // 丢弃
  assert(store.getProject().bones[0].rotation[0] !== 1.2, '丢弃交互后状态回退');
  assert(store.getSnapshot().canUndo === true, '丢弃的交互不入历史');

  store.beginInteraction();
  store.applyLiveRotation(b1.id, [0.7, 0, 0]);
  store.endInteraction('旋转关节');
  assert(store.getProject().bones[0].rotation[0] === 0.7, '入账交互保留最终态');
  store.undo();
  assert(store.getProject().bones[0].rotation[0] !== 0.7, '撤销入账交互回到检查点');
}

// ---------- 7. 镜像伙伴查询与镜像同步 ----------
{
  const store = skeletonStore;
  store.loadProject(emptyProject());
  const parent = store.addBone({ templateBaseId: 'sacral', side: 'M', parentId: null, parentSlotId: null });
  const ilium = store.addBone({ templateBaseId: 'ilium', side: 'L', parentId: parent.id, parentSlotId: 'iliumL' });
  const res = mirrorSubtree(store.getProject(), ilium.id);
  store.addMirroredBones(res.bones, res.newRootId);
  const partner = findMirrorPartner(store.getProject(), ilium.id);
  assert(partner !== null && partner.side === 'R' && partner.parentSlotId === 'iliumR', '找到镜像伙伴');

  // 同步旋转：L 侧写入后 R 侧应满足 (+x,-y,-z)（角度取在髂骨极限内）
  store.setMirrorSync(true);
  store.setBoneRotation(ilium.id, [0.08, 0, 0.09]);
  const right = store.getProject().bones.find((b) => b.id === partner!.id)!;
  assert(
    approx(right.rotation[0], 0.08) && approx(right.rotation[1], 0) && approx(right.rotation[2], -0.09),
    '镜像同步旋转映射正确',
  );
}

// ---------- 8. id 生成与演示骨架规模 ----------
{
  assert(makeBoneId('femur', 'L', 3) === 'femur:L#3', 'id 生成格式');
  const demo = buildDemoSkeleton();
  assert(demo.bones.length > 200, `演示骨架超过 200 块（实际 ${demo.bones.length}）`);
  const ids = new Set(demo.bones.map((b) => b.id));
  assert(ids.size === demo.bones.length, '演示骨架 id 唯一');
  // 每个子骨骼的父级都存在
  const ok = demo.bones.every((b) => b.parentId === null || ids.has(b.parentId));
  assert(ok, '演示骨架所有父子引用有效');
}

console.log(`\n自测结果：${pass} 通过，${fail} 失败`);
if (fail > 0) {
  // eslint-disable-next-line no-undef
  (globalThis as { process?: { exit: (code: number) => void } }).process?.exit(1);
}
