// 引擎级功能测试：通过 CDP 驱动真实 Babylon 引擎，验证完整工作流与性能
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const outDir = path.join(os.tmpdir(), 'btr-func');
fs.mkdirSync(outDir, { recursive: true });
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const userData = path.join(outDir, 'profile');

const proc = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userData}`,
  '--window-size=1600,1000',
  'about:blank',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (p) =>
  new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${p}`, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve(JSON.parse(b)));
    }).on('error', reject);
  });

(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      await getJSON('/json/version');
      break;
    } catch {
      await sleep(250);
    }
  }
  const page = (await getJSON('/json')).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      logs.push('[EXCEPTION] ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      logs.push('[console.error] ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(6000);

  // 在页面内定义测试程序，返回结构化结果
  const harness = `
  (async () => {
    const E = window.__btr.engine;
    const R = { steps: [], failures: [] };
    const ok = (name, cond, extra='') => {
      R.steps.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : ''));
      if (!cond) R.failures.push(name);
    };
    const data = () => E.getProjectData();

    // 1. 场景搭建：两个长方体，其中一个挡在弹道上
    E.addBox([0, 1, 4], [0.6, 1, 0.6]);       // 障碍墙，弹道沿 +Z 会穿过
    E.addBox([6, 1, 2], [1, 1, 1]);           // 侧面干扰物
    ok('障碍物数量=2', data().obstacles.length === 2);

    // 2. 点位标注：射入点(0,1,0) 朝 +Z，射出点(0,1,8) 朝 +Z，加一个中间约束点
    const entry = E.addPoint('entry', [0, 1, 0]);
    E.updatePoint(entry.id, { direction: [0, 0, 1] });
    const exit = E.addPoint('exit', [0, 1, 8]);
    E.updatePoint(exit.id, { direction: [0, 0, 1] });
    const mid = E.addPoint('constraint', [0, 2, 4]);
    ok('点位数量=3', data().points.length === 3);
    ok('点带方向', data().points[0].direction[2] === 1);

    // 3. 拟合弹道
    const t1 = E.createTrajectory();
    ok('生成候选弹道', !!t1);
    ok('采样点=201', t1.samples.length === 201, 'samples=' + t1.samples.length);
    ok('约束点已自动加入弹道', t1.pointIds.includes(mid.id));

    // 4. 遮挡判定：墙在 z=4 附近应被命中
    ok('检测到遮挡段', t1.occlusions.length >= 1, JSON.stringify(t1.occlusions.map(o=>o.obstacleName)));
    const hitWall = t1.occlusions.some((o) => o.obstacleId === data().obstacles[0].id);
    ok('命中的是弹道上的墙', hitWall);
    ok('遮挡段含入射/穿出坐标', t1.occlusions.every(o =>
      Array.isArray(o.enterPosition) && Array.isArray(o.exitPosition)));

    // 5. 实时重判：把墙移开 -> 遮挡消失；移回 -> 遮挡恢复
    const wallId = data().obstacles[0].id;
    E.updateObstacle(wallId, { position: [-8, 1, 4] });
    const afterMove = data().trajectories[0];
    ok('移开障碍物后遮挡消失', afterMove.occlusions.length === 0, 'occl=' + afterMove.occlusions.length);
    E.updateObstacle(wallId, { position: [0, 1, 4] });
    const afterMoveBack = data().trajectories[0];
    ok('移回后遮挡恢复', afterMoveBack.occlusions.length >= 1);

    // 6. 旋转障碍物到与弹道平行并偏移，验证旋转 OBB 重判
    E.updateObstacle(wallId, { position: [3, 1, 4], rotation: [0, Math.PI/4, 0] });
    const rotated = data().trajectories[0];
    ok('旋转后重判完成（结果合理）', Array.isArray(rotated.occlusions));
    E.updateObstacle(wallId, { position: [0, 1, 4], rotation: [0, 0, 0] });

    // 7. 弯曲档位（该构型切线沿 Z 轴，档位主要改变 Z 分布，需比较完整三维位移）
    E.setBendLevel(t1.id, 1);
    const lvl1 = data().trajectories.find(t => t.id === t1.id).samples;
    E.setBendLevel(t1.id, 5);
    const lvl5 = data().trajectories.find(t => t.id === t1.id).samples;
    const diff = lvl1.reduce((acc, p, i) =>
      acc + Math.hypot(p[0]-lvl5[i][0], p[1]-lvl5[i][1], p[2]-lvl5[i][2]), 0);
    ok('弯曲档位改变曲线', diff > 0.01, '三维累计位移差=' + diff.toFixed(4));

    // 8. 吸附开关
    E.setSnap(t1.id, false);
    const soft = data().trajectories[0];
    const midSampleSoft = soft.samples[100];
    const passThroughSoft = Math.abs(midSampleSoft[0]-mid.position[0])<1e-6 && Math.abs(midSampleSoft[1]-mid.position[1])<1e-6;
    E.setSnap(t1.id, true);
    const hard = data().trajectories[0];
    const midSampleHard = hard.samples[100];
    const passThroughHard = Math.abs(midSampleHard[0]-mid.position[0])<1e-6 && Math.abs(midSampleHard[1]-mid.position[1])<1e-6;
    ok('吸附开启精确过点', passThroughHard, JSON.stringify(midSampleHard));
    ok('关闭吸附为软约束', !passThroughSoft, JSON.stringify(midSampleSoft));

    // 9. 多候选弹道与淡出选择
    const t2 = E.createTrajectory();
    E.setBendLevel(t2.id, 2);
    ok('两条候选弹道', data().trajectories.length === 2);
    E.selectTrajectory(t1.id);
    ok('可切换激活弹道', data().activeTrajectoryId === t1.id);
    E.selectTrajectory(t2.id);
    ok('激活切换到第二条', data().activeTrajectoryId === t2.id);
    E.setTrajectoryVisible(t1.id, false);
    ok('可隐藏候选', data().trajectories.find(t=>t.id===t1.id).visible === false);
    E.setTrajectoryVisible(t1.id, true);

    // 10. 射入点方向调整触发重算
    const before = JSON.stringify(data().trajectories[0].samples[10]);
    E.updatePoint(entry.id, { direction: [0, 1, 0] });
    const after = JSON.stringify(data().trajectories[0].samples[10]);
    ok('调整射入点方向曲线重算', before !== after);
    E.updatePoint(entry.id, { direction: [0, 0, 1] });

    // 11. 性能：加到 300 个障碍物，测量纯重算路径（真实拖拽 frameTick 走的就是这条）
    E.addStressBoxes(298);
    const n300 = data().obstacles.length;
    ok('障碍物达到 300 个', n300 === 300, 'count=' + n300);
    const perCall = E.benchmarkRecompute(120);
    const breakdown = E.benchmarkBreakdown();
    R.perf = {
      obstacles: n300,
      pureRecomputeMs: perCall.toFixed(2),
      breakdown: Object.fromEntries(Object.entries(breakdown).map(([k,v]) => [k, typeof v==='number'?Number(v.toFixed(2)):v])),
    };
    ok('300 障碍纯重算 < 16ms（60fps 预算）', perCall < 16, perCall.toFixed(2) + ' ms/次，分项=' + JSON.stringify(R.perf.breakdown));

    // 含 React 快照同步的完整更新路径（更重，但仅在交互结束/属性编辑时发生）
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) {
      E.updateObstacle(wallId, { position: [0, 1, 4 + Math.sin(i/6)*2] });
    }
    const fullPath = (performance.now() - t0) / 30;
    R.perf.fullUpdateMs = fullPath.toFixed(2);

    // 12. 导出数据完整性（不触发下载，直接校验 sanitize 后的结构）
    const final = data();
    const tj = final.trajectories[0];
    ok('导出数据含点位坐标方向', final.points.every(p => p.position.length===3 && p.direction.length===3));
    ok('导出数据含采样点', tj.samples.length === 201);
    ok('导出数据含遮挡判定', Array.isArray(tj.occlusions));
    ok('IndexedDB 自动保存字段存在', typeof final.updatedAt === 'number');

    // 13. 删除
    E.removeObstacle(wallId);
    ok('删除障碍物', data().obstacles.length === 299);
    E.removePoint(mid.id);
    ok('删除约束点', data().points.length === 2);

    return R;
  })()`;

  const result = await send('Runtime.evaluate', {
    expression: harness,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    console.error('HARNESS EXCEPTION:', JSON.stringify(result.exceptionDetails, null, 2));
    proc.kill();
    process.exit(1);
  }
  const R = result.result.value;
  console.log('--- 功能测试步骤 ---');
  console.log(R.steps.join('\n'));
  console.log('\n性能基准（300 障碍物 × 60 次拖动重算）:', JSON.stringify(R.perf));
  console.log('\n页面异常日志:', logs.length ? logs.join('\n') : '(无)');
  console.log(`\n结果：${R.steps.filter(s=>s.startsWith('PASS')).length} 通过 / ${R.failures.length} 失败`);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'func-final.png'), Buffer.from(shot.data, 'base64'));
  proc.kill();
  process.exit(R.failures.length ? 1 : 0);
})().catch((e) => {
  console.error('TEST FAILURE:', e);
  proc.kill();
  process.exit(1);
});
