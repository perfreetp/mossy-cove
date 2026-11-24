import * as THREE from 'three';
import { BoneViewer } from './three/BoneViewer';
import {
  clearBusy,
  CATEGORY_COLORS,
  geometryObjects,
  getFragment,
  selectFragment,
  serializedGeometries,
  setBusy,
  store,
  toast,
} from './store';
import { loadFragmentFile, deserializeGeometry } from './lib/importFiles';
import { evaluateInterference } from './lib/manifold';
import { buildProjectFile, saveProjectLocally } from './lib/storage';
import {
  applyPoseToObject3D,
  downloadJson,
  kabsch,
  poseFromObject3D,
  rms,
  uid,
} from './lib/utils';
import type {
  AssemblyGroup,
  FragmentRecord,
  PoseReport,
  ProjectFile,
  Vec3Tuple,
} from './types';

let viewer: BoneViewer | null = null;
let saveTimer: number | null = null;

export function setViewer(instance: BoneViewer | null): void {
  viewer = instance;
}

export function getViewer(): BoneViewer | null {
  return viewer;
}

export function scheduleSave(delay = 700): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  store.saveState = 'saving';
  saveTimer = window.setTimeout(() => {
    void persistNow();
  }, delay);
}

export async function persistNow(): Promise<void> {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!store.fragments.length) {
    store.saveState = 'idle';
    return;
  }
  try {
    syncPosesFromViewer();
    await saveProjectLocally();
  } catch (error) {
    console.error(error);
    store.saveState = 'error';
    toast('本地保存失败：浏览器存储空间可能不足', 'error', 5000);
  }
}

export function syncPosesFromViewer(): void {
  if (!viewer) return;
  for (const group of store.groups) {
    const object = viewer.getGroupObject(group.id);
    if (!object) continue;
    const nextPose = poseFromObject3D(object);
    if (!poseAlmostEqual(group.pose, nextPose)) group.pose = nextPose;
  }
  for (const fragment of store.fragments) {
    const mesh = viewer.getMesh(fragment.id);
    if (!mesh) continue;
    const nextPose = poseFromObject3D(mesh);
    if (!poseAlmostEqual(fragment.pose, nextPose)) fragment.pose = nextPose;
  }
}

function poseAlmostEqual(a: FragmentRecord['pose'], b: FragmentRecord['pose'], epsilon = 1e-7): boolean {
  const arrays = [
    [a.position, b.position],
    [a.quaternion, b.quaternion],
    [a.scale, b.scale],
  ] as const;
  return arrays.every(([left, right]) =>
    left.every((value, index) => Math.abs(value - right[index]) <= epsilon),
  );
}

function identityPose() {
  return {
    position: [0, 0, 0] as Vec3Tuple,
    quaternion: [0, 0, 0, 1] as [number, number, number, number],
    scale: [1, 1, 1] as Vec3Tuple,
  };
}

function addLoadedGeometryToState(
  loaded: Awaited<ReturnType<typeof loadFragmentFile>>,
  options?: { code?: string; category?: FragmentRecord['category']; position?: Vec3Tuple; rotation?: Vec3Tuple },
): FragmentRecord {
  geometryObjects.set(loaded.geometryId, loaded.geometry);
  serializedGeometries.set(loaded.geometryId, loaded.serialized);

  const code = options?.code || loaded.suggestedCode || `F${String(store.fragments.length + 1).padStart(3, '0')}`;
  const category = options?.category ?? loaded.category;
  const record: FragmentRecord = {
    id: uid('frag'),
    code,
    name: `${code} · ${loaded.sourceName.replace(/\.[^.]+$/, '')}`,
    category,
    color: CATEGORY_COLORS[category] ?? '#7dd3fc',
    visible: true,
    opacity: 1,
    groupId: null,
    geometryId: loaded.geometryId,
    sourceName: loaded.sourceName,
    vertexCount: loaded.geometry.getAttribute('position').count,
    triangleCount: loaded.geometry.index ? loaded.geometry.index.count / 3 : 0,
    pose: identityPose(),
    createdAt: Date.now(),
  };

  if (options?.position) record.pose.position = options.position;
  if (options?.rotation) {
    const euler = new THREE.Euler(...options.rotation);
    record.pose.quaternion = new THREE.Quaternion().setFromEuler(euler).toArray() as [number, number, number, number];
  }

  store.fragments.push(record);
  const mesh = viewer?.addFragment(record.id, loaded.geometry, record.color, record.visible);
  if (mesh) applyPoseToObject3D(mesh, record.pose);
  return record;
}

