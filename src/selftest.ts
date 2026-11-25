/* 浏览器内自检:挂载真实 Viewer,验证渲染/剖切/标注/历史/持久化全链路 */
import { createInitialPlanes, AppStore } from './store';
import { Viewer } from './three/viewer';
import type { AnnotationRecord } from './types';

const log: string[] = [];
let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  log.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const bounds = [
  { min: -1.0, max: 4.0 },
  { min: -2.9, max: 2.9 },
  { min: -2.9, max: 2.9 },
];

async function run(): Promise<void> {
  const host = document.createElement('div');
  host.style.width = '1280px';
  host.style.height = '800px';
  document.body.appendChild(host);

  const store = new AppStore(
    [
      { id: 'column', name: '立柱', visible: true, color: 0xb07a45 },
      { id: 'beam', name: '梁', visible: true, color: 0xa06a38 },
      { id: 'wedge', name: '木楔', visible: true, color: 0x8a5a30 },
    ],
    createInitialPlanes(bounds),
  );
  store.setBounds(bounds);

  const viewer = new Viewer(host, store);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => setTimeout(r, 300));

  // 1. 初始剖切(x 面默认启用)
  const layer = viewer.getAnnotationLayer();
  check('初始标注图层为空', layer.size === 0);

  // 2. 模拟添加 300 个标注(性能压力)
  const t0 = performance.now();
  for (let i = 0; i < 300; i++) {
    const rec: AnnotationRecord = {
      id: `perf-${i}`,
      plane: 'x',
      p1: [-0.5 + (i % 10) * 0.05, -0.5 + ((i * 7) % 10) * 0.05],
      p2: [0.5 - (i % 10) * 0.05, 0.5 - ((i * 7) % 10) * 0.05],
      createdAt: Date.now(),
    };
    store.addAnnotation(rec);
  }
  viewer.syncAnnotationViews(store.state.annotations);
  await new Promise((r) => setTimeout(r, 100));
  check('300 个标注视图已创建', layer.size === 300, `size=${layer.size}`);

  // 3. 拖动剖切面的重建耗时
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) {
    store.setPlaneOffset('x', -0.4 + i * 0.04);
    viewer.rebuildAllSections();
  }
  const dragMs = performance.now() - t1;
  check('20 次剖切重建总耗时 < 1000ms', dragMs < 1000, `${dragMs.toFixed(0)}ms`);
  check('单次重建平均 < 50ms', dragMs / 20 < 50, `${(dragMs / 20).toFixed(1)}ms`);

  // 4. 撤销/重做
  const beforeUndo = store.state.annotations.length;
  store.undo();
  check('撤销后标注减少', store.state.annotations.length < beforeUndo,
    `${beforeUndo} -> ${store.state.annotations.length}`);
  viewer.syncAnnotationViews(store.state.annotations);
  store.redo();
  viewer.syncAnnotationViews(store.state.annotations);
  check('重做后恢复 300 个', store.state.annotations.length === beforeUndo);

  // 5. 构件隐藏
  store.togglePart('wedge');
  viewer.syncPartVisibility();
  check('木楔隐藏生效', store.state.parts.find((p) => p.id === 'wedge')!.visible === false);
  store.undo();
  viewer.syncPartVisibility();
  viewer.syncAnnotationViews(store.state.annotations);
  check('撤销恢复木楔显示', store.state.parts.find((p) => p.id === 'wedge')!.visible === true);

  // 6. 持久化往返
  const doc = store.toSavedDoc();
  check('导出文档含 3 个剖切面', Object.keys(doc.planes).length === 3);
  check('导出文档含 300 标注', doc.annotations.length === 300);
  const json = JSON.stringify(doc);
  const restored = JSON.parse(json);
  const loadResult = store.loadSavedDoc(restored);
  viewer.syncAnnotationViews(store.state.annotations);
  check('导入还原标注数', loadResult.annotationCount === 300);
  check('导入后视图数一致', layer.size === 300);

  // 7. 三个面同时启用
  store.togglePlaneEnabled('y');
  store.togglePlaneEnabled('z');
  viewer.rebuildAllSections();
  check('三面剖切无异常', true);

  // 8. 渲染帧仍在产出(WebGL 上下文存活)
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const canvas = host.querySelector('canvas');
  check('渲染循环存活', !!canvas && canvas.width > 0 && canvas.height > 0,
    canvas ? `${canvas.width}x${canvas.height}` : 'no canvas');

  viewer.dispose();
  log.push(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'} | setup+300ann: ${(t1 - t0).toFixed(0)}ms`);

  const pre = document.createElement('pre');
  pre.id = 'result';
  pre.textContent = log.join('\n');
  document.body.appendChild(pre);
  document.title = failures === 0 ? 'SELFTEST_OK' : 'SELFTEST_FAIL';
}

run().catch((err) => {
  const pre = document.createElement('pre');
  pre.id = 'result';
  pre.textContent = `FATAL: ${err?.stack ?? err}`;
  document.body.appendChild(pre);
  document.title = 'SELFTEST_FAIL';
});
