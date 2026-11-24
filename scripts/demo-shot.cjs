// 视觉验收：构造演示场景（障碍墙、约束点、两条候选弹道与遮挡高亮）并截图
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const outDir = path.join(os.tmpdir(), 'btr-demo');
fs.mkdirSync(outDir, { recursive: true });
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;
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

  const setup = `(async () => {
    const E = window.__btr.engine;
    // 一道横在弹道上的墙、一个侧面家具、后方掩体
    E.addBox([0, 1.2, 4], [0.5, 1.2, 1.2]);
    E.addBox([4, 0.75, 3], [1.5, 0.75, 1]);
    E.addBox([-3, 1, 7], [1, 1, 0.6]);
    const entry = E.addPoint('entry', [0, 1.2, 0]);
    E.updatePoint(entry.id, { direction: [0, 0, 1] });
    const mid = E.addPoint('constraint', [0.5, 2.2, 4]);
    const exit = E.addPoint('exit', [0, 1.2, 9]);
    E.updatePoint(exit.id, { direction: [0, 0, 1] });
    const t1 = E.createTrajectory();
    E.setBendLevel(t1.id, 3);
    // 第二条更直的候选用于淡出对比
    const t2 = E.createTrajectory();
    E.setBendLevel(t2.id, 1);
    E.selectTrajectory(t1.id);
    const d = E.getProjectData();
    return {
      obstacles: d.obstacles.length,
      points: d.points.length,
      trajectories: d.trajectories.length,
      activeOcclusions: d.trajectories.find(t=>t.id===t1.id).occlusions.length,
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: setup, awaitPromise: true, returnByValue: true });
  console.log('演示场景:', JSON.stringify(r.result.value));
  console.log('异常:', logs.length ? logs.join('; ') : '无');
  await sleep(1500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'demo.png'), Buffer.from(shot.data, 'base64'));
  console.log('截图:', path.join(outDir, 'demo.png'));
  proc.kill();
  process.exit(0);
})().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