export async function handleGeometryFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  setBusy(`正在导入 ${files.length} 个碎片…`);
  let imported = 0;
  const failures: string[] = [];
  try {
    for (const file of files) {
      try {
        const loaded = await loadFragmentFile(file);
        addLoadedGeometryToState(loaded);
        imported += 1;
      } catch (error) {
        console.error(file.name, error);
        failures.push(file.name);
      }
    }
    if (viewer && imported) {
      viewer.frameAll();
      viewer.setSelection(store.selectedIds);
    }
    if (imported) toast(`已导入并归类 ${imported} 块碎片`, 'success');
    if (failures.length) toast(`导入失败：${failures.join('、')}`, 'error', 6000);
    scheduleSave();
  } finally {
    clearBusy();
  }
}

export function loadDemoDataset(count: number): void {
  // Lazy import keeps initial bundle focused.
  void import('./lib/demo').then(({ createDemoSeeds }) => {
    setBusy(`生成 ${count} 块演示碎片…`);
    window.setTimeout(() => {
      try {
        const seeds = createDemoSeeds(count);
        for (const seed of seeds) {
          addLoadedGeometryToState(seed.loaded, {
            code: seed.code,
            category: seed.category,
            position: seed.position,
            rotation: seed.rotation,
          });
        }
        viewer?.frameAll();
        toast(`已载入 ${count} 块演示碎片，可选择两块开始配准`, 'success');
        scheduleSave();
      } finally {
        clearBusy();
      }
    }, 30);
  });
}

export function handleViewerSelect(fragmentId: string | null, additive: boolean): void {
  selectFragment(fragmentId, additive);
  viewer?.setSelection(store.selectedIds);
}

export function setTransformTool(tool: 'translate' | 'rotate'): void {
  store.tool = tool;
  viewer?.setTool(tool);
}

export function startPairPicking(): void {
  if (store.selectedIds.length !== 2) {
    toast('请先在左侧列表或三维视图中选择恰好两块碎片', 'warning');
    return;
  }
  const [aId, bId] = store.selectedIds;
  store.pickSession = { aId, bId, awaiting: 'a' };
  viewer?.setPickEnabled(true);
  viewer?.setSelection(store.selectedIds);
  toast('请点击第一块碎片 A 的断口特征点', 'info', 2600);
}

export function finishPairPicking(): void {
  store.pickSession = null;
  viewer?.setPickEnabled(false);
  if (viewer) viewer.setSelection(store.selectedIds);
  scheduleSave();
}

export function handleViewerPick(fragmentId: string, local: Vec3Tuple): void {
  const session = store.pickSession;
  if (!session) return;

  if (session.awaiting === 'a') {
    if (fragmentId !== session.aId) {
      toast(`第一个点必须取在 A（${getFragment(session.aId)?.code}）上`, 'warning');
      return;
    }
    session.aLocal = local;
    session.awaiting = 'b';
    toast('A 点已记录，请点击 B 上的对应特征点', 'info', 2200);
    return;
  }

  if (fragmentId !== session.bId) {
    toast(`第二个点必须取在 B（${getFragment(session.bId)?.code}）上`, 'warning');
    return;
  }
  if (!session.aLocal) return;

  store.pairs.push({
    id: uid('pair'),
    aId: session.aId,
    bId: session.bId,
    aLocal: session.aLocal,
    bLocal: local,
    createdAt: Date.now(),
  });
  session.aLocal = undefined;
  session.awaiting = 'a';
  viewer?.renderPairs(store.pairs);
  scheduleSave(250);
  toast(`已添加第 ${store.pairs.length} 组对应点`, 'success', 1600);
}

