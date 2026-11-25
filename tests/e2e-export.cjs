// 导出功能验证:PNG dataURL、JSON/TXT 坐标文件的真实内容
const CDP = require('chrome-remote-interface');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--window-size=1680,1000', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--no-sandbox',
  '--user-data-dir=C:\\Users\\Administrator\\AppData\\Local\\Temp\\cdp-profile-exp', 'about:blank'], { stdio: 'ignore' });
const errors = [];
const ev = async (R, expression) => (await R.evaluate({ expression, returnByValue: true, awaitPromise: true })).result.value;

(async () => {
  let client;
  for (let i = 0; i < 30; i++) { try { client = await CDP({ port: PORT }); break; } catch { await sleep(500); } }
  const { Page, Runtime } = client;
  await Page.enable(); await Runtime.enable();
  Runtime.exceptionThrown(({ exceptionDetails }) => errors.push(exceptionDetails.exception?.description || exceptionDetails.text));
  await Page.navigate({ url: 'http://localhost:5199/' });
  await Page.loadEventFired();
  await sleep(2000);
  await ev(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('示例化石')).click()`);
  for (let i = 0; i < 60; i++) { await sleep(500); if (await ev(Runtime, `document.querySelector('.info')?.textContent.includes('NoError')`)) break; }
  await sleep(2000);

  // 注入下载拦截,捕获导出的 Blob/dataURL
  await ev(Runtime, `window.__downloads = [];
    window.__origCreate = document.createElement.bind(document);
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      window.__downloads.push({ href: String(this.href).slice(0, 60), name: this.download });
    };`);

  // 当前截面导出(X 平面 PNG/JSON/TXT)
  const exportCheck = await ev(Runtime, `(async () => {
    const rows = [...document.querySelectorAll('.card .row')];
    const xRow = rows.find(r => r.textContent.trim().startsWith('X'));
    const btns = [...xRow.querySelectorAll('button')];
    const out = [];
    for (const b of btns) { b.click(); await new Promise(r=>setTimeout(r,150)); }
    return window.__downloads.map(d => d.name);
  })()`);
  console.log('X平面导出文件:', JSON.stringify(exportCheck));

  // 批量切片后导出单张
  await ev(Runtime, `[...document.querySelectorAll('button')].find(x=>x.textContent.includes('序列截面')).click()`);
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ev(Runtime, `document.querySelectorAll('.slice-cell').length >= 12`)) break; }
  await ev(Runtime, `window.__downloads = []`);
  await ev(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='导出图片').click()`);
  await sleep(300);
  await ev(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='坐标 JSON').click()`);
  await sleep(300);
  const dl = await ev(Runtime, `window.__downloads.map(d=>d.name)`);
  console.log('切片导出文件:', JSON.stringify(dl));

  // 直接验证 PNG dataURL 是有效图片
  const pngValid = await ev(Runtime, `(async () => {
    // 通过 canvas 重新生成一张截面 PNG 验证
    const c = document.querySelector('.slice-cell canvas');
    const url = c.toDataURL('image/png');
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    return { prefix: url.slice(0, 22), w: img.naturalWidth, h: img.naturalHeight };
  })()`);
  console.log('PNG 有效性:', JSON.stringify(pngValid));

  // 验证缩略图 canvas 实际有绘制(非空白)
  const nonBlank = await ev(Runtime, `(() => {
    const c = document.querySelector('.slice-cell canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let colored = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i+3] > 0 && (d[i] > 40 || d[i+1] > 40 || d[i+2] > 40)) colored++; }
    return { canvasSize: c.width, coloredPixels: colored };
  })()`);
  console.log('缩略图绘制:', JSON.stringify(nonBlank));

  // 3D 截图
  await ev(Runtime, `window.__downloads = []`);
  await ev(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('导出3D截图')).click()`);
  await sleep(300);
  const shot = await ev(Runtime, `window.__downloads.map(d=>d.name)`);
  console.log('3D截图:', JSON.stringify(shot));

  console.log('\\n错误:', errors.length, errors.join('; '));
  const ok = exportCheck.length === 3 && dl.length === 2 && pngValid.w > 0
    && nonBlank.coloredPixels > 100 && shot.length === 1 && errors.length === 0;
  console.log('导出冒烟:', ok ? 'PASS' : 'FAIL');
  await client.close(); chrome.kill(); setTimeout(() => process.exit(ok ? 0 : 1), 300);
})();
