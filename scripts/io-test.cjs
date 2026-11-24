// 导出/导入闭环测试：构造场景 -> 真实导出下载 -> 校验结构 -> 真实文件导入 -> 比对数据
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const outDir = path.join(os.tmpdir(), 'btr-io');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9225;
const userData = path.join(outDir, 'profile');
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`,
  '--window-size=1600,1000', 'about:blank',
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (p) => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${PORT}${p}`, (res) => {
    let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve(JSON.parse(b)));
  }).on('error', reject);
});

(async () => {
  for (let i = 0; i < 40; i++) { try { await getJSON('/json/version'); break; } catch { await sleep(250); } }
  const page = (await getJSON('/json')).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id; pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(msg.params.exceptionDetails.text);
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(6000);

  // 整个流程都在浏览器页面上下文内执行
  const setup = `(async () => {
    const E = window.__btr.engine;
    const checks = [];
    const expect = (name, cond, extra='') => checks.push((cond?'PASS ':'FAIL ')+name+(extra?' :: '+extra:''));

    E.addBox([0,1,4],[0.5,1,1]);
    const e = E.addPoint('entry',[0,1,0]); E.updatePoint(e.id,{direction:[0,0,1]});
    const x = E.addPoint('exit',[0,1,8]); E.updatePoint(x.id,{direction:[0,0,1]});
    E.addPoint('constraint',[0,2,4]);
    E.createTrajectory();
    const before = E.getProjectData();

    let blobUrl = null;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (this.href && this.href.startsWith('blob:')) blobUrl = this.href;
    };
    window.__btr.storeExport();
    HTMLAnchorElement.prototype.click = origClick;
    const payloadText = await (await fetch(blobUrl)).text();
    const parsed = JSON.parse(payloadText);

    expect('导出包裹格式标识', parsed.format === 'ballistic-trajectory-recon');
    expect('导出含点位', parsed.project.points.length === 3);
    expect('点位含坐标与方向', parsed.project.points.every(p => p.position.length===3 && p.direction.length===3));
    expect('导出含障碍物', parsed.project.obstacles.length === 1);
    expect('导出含弹道', parsed.project.trajectories.length === 1);
    expect('导出含 201 采样点', parsed.project.trajectories[0].samples.length === 201);
    expect('导出含遮挡判定数组', Array.isArray(parsed.project.trajectories[0].occlusions));
    expect('采样点为三维数值', parsed.project.trajectories[0].samples[0].length === 3);

    const file = new File([payloadText], 'roundtrip.btr.json', { type: 'application/json' });
    const input = document.querySelector('input[type=file][accept*="json"]');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1800));
    const after = E.getProjectData();

    expect('导入后点位数一致', after.points.length === before.points.length, after.points.length+' vs '+before.points.length);
    expect('导入后障碍物数一致', after.obstacles.length === before.obstacles.length);
    expect('导入后弹道数一致', after.trajectories.length === before.trajectories.length);
    expect('导入后采样点数一致', after.trajectories[0].samples.length === 201);
    expect('id 已重新映射', !after.points.some(p => before.points.some(bp => bp.id === p.id)));
    const coordMatch = after.points.every((p,i) =>
      Math.abs(p.position[0]-before.points[i].position[0])<1e-9 &&
      Math.abs(p.direction[2]-before.points[i].direction[2])<1e-9);
    expect('坐标方向数值保留', coordMatch);
    expect('遮挡判定保留', after.trajectories[0].occlusions.length === before.trajectories[0].occlusions.length);

    return { checks };
  })()`;
  const r = await send('Runtime.evaluate', { expression: setup, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    console.error('PAGE FAIL:', JSON.stringify(r.exceptionDetails, null, 2));
    proc.kill();
    process.exit(1);
  }
  const checks = r.result.value.checks;
  console.log(checks.join('\n'));
  console.log('\n页面异常:', logs.length ? logs.join('; ') : '无');
  const fails = checks.filter((c) => c.startsWith('FAIL')).length;
  proc.kill();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