export function removePair(pairId: string): void {
  const index = store.pairs.findIndex((p) => p.id === pairId);
  if (index >= 0) store.pairs.splice(index, 1);
  viewer?.renderPairs(store.pairs);
  scheduleSave();
}

export function deleteFragment(fragmentId: string): void {
  const index = store.fragments.findIndex((fragment) => fragment.id === fragmentId);
  if (index < 0) return;
  const fragment = store.fragments[index];

  if (fragment.groupId) {
    const groupId = fragment.groupId;
    const group = store.groups.find((item) => item.id === groupId);
    viewer?.splitGroup(groupId);
    for (const member of store.fragments) {
      if (member.groupId === groupId) member.groupId = null;
    }
    const groupIndex = store.groups.findIndex((item) => item.id === groupId);
    if (groupIndex >= 0) store.groups.splice(groupIndex, 1);
    if (group) toast(`成员已删除，${group.name} 已解散`, 'info');
  }

  viewer?.removeFragment(fragmentId);
  store.fragments.splice(index, 1);
  store.pairs = store.pairs.filter((pair) => pair.aId !== fragmentId && pair.bId !== fragmentId);
  geometryObjects.delete(fragment.geometryId);
  serializedGeometries.delete(fragment.geometryId);

  store.selectedIds = store.selectedIds.filter((id) => id !== fragmentId);
  if (store.activeFragmentId === fragmentId) {
    store.activeFragmentId = store.selectedIds.at(-1) ?? null;
  }
  viewer?.setSelection(store.selectedIds);
  viewer?.renderPairs(store.pairs);
  scheduleSave();
}

export async function registerSelectedPair(): Promise<void> {
  if (!viewer) return;
  const [aId, bId] = store.selectedIds;
  if (!aId || !bId) {
    toast('请先选择两块碎片', 'warning');
    return;
  }
  const fragmentA = getFragment(aId);
  const fragmentB = getFragment(bId);
  if (fragmentA?.groupId || fragmentB?.groupId) {
    toast('其中至少一块已在拼接组中；如需重新配准，请先拆分拼接组', 'warning', 5200);
    return;
  }

  const relevant = store.pairs.filter(
    (pair) =>
      (pair.aId === aId && pair.bId === bId) ||
      (pair.aId === bId && pair.bId === aId),
  );
  if (relevant.length < 3) {
    toast(`刚性粗配准至少需要 3 组对应点，当前为 ${relevant.length} 组`, 'warning', 5000);
    return;
  }

  setBusy('正在用 Kabsch/SVD 计算刚体变换…');
  try {
    const source: Vec3Tuple[] = [];
    const target: Vec3Tuple[] = [];
    for (const pair of relevant) {
      if (pair.aId === aId && pair.bId === bId) {
        target.push(pair.aLocal);
        source.push(pair.bLocal);
      } else {
        // Stored direction is B -> A_selected, so swap endpoints.
        target.push(pair.bLocal);
        source.push(pair.aLocal);
      }
    }

    const localTransform = kabsch(source, target);
    const aWorld = viewer.getFragmentWorldMatrix(aId);
    const desiredBWorld = aWorld.clone().multiply(localTransform);
    viewer.setFragmentWorldMatrix(bId, desiredBWorld);
    viewer.getMesh(aId)?.updateWorldMatrix(true, false);
    viewer.getMesh(bId)?.updateWorldMatrix(true, false);

    const residuals = relevant.map((pair, index) => {
      const targetLocal = target[index];
      const sourceLocal = source[index];
      const meshA = viewer!.getMesh(aId)!;
      const meshB = viewer!.getMesh(bId)!;
      const aWorldPoint = meshA.localToWorld(new THREE.Vector3(...targetLocal));
      const bWorldPoint = meshB.localToWorld(new THREE.Vector3(...sourceLocal));
      const delta = bWorldPoint.clone().sub(aWorldPoint);
      const distance = delta.length();
      return {
        pairId: pair.id,
        distance,
        aWorld: aWorldPoint.toArray() as Vec3Tuple,
        bAlignedWorld: bWorldPoint.toArray() as Vec3Tuple,
        direction: (distance > 1e-9 ? delta.normalize() : new THREE.Vector3(0, 1, 0)).toArray() as Vec3Tuple,
        overThreshold: distance > store.settings.residualThreshold,
      };
    });

    const distances = residuals.map((r) => r.distance);
    const report = {
      aId,
      bId,
      pairCount: relevant.length,
      rms: rms(distances),
      maxResidual: Math.max(...distances),
      meanResidual: distances.reduce((a, b) => a + b, 0) / distances.length,
      threshold: store.settings.residualThreshold,
      acceptable: rms(distances) <= store.settings.residualThreshold,
      residuals,
      evaluatedAt: Date.now(),
    };
    store.report = report;
    viewer.showRegistration(report, store.settings.deviationArrows);
    syncPosesFromViewer();
    scheduleSave();

    if (report.acceptable) {
      toast(`粗配准完成：RMS ${report.rms.toFixed(3)}，低于阈值`, 'success');
    } else {
      toast(`配准残差超限：RMS ${report.rms.toFixed(3)}，红色箭头为偏差方向`, 'warning', 5200);
    }
  } catch (error) {
    console.error(error);
    toast(error instanceof Error ? error.message : '配准计算失败', 'error', 5000);
  } finally {
    clearBusy();
  }
}

