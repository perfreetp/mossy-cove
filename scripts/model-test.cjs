// GLB 模型导入测试：生成最小立方体 GLB -> 页面内走真实文件导入 -> 校验障碍物与包围盒
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

// 先生成 GLB
execFileSync(process.execPath, [path.join(__dirname, 'make-glb.cjs')]);
const glbPath = path.join(os.tmpdir(), 'btr-io', 'test-cube.glb');
const glbB64 = fs.readFileSync(glbPath).toString('base64');

const outDir = path.join(os.tmpdir(), 'btr-model');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9226;
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
    if (msg.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      logs.push('[console.' + msg.params.type + '] ' + msg.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview?.properties ?? '')).join(' '));
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(6000);

  const setup = `(async () => {
    const E = window.__btr.engine;
    const b64 = ${JSON.stringify(glbB64)};
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const file = new File([bytes], 'test-cube.glb', { type: 'model/gltf-binary' });
    const dataUrl = 'data:model/gltf-binary;base64,' + b64;

    // 先直接调引擎，隔离文件 input 注入与 GLB 解析两条路径
    let directErr = null;
    try {
      await E.addModel({ id: 'ast_direct', name: 'direct-cube', fileName: 'test-cube.glb', dataUrl, halfExtents: [1,1,1] });
    } catch (err) { directErr = String(err && err.stack || err); }
    const afterDirect = E.getProjectData();

    const input = [...document.querySelectorAll('input[type=file]')].find(i => i.accept.includes('glb'));
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i=0;i<20;i++) {
      await new Promise(r=>setTimeout(r,250));
      if (E.getProjectData().obstacles.length === 2) break;
    }
    const d = E.getProjectData();
    const toast = document.querySelector('.toast')?.textContent ?? '(无 toast)';
    const checks = [];
    const expect = (n,c,x='') => checks.push((c?'PASS ':'FAIL ')+n+(x?' :: '+x:''));
    expect('直接 addModel 成功', directErr===null && afterDirect.obstacles.length===1, directErr ?? '');
    expect('文件 input 导入成功', d.obstacles.length===2, 'obs='+d.obstacles.length+' toast='+toast);
    const modelObs = d.obstacles.find(o => o.kind==='model');
    expect('生成 model 类型障碍物', !!modelObs);
    if (modelObs) {
      const he = modelObs.halfExtents;
      // 归一化规则：最长边缩放到 4（半尺寸=2）。测试 GLB 是边长 2 的立方体，
      // 放大 2 倍后边长 4，半尺寸应为 2
      expect('包围盒归一化(最长边半尺寸≈2)', he.every(v => Math.abs(v-2)<0.05), JSON.stringify(he));
    }
    expect('资产已登记', d.assets.length>=1 && d.assets[0].dataUrl.startsWith('data:'));

    const e = E.addPoint('entry',[-4,0,0]); E.updatePoint(e.id,{direction:[1,0,0]});
    const x = E.addPoint('exit',[4,0,0]); E.updatePoint(x.id,{direction:[1,0,0]});
    const t = E.createTrajectory();
    expect('模型障碍物参与遮挡判定', t.occlusions.length>=1, JSON.stringify(t.occlusions.map(o=>o.obstacleName)));
    return { checks };
  })()`;
  const r = await send('Runtime.evaluate', { expression: setup, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    console.error('PAGE FAIL:', JSON.stringify(r.exceptionDetails, null, 2));
    proc.kill(); process.exit(1);
  }
  console.log(r.result.value.checks.join('\n'));
  console.log('\n页面异常:', logs.length ? logs.join('; ') : '无');
  const fails = r.result.value.checks.filter((c) => c.startsWith('FAIL')).length;
  proc.kill();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
