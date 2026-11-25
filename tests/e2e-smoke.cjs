// 无头 Chrome 端到端冒烟:加载页面、捕获控制台/页面错误、等待 WebGL 与 worker,
// 点击"加载示例化石",轮询模型状态与截面结果。
const CDP = require('chrome-remote-interface');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5199/';
const PORT = 9333;

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--window-size=1680,1000',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--user-data-dir=C:\\Users\\Administrator\\AppData\\Local\\Temp\\cdp-profile',
  'about:blank'
], { stdio: 'ignore' });

const logs = [];
const errors = [];

(async () => {
  let client;
  try {
    // 等待 devtools 就绪
    for (let i = 0; i < 30; i++) {
      try { client = await CDP({ port: PORT }); break; } catch { await sleep(500); }
    }
    if (!client) throw new Error('Chrome DevTools 连接失败');
    const { Page, Runtime, Console, Log } = client;
    await Page.enable();
    await Runtime.enable();
    await Console.enable();
    await Log.enable();

    Runtime.exceptionThrown(({ exceptionDetails }) => {
      errors.push('JS异常: ' + (exceptionDetails.exception?.description || exceptionDetails.text));
    });
    Runtime.consoleAPICalled(({ type, args }) => {
      const text = args.map(a => a.value ?? a.description ?? '').join(' ');
      logs.push(`[${type}] ${text}`);
      if (type === 'error') errors.push('console.error: ' + text);
    });
    Log.entryAdded(({ entry }) => {
      if (entry.level === 'error') errors.push('日志错误: ' + entry.text);
    });

    await Page.navigate({ url: URL });
    await Page.loadEventFired();
    await sleep(3000);

    // 基础渲染检查
    const initial = await Runtime.evaluate({
      expression: `(() => ({
        title: document.title,
        canvasCount: document.querySelectorAll('canvas').length,
        hasWebGL: (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch(e){ return false; } })(),
        buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 12)
      }))()`,
      returnByValue: true
    });
    console.log('初始页面:', JSON.stringify(initial.result.value, null, 2));

    // 点击加载示例
    const clicked = await Runtime.evaluate({
      expression: `(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('示例化石'));
        if (!btn) return '按钮未找到';
        btn.click();
        return '已点击';
      })()`,
      returnByValue: true
    });
    console.log('示例按钮:', clicked.result.value);

    // 轮询模型加载(最多 30s)
    let state = null;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const r = await Runtime.evaluate({
        expression: `(() => {
          const chips = [...document.querySelectorAll('.status-chip')].map(e => e.textContent.trim());
          const info = document.querySelector('.info')?.textContent?.replace(/\\s+/g, ' ').slice(0, 160) || '';
          return { chips, info };
        })()`,
        returnByValue: true
      });
      state = r.result.value;
      if (state.info.includes('流形状态')) break;
    }
    console.log('模型状态:', JSON.stringify(state, null, 2));

    // 等待截面(平面卡片里的"轮廓 N · 面积"文本)
    await sleep(2500);
    const sections = await Runtime.evaluate({
      expression: `[...document.querySelectorAll('.plane-block')].map(b => b.textContent.replace(/\\s+/g,' ').match(/轮廓\\s*\\d+[^]*/)?.[0]?.slice(0,80) || '无截面文本')`,
      returnByValue: true
    });
    console.log('截面信息:', JSON.stringify(sections.result.value, null, 2));

    // 触发批量切片
    const batch = await Runtime.evaluate({
      expression: `(() => {
        const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('序列截面'));
        if (!b || b.disabled) return '不可用';
        b.click();
        return '已触发批量';
      })()`,
      returnByValue: true
    });
    console.log('批量切片:', batch.result.value);
    await sleep(4000);
    const batchState = await Runtime.evaluate({
      expression: `({
        cells: document.querySelectorAll('.slice-cell').length,
        pager: document.querySelector('.pager .pos')?.textContent || '',
        thumbCanvas: [...document.querySelectorAll('.slice-cell canvas')].filter(c => c.width > 0).length
      })`,
      returnByValue: true
    });
    console.log('批量结果:', JSON.stringify(batchState.result.value, null, 2));

    console.log('\\n=== 控制台错误 (' + errors.length + ') ===');
    errors.forEach(e => console.log(e));
    console.log('\\n=== 控制台输出(后10条) ===');
    logs.slice(-10).forEach(l => console.log(l));

    const ok = initial.result.value.canvasCount >= 1
      && state?.info?.includes('NoError')
      && batchState.result.value.cells > 0
      && errors.filter(e => !e.includes('favicon') && !e.includes('404')).length === 0;
    console.log('\\n冒烟结果:', ok ? 'PASS' : 'FAIL');
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error('脚本异常:', e);
    process.exitCode = 1;
  } finally {
    await client?.close();
    chrome.kill();
    setTimeout(() => process.exit(), 500);
  }
})();
