// 测量功能验证:两点距离与轮廓面积的端到端拾取
const CDP = require('chrome-remote-interface');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9338;
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--window-size=1680,1000', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--no-sandbox',
  '--user-data-dir=C:\\Users\\Administrator\\AppData\\Local\\Temp\\cdp-profile-meas', 'about:blank'], { stdio: 'ignore' });
const errors = [];
const ev = async (R, expression) => (await R.evaluate({ expression, returnByValue: true, awaitPromise: true })).result.value;

(async () => {
  let client;
  for (let i = 0; i < 30; i++) { try { client = await CDP({ port: PORT }); break; } catch { await sleep(500); } }
  const { Page, Runtime, Input } = client;
  await Page.enable(); await Runtime.enable();
  Runtime.exceptionThrown(({ exceptionDetails }) => errors.push(exceptionDetails.exception?.description || exceptionDetails.text));
  await Page.navigate({ url: 'http://localhost:5199/' });
  await Page.loadEventFired();
  await sleep(2000);
  await ev(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('示例化石')).click()`);
  for (let i = 0; i < 60; i++) { await sleep(500); if (await ev(Runtime, `document.querySelector('.info')?.textContent.includes('NoError')`)) break; }
  await sleep(2500);

  // 确认场景里存在截面填充网格可供射线拾取
  const fillInfo = await ev(Runtime, `(() => {
    // 通过 WebGL 渲染器画布尺寸确认渲染就绪
    const c = document.querySelector('.viewport canvas');
    return { w: c.width, h: c.height };
  })()`);
  console.log('视口画布:', JSON.stringify(fillInfo));

  // 启用距离测量,在画布中心附近点两次
  await ev(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='两点距离').click()`);
  const modeOn = await ev(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='两点距离').classList.contains('toggled')`);
  const rect = await ev(Runtime, `(() => { const r = document.querySelector('.viewport canvas').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);

  // 点击两个略微错开的点(截面在模型中心,中心区域命中概率高)
  const clicks = [
    [rect.x + rect.w * 0.5, rect.y + rect.h * 0.5],
    [rect.x + rect.w * 0.55, rect.y + rect.h * 0.52]
  ];
  for (const [x, y] of clicks) {
    await Input.dispatchMouseEvent({ type: 'mouseMoved', x, y, button: 'none' });
    await Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(400);
  }
  await sleep(500);
  const distMeasure = await ev(Runtime, `[...document.querySelectorAll('.measure-item')].map(m=>m.textContent.replace(/\\s+/g,' '))`);
  console.log('距离测量项:', JSON.stringify(distMeasure));

  // 切换面积模式,在截面轮廓附近点击
  await ev(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='两点距离').click()`);
  await ev(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='轮廓面积').click()`);
  // 在多个候选位置尝试点选轮廓
  const candidates = [
    [0.5, 0.5], [0.45, 0.45], [0.55, 0.45], [0.5, 0.58], [0.42, 0.5], [0.58, 0.55]
  ];
  let areaItems = [];
  for (const [fx, fy] of candidates) {
    const x = rect.x + rect.w * fx;
    const y = rect.y + rect.h * fy;
    await Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(300);
    areaItems = await ev(Runtime, `[...document.querySelectorAll('.measure-item')].map(m=>m.textContent.replace(/\\s+/g,' '))`);
    if (areaItems.some(t => t.includes('面积'))) break;
  }
  console.log('面积测量项:', JSON.stringify(areaItems));

  console.log('错误:', errors.length, errors.slice(0, 2).join('; '));
  const ok = modeOn && distMeasure.some(t => t.includes('距离')) && areaItems.some(t => t.includes('面积')) && errors.length === 0;
  console.log('测量冒烟:', ok ? 'PASS' : 'FAIL');
  await client.close(); chrome.kill(); setTimeout(() => process.exit(ok ? 0 : 1), 300);
})();
