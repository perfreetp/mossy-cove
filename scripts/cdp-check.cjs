// 通过 Chrome DevTools Protocol 检查页面运行时状态（console 日志、window 状态、WebGL）
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');

const outDir = path.join(require('os').tmpdir(), 'btr-smoke');
fs.mkdirSync(outDir, { recursive: true });
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
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

async function getJSON(pathname) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${pathname}`, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function waitForPort() {
  for (let i = 0; i < 40; i++) {
    try {
      await getJSON('/json/version');
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('devtools port never came up');
}

(async () => {
  await waitForPort();
  const tabs = await getJSON('/json');
  const page = tabs.find((t) => t.type === 'page');
  const wsUrl = page.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);
  const logs = [];
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(`[console.${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      logs.push('[EXCEPTION] ' + JSON.stringify(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
    }
    if (msg.method === 'Log.entryAdded') {
      logs.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(9000);

  const state = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      hasCanvas: !!document.querySelector('canvas'),
      canvasW: document.querySelector('canvas')?.width,
      panelTitles: [...document.querySelectorAll('.panel h2')].map(e=>e.textContent),
      statusText: document.querySelector('.status-bar')?.textContent?.replace(/\\s+/g,' ').trim(),
      pointCount: document.querySelectorAll('.point-item').length,
      gl: (()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2')||c.getContext('webgl');return g?g.getParameter(g.VERSION):'NO_GL';})(),
    })`,
    returnByValue: true,
  });
  console.log('RUNTIME STATE:', state.result.value);
  console.log('--- LOGS ---');
  console.log(logs.join('\n') || '(no console output)');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'cdp.png'), Buffer.from(shot.data, 'base64'));
  console.log('screenshot written');
  proc.kill();
  process.exit(0);
})().catch((e) => {
  console.error('TEST FAILURE:', e);
  proc.kill();
  process.exit(1);
});