export async function lockSelectedPair(): Promise<void> {
  if (!viewer) return;
  const [aId, bId] = store.selectedIds;
  const fragmentA = getFragment(aId);
  const fragmentB = getFragment(bId);
  if (!fragmentA || !fragmentB) {
    toast('请选择恰好两块碎片后再锁定', 'warning');
    return;
  }
  if (fragmentA.groupId && fragmentA.groupId === fragmentB.groupId) {
    toast('这两块碎片已经在同一拼接组中', 'info');
    return;
  }
  if (fragmentA.groupId || fragmentB.groupId) {
    toast('其中一块已属于拼接组；请先拆分该组，或锁定未分组的两块', 'warning', 5200);
    return;
  }

  setBusy('Manifold 正在执行实体布尔与穿插判定…');
  try {
    const meshA = viewer.getMesh(aId);
    const meshB = viewer.getMesh(bId);
    if (!meshA || !meshB) throw new Error('三维对象尚未准备好');
    meshA.updateWorldMatrix(true, false);
    meshB.updateWorldMatrix(true, false);

    const result = await evaluateInterference(
      meshA.geometry,
      meshA.matrixWorld.clone(),
      meshB.geometry,
      meshB.matrixWorld.clone(),
      store.settings.overlapRatioLimit,
      store.settings.gapSearchLength,
    );

    const interference = {
      aId,
      bId,
      evaluatedAt: Date.now(),
      ...result.report,
    };
    store.interference = interference;
    viewer.showIntersectionGeometry(result.intersectionGeometry ?? null);

    if (result.report.blocking) {
      toast(result.report.message, 'error', 6500);
      return;
    }

    const group: AssemblyGroup = {
      id: uid('grp'),
      name: `拼接组 ${store.groups.length + 1}`,
      color: '#34d399',
      memberIds: [aId, bId],
      pose: identityPose(),
      lockedAt: Date.now(),
    };
    store.groups.push(group);
    viewer.upsertGroup(group, true);
    fragmentA.groupId = group.id;
    fragmentB.groupId = group.id;
    syncPosesFromViewer();
    viewer.setSelection([aId, bId]);
    toast(`已锁定为 ${group.name}，之后拖动任意成员都会整组联动`, 'success', 4200);
    scheduleSave();
  } catch (error) {
    console.error(error);
    toast('锁定前接触判定失败', 'error');
  } finally {
    clearBusy();
  }
}

