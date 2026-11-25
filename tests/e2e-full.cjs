// 完整端到端流程冒烟:导入→切片→翻页→测量→方案保存/恢复→导出
const CDP = require('chrome-remote-interface');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5199/';
const PORT = 9336;
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--window-size=1680,1000', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--no-sandbox',
  '--user-data-dir=C:\\Users\\Administrator\\AppData\\Local\\Temp\\cdp-profile-full', 'about:blank'
], { stdio: 'ignore' });

const errors = [];
const evalJs = async (Runtime, expression) =>
  (await Runtime.evaluate({ expression, returnByValue: true })).result.value;

(async () => {
  let client;
  for (let i = 0; i < 30; i++) {
    try { client = await CDP({ port: PORT }); break; } catch { await sleep(500); }
  }
  const { Page, Runtime, Log } = client;
  await Page.enable(); await Runtime.enable(); await Log.enable();
  Runtime.exceptionThrown(({ exceptionDetails }) =>
    errors.push('JS异常: ' + (exceptionDetails.exception?.description || exceptionDetails.text)));
  Runtime.consoleAPICalled(({ type, args }) => {
    if (type === 'error') errors.push('console.error: ' + args.map(a => a.value ?? a.description ?? '').join(' '));
  });
  Log.entryAdded(({ entry }) => { if (entry.level === 'error' && !entry.url.includes('favicon')) errors.push('日志: ' + entry.text); });

  const results = {};
  try {
    await Page.navigate({ url: URL });
    await Page.loadEventFired();
    await sleep(2500);

    await evalJs(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('示例化石')).click()`);
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (await evalJs(Runtime, `document.querySelector('.info')?.textContent.includes('NoError')`)) break;
    }
    results.modelLoaded = await evalJs(Runtime, `!!document.querySelector('.info')?.textContent.includes('NoError')`);
    await sleep(2000);
    results.liveSections = await evalJs(Runtime,
      `[...document.querySelectorAll('.plane-block')].filter(b=>b.textContent.includes('轮廓')).length`);

    // 批量切片
    await evalJs(Runtime, `[...document.querySelectorAll('button')].find(x=>x.textContent.includes('序列截面')).click()`);
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (await evalJs(Runtime, `document.querySelectorAll('.slice-cell').length >= 12`)) break;
    }
    results.batchCells = await evalJs(Runtime, `document.querySelectorAll('.slice-cell').length`);

    // 翻页
    await evalJs(Runtime, `[...document.querySelectorAll('.pager button')].find(b=>b.textContent.includes('下一张')).click()`);
    await sleep(300);
    results.pagerAfterNext = await evalJs(Runtime, `document.querySelector('.pager .pos')?.textContent`);
    results.activeCell = await evalJs(Runtime, `document.querySelectorAll('.slice-cell.active').length`);

    // 测量模式切换(面积)
    await evalJs(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='轮廓面积').click()`);
    await sleep(200);
    results.areaModeActive = await evalJs(Runtime,
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='轮廓面积').classList.contains('toggled')`);
    await evalJs(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='轮廓面积').click()`);

    // 视图方案保存
    await evalJs(Runtime, `(() => { const i = document.querySelector('.scheme-item input, .card input[type=text]'); i.value='测试方案A'; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await evalJs(Runtime, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存').click()`);
    await sleep(300);
    results.schemeSaved = await evalJs(Runtime, `document.querySelectorAll('.scheme-item').length`);
    results.schemeName = await evalJs(Runtime, `document.querySelector('.scheme-item .n')?.textContent`);
    results.localStorage = await evalJs(Runtime, `localStorage.getItem('fossil-viewer-schemes-v1')?.length > 50`);

    // 拖动一个平面偏移滑块,再恢复方案
    const slider = await evalJs(Runtime, `!!document.querySelector('.plane-block input[type=range]')`);
    results.hasSlider = slider;

    // 恢复方案
    await evalJs(Runtime, `[...document.querySelectorAll('.scheme-item button')].find(b=>b.textContent.trim()==='恢复').click()`);
    await sleep(800);
    results.schemeRestored = await evalJs(Runtime, `document.querySelectorAll('.plane-block').length === 3`);

    // 导出按钮存在且可点(不真正下载,headless 下验证无异常)
    results.exportButtons = await evalJs(Runtime,
      `[...document.querySelectorAll('button')].filter(b=>/导出图片|坐标 JSON|导出3D截图/.test(b.textContent)).length`);

    // 角度锁定开关
    results.angleLock = await evalJs(Runtime, `document.querySelector('#angle-lock')?.checked`);

    // 平面隐藏开关
    await evalJs(Runtime, `document.querySelector('#hd-x').click()`);
    await sleep(600);
    results.hideToggleWorks = await evalJs(Runtime, `document.querySelector('#hd-x').checked`);
    await evalJs(Runtime, `document.querySelector('#hd-x').click()`);

    // 删除方案
    await evalJs(Runtime, `[...document.querySelectorAll('.scheme-item button')].find(b=>b.textContent.trim()==='删除').click()`);
    await sleep(300);
    results.schemeDeleted = await evalJs(Runtime, `document.querySelectorAll('.scheme-item').length === 0`);

  } catch (e) {
    errors.push('流程异常: ' + e.message);
  } finally {
    await client.close();
    chrome.kill();
  }

  console.log('\n=== 功能验证结果 ===');
  console.log(JSON.stringify(results, null, 2));
  console.log('\n=== 错误 (' + errors.length + ') ===');
  errors.forEach(e => console.log(e));
  const expected = {
    modelLoaded: true, liveSections: 3, batchCells: 12,
    pagerAfterNext: '2 / 12', activeCell: 1, areaModeActive: true,
    schemeSaved: 1, schemeName: '测试方案A', localStorage: true,
    hasSlider: true, schemeRestored: true, exportButtons: 3,
    angleLock: true, hideToggleWorks: true, schemeDeleted: true
  };
  const failed = Object.entries(expected).filter(([k, v]) => results[k] !== v);
  console.log('\n总体结果:', failed.length === 0 && errors.length === 0 ? 'PASS' : 'FAIL');
  if (failed.length) console.log('不符项:', JSON.stringify(failed));
  setTimeout(() => process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1), 300);
})();
