/**
 * 状态层端到端测试：模拟完整术前规划工作流
 * 导入 → 裁剪 → 补洞 → 微调 → 撤销/重做 → 多器官独立历史
 */
import * as THREE from 'three';
import { EditorStore } from '../src/state/editorStore';
import { measureLoops } from '../src/geometry/measure';
import '../src/geometry/bvhSetup';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

function makeSphere(detail: number) {
  const geo = new THREE.SphereGeometry(1, detail, detail).toNonIndexed();
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

console.log('— A. 单器官完整工作流');
{
  const store = new EditorStore();
  const id = store.addOrgan('肝脏', makeSphere(48));
  let s = store.getSummary();
  check('初始 1 个器官、1 条历史（导入）', s.organs.length === 1 && s.historyLabels.length === 1);
  check('初始无断面环', s.loopCount === 0);

  // 第一次裁剪
  store.updateClipPreview(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  check('拖动产生预览（未入栈）', store.isPreviewActive() && store.getSummary().historyLabels.length === 1);
  store.commitClip(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), 'Z 向裁剪');
  s = store.getSummary();
  check('提交后历史增加到 2 条', s.historyLabels.length === 2);
  check('提交后产生 1 条断面环', s.loopCount === 1);
  check('提交后预览清除', !s.previewActive);
  check('可撤销', s.canUndo && !s.canRedo);

  // 测量
  const geo = store.getPresentGeometry()!;
  const loops = store.getPresentLoops();
  const m = measureLoops(geo, loops);
  check('断面可测量周长/面积', m[0].perimeter > 0 && m[0].area > 0);

  // 补洞
  const pos = geo.getAttribute('position');
  const snapped = loops[0].indices.map((vid) => new THREE.Vector3().fromBufferAttribute(pos, vid));
  store.fillHole(snapped, loops[0].plane, '手动补洞');
  s = store.getSummary();
  check('补洞后历史 3 条', s.historyLabels.length === 3);

  // 顶点微调（移动断面内部 aCap=2 顶点）
  const capAttr = store.getPresentGeometry()!.getAttribute('aCap');
  let handleId = -1;
  for (let i = 0; i < capAttr.count; i++) {
    if (capAttr.getX(i) > 1.5) {
      handleId = i;
      break;
    }
  }
  check('补洞生成内部调整点', handleId >= 0);
  if (handleId >= 0) {
    const p = new THREE.Vector3().fromBufferAttribute(store.getPresentGeometry()!.getAttribute('position'), handleId);
    const before = p.toArray().join(',');
    store.moveCapVertex(handleId, p.add(new THREE.Vector3(0.05, 0, 0)));
    const after = new THREE.Vector3().fromBufferAttribute(store.getPresentGeometry()!.getAttribute('position'), handleId).toArray().join(',');
    check('顶点微调改变了坐标', before !== after);
  }

  // 撤销到底
  const labels = store.getSummary().historyLabels;
  for (let i = 0; i < labels.length - 1; i++) store.undo();
  s = store.getSummary();
  check('撤销到导入状态', s.cursor === 0 && !s.canUndo && s.canRedo);
  check('撤销后断面环清空', s.loopCount === 0);

  // 重做回最新
  for (let i = 0; i < labels.length - 1; i++) store.redo();
  s = store.getSummary();
  check('重做回到最新状态', s.cursor === labels.length - 1 && !s.canRedo);
  check('重做后断面环还原', s.loopCount === 1);
  const redoLoops = store.getPresentLoops();
  check('重做后环顶点数与补洞前一致', redoLoops.length === 1 && redoLoops[0].indices.length === loops[0].indices.length);
}

console.log('— B. 多器官独立历史');
{
  const store = new EditorStore();
  const liver = store.addOrgan('肝脏', makeSphere(32));
  const kidney = store.addOrgan('肾脏', makeSphere(24));
  check('两个器官', store.getSummary().organs.length === 2);

  // 肝脏裁剪两次
  store.setActiveOrgan(liver);
  store.commitClip(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), '肝裁剪1');
  store.commitClip(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), '肝裁剪2');
  check('肝脏 3 条历史', store.getSummary().historyLabels.length === 3);

  // 切到肾脏，历史应独立
  store.setActiveOrgan(kidney);
  const ks = store.getSummary();
  check('肾脏只有 1 条导入历史', ks.historyLabels.length === 1 && ks.cursor === 0);
  store.commitClip(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), '肾裁剪1');
  check('肾脏 2 条历史', store.getSummary().historyLabels.length === 2);

  // 回肝脏确认历史未受影响
  store.setActiveOrgan(liver);
  check('切回肝脏仍是 3 条历史', store.getSummary().historyLabels.length === 3 && store.getSummary().cursor === 2);

  // 肾脏撤销不影响肝脏
  store.setActiveOrgan(kidney);
  store.undo();
  check('肾脏撤销后 1 条', store.getSummary().cursor === 0);
  store.setActiveOrgan(liver);
  check('肝脏历史不受肾脏撤销影响', store.getSummary().cursor === 2);
}