export function splitAssemblyGroup(groupId: string): void {
  if (!viewer) return;
  const group = store.groups.find((g) => g.id === groupId);
  if (!group) return;
  const memberIds = [...group.memberIds];
  viewer.splitGroup(groupId);
  for (const fragment of store.fragments) {
    if (fragment.groupId === groupId) fragment.groupId = null;
  }
  const index = store.groups.findIndex((g) => g.id === groupId);
  if (index >= 0) store.groups.splice(index, 1);
  store.selectedIds = memberIds.slice(0, 2);
  store.activeFragmentId = memberIds[0] ?? null;
  viewer.setSelection(store.selectedIds);
  syncPosesFromViewer();
  toast('拼接组已拆分，碎片恢复为独立刚体', 'success');
  scheduleSave();
}

export function alignToReferenceAxis(target: Vec3Tuple): void {
  if (!viewer) return;
  const referenceId = store.activeFragmentId ?? store.selectedIds[0];
  if (!referenceId) {
    toast('请先选择一块用于提取参考轴线的骨骼/碎片', 'warning');
    return;
  }
  try {
    const before = viewer.getPrincipalAxis(referenceId);
    viewer.showReferenceAxis(before.origin, before.axis);
    viewer.alignAllToAxis(before.axis, new THREE.Vector3(...target));
    const after = viewer.getPrincipalAxis(referenceId);
    viewer.showReferenceAxis(after.origin, after.axis);
    syncPosesFromViewer();
    scheduleSave();
    toast('已按参考骨骼 PCA 主轴线完成整体校正', 'success');
  } catch (error) {
    console.error(error);
    toast('轴线校正失败', 'error');
  }
}

export function updateViewerSettings(): void {
  if (!viewer) return;
  viewer.setGridVisible(store.settings.showGrid);
  viewer.setAxesVisible(store.settings.showAxes);
  if (store.report) {
    store.report.threshold = store.settings.residualThreshold;
    for (const residual of store.report.residuals) {
      residual.overThreshold = residual.distance > store.settings.residualThreshold;
    }
    store.report.acceptable = store.report.rms <= store.settings.residualThreshold;
  }
  viewer.showRegistration(store.report, store.settings.deviationArrows);
}

export async function loadProjectData(data: ProjectFile): Promise<void> {
  if (!viewer) throw new Error('三维视图尚未初始化');
  if (data.app !== 'bone-fragment-reassembly') throw new Error('不是有效的骨鉴项目文件');

  viewer.clearAll();
  resetControllerState();

  store.projectName = data.projectName ?? store.projectName;
  Object.assign(store.settings, data.settings ?? {});
  store.fragments.push(...data.fragments);
  store.groups.push(...(data.groups ?? []));
  store.pairs.push(...(data.pairs ?? []));
  store.report = data.lastRegistration ?? null;

  for (const serialized of data.geometries ?? []) {
    serializedGeometries.set(serialized.geometryId, serialized);
    geometryObjects.set(serialized.geometryId, deserializeGeometry(serialized));
  }

  for (const group of store.groups) viewer.upsertGroup(group);
  for (const fragment of store.fragments) {
    const geometry = geometryObjects.get(fragment.geometryId);
    if (!geometry) {
      console.warn('缺少几何数据', fragment.id);
      continue;
    }
    const mesh = viewer.addFragment(fragment.id, geometry, fragment.color, fragment.visible);
    if (fragment.groupId && store.groups.some((g) => g.id === fragment.groupId)) {
      viewer.attachFragmentToGroup(fragment.id, fragment.groupId);
    }
    applyPoseToObject3D(mesh, fragment.pose);
    viewer.setFragmentOpacity(fragment.id, fragment.opacity ?? 1);
  }

  viewer.setGridVisible(store.settings.showGrid);
  viewer.setAxesVisible(store.settings.showAxes);
  viewer.frameAll();
  viewer.renderPairs(store.pairs);
  viewer.showRegistration(store.report, store.settings.deviationArrows);
  viewer.setSelection([]);
  scheduleSave(300);
}