console.log('— C. 撤销后新操作截断 redo 分支');
{
  const store = new EditorStore();
  store.addOrgan('器官', makeSphere(32));
  store.commitClip(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), '裁剪A');
  store.commitClip(new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), '裁剪B');
  store.undo(); // 回到 A
  check('撤销后可重做 B', store.getSummary().canRedo);
  store.commitClip(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), '裁剪C');
  const s = store.getSummary();
  check('新操作后 redo 被截断', !s.canRedo && s.historyLabels[s.historyLabels.length - 1] === '裁剪C');
  check('历史为 导入/A/C', s.historyLabels.join('/') === '导入模型/裁剪A/裁剪C');
}

console.log('— D. 空裁剪被阻止（不产生空快照）');
{
  const store = new EditorStore();
  store.addOrgan('器官', makeSphere(16));
  let threw = false;
  try {
    store.commitClip(new THREE.Plane(new THREE.Vector3(0, 0, 1), -5), '裁空');
  } catch {
    threw = true;
  }
  check('整模型裁空抛异常并阻止', threw);
  check('历史仍只有导入', store.getSummary().historyLabels.length === 1);
}

console.log('— E. 断面平移微调（以器官网格边界顶点为种子）');
{
  const store = new EditorStore();
  store.addOrgan('器官', makeSphere(48));
  store.commitClip(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), '裁剪');
  const loops = store.getPresentLoops();
  const geo = store.getPresentGeometry()!;
  const pos = geo.getAttribute('position');
  const snapped = loops[0].indices.map((vid) => new THREE.Vector3().fromBufferAttribute(pos, vid));
  store.fillHole(snapped, loops[0].plane, '补洞');

  // 用器官网格的边界环顶点（非断面复制顶点）作为平移种子
  const bodyBoundaryId = loops[0].indices[0];
  const capGroup = store.getPresentGeometry()!.groups.find((g) => g.materialIndex === 1)!;
  const beforeCapPos = (() => {
    const id = store.getPresentGeometry()!.index!.getX(capGroup.start);
    return new THREE.Vector3().fromBufferAttribute(store.getPresentGeometry()!.getAttribute('position'), id);
  })();
  store.translateCap(bodyBoundaryId, new THREE.Vector3(0, 0, 0.1), '断面平移');
  const afterCapPos = (() => {
    const id = store.getPresentGeometry()!.index!.getX(capGroup.start);
    return new THREE.Vector3().fromBufferAttribute(store.getPresentGeometry()!.getAttribute('position'), id);
  })();
  check('断面平移产生了新历史', store.getSummary().historyLabels.includes('断面平移'));
  check('断面顶点沿 +z 移动了 0.1', Math.abs(afterCapPos.z - beforeCapPos.z - 0.1) < 1e-5,
    `实际位移 ${(afterCapPos.z - beforeCapPos.z).toFixed(5)}`);
}

console.log(failures === 0 ? '\n状态层测试全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