function resetControllerState(): void {
  store.fragments.splice(0, store.fragments.length);
  store.groups.splice(0, store.groups.length);
  store.pairs.splice(0, store.pairs.length);
  store.selectedIds = [];
  store.activeFragmentId = null;
  store.pickSession = null;
  store.report = null;
  store.interference = null;
  geometryObjects.clear();
  serializedGeometries.clear();
}

export async function importProjectFile(file: File): Promise<void> {
  try {
    const data = JSON.parse(await file.text()) as ProjectFile;
    await loadProjectData(data);
    toast('分享项目已导入，几何、位姿和拼接组均已恢复', 'success', 4200);
  } catch (error) {
    console.error(error);
    toast(error instanceof Error ? error.message : '项目文件解析失败', 'error', 6000);
  }
}

export function exportFullProject(): void {
  syncPosesFromViewer();
  const data = buildProjectFile();
  const safeName = store.projectName.replace(/[\\/:*?"<>|]/g, '_') || 'bone-reassembly';
  downloadJson(data, `${safeName}.bonepack.json`);
  toast('完整项目包已导出，可分享给其他浏览器导入', 'success');
}

export function exportPoseReport(): void {
  if (!viewer) return;
  if (!store.fragments.length) {
    toast('当前没有可导出的碎片', 'warning');
    return;
  }
  syncPosesFromViewer();

  const fragments: PoseReport['fragments'] = store.fragments.map((fragment) => {
    const mesh = viewer!.getMesh(fragment.id);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrixWorld = new THREE.Matrix4();
    if (mesh) {
      mesh.updateWorldMatrix(true, false);
      mesh.getWorldPosition(position);
      mesh.getWorldQuaternion(quaternion);
      mesh.getWorldScale(scale);
      matrixWorld.copy(mesh.matrixWorld);
    }
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
    return {
      id: fragment.id,
      code: fragment.code,
      name: fragment.name,
      category: fragment.category,
      groupId: fragment.groupId,
      position: position.toArray() as Vec3Tuple,
      quaternion: quaternion.toArray() as [number, number, number, number],
      eulerDegrees: [
        THREE.MathUtils.radToDeg(euler.x),
        THREE.MathUtils.radToDeg(euler.y),
        THREE.MathUtils.radToDeg(euler.z),
      ] as Vec3Tuple,
      scale: scale.toArray() as Vec3Tuple,
      matrixWorld: matrixWorld.elements.map((v) => Number(v.toFixed(8))),
    };
  });

  const report: PoseReport = {
    app: 'bone-fragment-reassembly',
    reportType: 'final-poses-and-groups',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    coordinateConvention: 'Three.js right-handed, Y-up',
    projectName: store.projectName,
    fragments,
    groups: store.groups.map((group) => ({
      ...(JSON.parse(JSON.stringify(group)) as AssemblyGroup),
      memberCodes: group.memberIds.map((id) => getFragment(id)?.code ?? id),
    })),
    registration: store.report,
    interference: store.interference,
  };
  const safeName = store.projectName.replace(/[\\/:*?"<>|]/g, '_') || 'bone-reassembly';
  downloadJson(report, `${safeName}-poses-groups.json`);
  toast('最终位姿与拼接组结构 JSON 已导出', 'success');
}

export async function newProject(): Promise<void> {
  viewer?.clearAll();
  resetControllerState();
  store.projectName = '未命名骨骼拼接案';
  store.settings = {
    residualThreshold: 1.0,
    overlapRatioLimit: 0.005,
    gapSearchLength: 20,
    showGrid: true,
    showAxes: true,
    deviationArrows: true,
  };
  const { clearLocalProject } = await import('./lib/storage');
  await clearLocalProject();
  toast('已新建空白项目并清除本机自动存档', 'success');
}
