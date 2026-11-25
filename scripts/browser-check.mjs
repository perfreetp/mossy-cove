/* 真实 Chrome 端到端验证：node scripts/browser-check.mjs */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.CHECK_URL || 'http://127.0.0.1:4188/';
mkdirSync('screenshots', { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else {
    failures++;
    console.error('  ✗ FAIL:', msg);
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--window-size=1600,1000',
  ],
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction('document.documentElement.dataset.appReady === "true"', {
    timeout: 30000,
  });
  await sleep(2500); // 等待地形绘制 / Pixi 首帧 / fit

  const api = () => page.evaluate(() => window.__VEG_TOOL__);

  let info = await page.evaluate(() => ({
    n: window.__VEG_TOOL__.state.instances.length,
    zones: window.__VEG_TOOL__.state.zones.length,
    hasScene: !!window.__VEG_TOOL__.scene,
    pool: window.__VEG_TOOL__.scene.getPoolStats(),
  }));
  console.log('初始状态:', JSON.stringify(info));
  check(info.n > 2000, `首屏实例 > 2000（实际 ${info.n}）`);
  check(info.zones === 3, `初始 3 个区域（实际 ${info.zones}）`);
  check(info.hasScene, 'Pixi 场景已创建');
  await page.screenshot({ path: 'screenshots/01-initial.png' });

  // ---- 密度档位 ----
  await shadowClick('scatter-panel', '[data-density="dense"]');
  await sleep(400);
  const nDense = await page.evaluate(() => window.__VEG_TOOL__.state.instances.length);
  check(nDense > info.n, `密集档实例更多 (${info.n} -> ${nDense})`);
  await page.screenshot({ path: 'screenshots/02-dense.png' });

  // ---- 最小间距滑块（真实 input/change 事件）----
  await setSlider('scatter-panel', '#spacing', '36');
  await sleep(300);
  const spacing = await page.evaluate(() => window.__VEG_TOOL__.state.params.minSpacing);
  check(spacing === 36, `间距滑块生效 (${spacing})`);

  // ---- 乔灌比例 ----
  await setSlider('scatter-panel', '#ratio', '12');
  await sleep(300);
  const ratio = await page.evaluate(() => {
    const s = window.__VEG_TOOL__.state;
    return { r: s.params.treeRatio, trees: s.instances.filter((i) => i.layer === 'trees').length };
  });
  check(Math.abs(ratio.r - 0.12) < 0.001, `比例滑块生效 (treeRatio=${ratio.r})`);
  check(ratio.trees < 400, `低树木比例下树木很少 (${ratio.trees})`);
  await page.evaluate(() => window.__VEG_TOOL__.controller.undo());
  await sleep(200);
  const ratioBack = await page.evaluate(() => window.__VEG_TOOL__.state.params.treeRatio);
  check(Math.abs(ratioBack - 0.55) < 0.001, '撤销恢复比例');

  // 性能：连续 20 次拖参（含重撒 + Pixi sync）
  const perf = await page.evaluate(() => {
    const c = window.__VEG_TOOL__.controller;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) c.updateParams({ minSpacing: 12 + (i % 26) });
    const dt = performance.now() - t0;
    c.commitParamGesture();
    return { dt, n: window.__VEG_TOOL__.state.instances.length };
  });
  console.log(`  20 次调参+重撒+渲染同步 ${perf.dt.toFixed(0)}ms，平均 ${(perf.dt / 20).toFixed(1)}ms，实例 ${perf.n}`);
  check(perf.dt / 20 < 80, `拖动参数单帧处理 < 80ms（${(perf.dt / 20).toFixed(1)}ms）`);

  // 撤销回到间距 18
  await shadowClick('veg-toolbar', '#undo-btn');
  await sleep(200);
  // 可能需要多次撤销（性能循环产生了一条手势 + 间距手势 + 密度），直接用 API 撤销到间距 18
  await page.evaluate(() => {
    const c = window.__VEG_TOOL__.controller;
    for (let i = 0; i < 6 && c.store.state.params.minSpacing !== 18; i++) c.undo();
  });
  const spacingBack = await page.evaluate(() => window.__VEG_TOOL__.state.params.minSpacing);
  check(spacingBack === 18, '撤销后间距恢复默认 18');

  // ---- 高度带 ----
  await setSlider('height-band-control', '[data-testid="band-low"]', '380');
  await setSlider('height-band-control', '[data-testid="band-high"]', '720');
  await sleep(400);
  const band = await page.evaluate(() => {
    const tool = window.__VEG_TOOL__;
    const s = tool.state;
    const pool = tool.scene.getPoolStats();
    const visible = s.instances.filter((i) => i.h >= s.bandLow && i.h <= s.bandHigh).length;
    return { low: s.bandLow, high: s.bandHigh, visible, total: s.instances.length, ...pool };
  });
  check(Math.abs(band.low - 0.38) < 0.002 && Math.abs(band.high - 0.72) < 0.002, '高度带双滑块数值生效');
  check(band.treeFree + band.bushFree > 0, `区间外实例已回收到池 (free=${band.treeFree + band.bushFree})`);
  check(
    band.treeUsed + band.bushUsed === band.visible,
    `使用中精灵数恰为带内可见数 (${band.treeUsed + band.bushUsed} == ${band.visible})`,
  );
  check(band.visible < band.total, '窄高度带隐藏了部分实例');
  await page.screenshot({ path: 'screenshots/03-band.png' });

  // 两次独立滑块手势 -> 撤销两次恢复完整高度带
  await page.evaluate(() => {
    window.__VEG_TOOL__.controller.undo();
    window.__VEG_TOOL__.controller.undo();
  });
  await sleep(300);
  const bandReset = await page.evaluate(() => {
    const tool = window.__VEG_TOOL__;
    const s = tool.state;
    const pool = tool.scene.getPoolStats();
    return {
      low: s.bandLow,
      high: s.bandHigh,
      used: pool.treeUsed + pool.bushUsed,
      total: s.instances.length,
    };
  });
  check(bandReset.low === 0 && bandReset.high === 1, '撤销恢复完整高度带');
  check(bandReset.used === bandReset.total, `调回后全部实例重新显现 (${bandReset.used}/${bandReset.total})`);

  // ---- 对象池稳定性：连续重撒不应让精灵总数持续膨胀 ----
  const poolStable = await page.evaluate(() => {
    const c = window.__VEG_TOOL__.controller;
    const total = () => {
      const p = window.__VEG_TOOL__.scene.getPoolStats();
      return p.treeUsed + p.bushUsed + p.treeFree + p.bushFree;
    };
    c.beginParamGesture();
    c.updateParams({ minSpacing: 20 });
    c.commitParamGesture();
    const before = total();
    for (const v of [24, 19, 26, 21, 18]) {
      c.beginParamGesture();
      c.updateParams({ minSpacing: v });
      c.commitParamGesture();
    }
    const after = total();
    return { before, after };
  });
  check(
    poolStable.after <= poolStable.before + 4,
    `对象池精灵总数不随重撒膨胀 (${poolStable.before} -> ${poolStable.after})`,
  );

  // ---- 图层隐藏 ----
  await shadowClick('layer-list', '[data-testid="layer-toggle-trees"]');
  await sleep(300);
  const hidden = await page.evaluate(() => ({
    visible: window.__VEG_TOOL__.state.layers.trees.visible,
    pixiVisible: window.__VEG_TOOL__.scene.treeLayer?.visible,
  }));
  check(hidden.visible === false, '树木层状态为隐藏');
  await page.screenshot({ path: 'screenshots/04-tree-hidden.png' });
  await shadowClick('layer-list', '[data-testid="layer-toggle-trees"]');
  await sleep(200);

  // ---- 擦除笔刷 ----
  await shadowClick('veg-toolbar', '[data-tool="erase"]');
  await shadowClick('veg-toolbar', '[data-brush="2"]');
  await sleep(200);
  const eraseInfo = await page.evaluate(() => {
    const tool = window.__VEG_TOOL__;
    const inst = tool.state.instances.find((i) => i.layer === 'trees') || tool.state.instances[0];
    const p = tool.scene.terrainToClient(inst.x, inst.y);
    return { before: tool.state.instances.length, x: p.x, y: p.y };
  });
  await page.mouse.move(eraseInfo.x - 60, eraseInfo.y);
  await sleep(100);
  await page.mouse.down();
  for (let i = 0; i <= 10; i++) {
    await page.mouse.move(eraseInfo.x - 60 + i * 14, eraseInfo.y + Math.sin(i) * 18);
    await sleep(16);
  }
  await page.mouse.up();
  await sleep(400);
  const afterErase = await page.evaluate(() => window.__VEG_TOOL__.state.instances.length);
  check(afterErase < eraseInfo.before, `擦除清除了实例 (${eraseInfo.before} -> ${afterErase})`);
  await page.screenshot({ path: 'screenshots/05-erased.png' });
  // 撤销擦除
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(300);
  const afterUndoErase = await page.evaluate(() => window.__VEG_TOOL__.state.instances.length);
  check(afterUndoErase === eraseInfo.before, `Ctrl+Z 恢复擦除 (${afterUndoErase} == ${eraseInfo.before})`);

  // ---- 划定区域（真实拖拽）----
  await shadowClick('veg-toolbar', '[data-tool="zone"]');
  await sleep(150);
  const center = await page.evaluate(() => {
    const p = window.__VEG_TOOL__.scene.terrainToClient(1250, 820);
    return p;
  });
  const zonesBefore = await page.evaluate(() => window.__VEG_TOOL__.state.zones.length);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 120, center.y + 90, { steps: 6 });
  await sleep(100);
  await page.mouse.up();
  await sleep(500);
  const zonesAfter = await page.evaluate(() => window.__VEG_TOOL__.state.zones.length);
  check(zonesAfter === zonesBefore + 1, `拖拽产生新区域 (${zonesBefore} -> ${zonesAfter})`);
  await page.screenshot({ path: 'screenshots/06-new-zone.png' });
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(300);
  const zonesUndo = await page.evaluate(() => window.__VEG_TOOL__.state.zones.length);
  check(zonesUndo === zonesBefore, '撤销移除新区域');

  // ---- 区域定位按钮（验证 animate 不抛错）----
  await page.evaluate(() => {
    document
      .querySelector('scatter-panel')
      .shadowRoot.querySelector('[data-zone-action="focus"]')
      .click();
  });
  await sleep(700);
  const zoom = await page.evaluate(() => window.__VEG_TOOL__.scene.viewport.scaled);
  check(zoom > 0.5, `区域定位改变缩放 (${zoom.toFixed(2)})`);
  await page.evaluate(() => window.__VEG_TOOL__.scene.resetView());
  await sleep(400);

  // ---- 单层重撒 ----
  const seedBefore = await page.evaluate(() => window.__VEG_TOOL__.state.layers.bushes.seed);
  await shadowClick('layer-list', '[data-testid="layer-rescatter-bushes"]');
  await sleep(400);
  const seedAfter = await page.evaluate(() => window.__VEG_TOOL__.state.layers.bushes.seed);
  check(seedAfter !== seedBefore, '灌木层单独重撒更换种子');

  // ---- 导出 / 导入往返 ----
  const json = await page.evaluate(() => window.__VEG_TOOL__.exportJSON());
  const exportedState = JSON.parse(json);
  check(!!exportedState && exportedState.instances.length > 0, '导出 JSON 结构正确');
  await page.evaluate(async (text) => {
    const tool = window.__VEG_TOOL__;
    tool.controller.store.run('clear for test', (d) => {
      d.zones = [];
      d.instances = [];
    });
    await tool.importJSON(text);
  }, json);
  await sleep(500);
  const imported = await page.evaluate(() => ({
    n: window.__VEG_TOOL__.state.instances.length,
    zones: window.__VEG_TOOL__.state.zones.length,
  }));
  check(
    imported.n === exportedState.instances.length && imported.zones === exportedState.zones.length,
    `导入恢复完整数据 (${imported.n} 实例 / ${imported.zones} 区域)`,
  );
  await page.screenshot({ path: 'screenshots/07-imported.png' });

  // ---- 导入会像“打开文件”一样重置历史栈 ----
  const history = await page.evaluate(() => ({
    canUndo: window.__VEG_TOOL__.store.canUndo,
    canRedo: window.__VEG_TOOL__.store.canRedo,
  }));
  check(history.canUndo === false && history.canRedo === false, '导入恢复后历史栈已重置');

  // ---- 真实导出文件（下载事件）----
  const client = await page.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: process.cwd() + '\\screenshots',
    eventsEnabled: true,
  });
  const downloadPath = await new Promise((resolve) => {
    client.on('Browser.downloadProgress', (e) => {
      if (e.state === 'completed') resolve(e.guid);
    });
    page.evaluate(() => window.__VEG_TOOL__.controller.exportProject());
    setTimeout(() => resolve(null), 4000);
  });
  check(!!downloadPath, '点击导出后产生下载文件');

  check(errors.length === 0, `浏览器控制台无错误${errors.length ? '：\n' + errors.slice(0, 8).join('\n') : ''}`);
} catch (e) {
  failures++;
  console.error('脚本异常:', e);
  try {
    await page.screenshot({ path: 'screenshots/99-error.png' });
  } catch {}
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n浏览器验证全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);

// ---------- helpers ----------
async function shadowClick(hostSel, childSel) {
  await page.evaluate(
    ([h, c]) => document.querySelector(h).shadowRoot.querySelector(c).click(),
    [hostSel, childSel],
  );
}
async function setSlider(hostSel, inputSel, value) {
  await page.evaluate(
    ([h, sel, val]) => {
      const el = document.querySelector(h).shadowRoot.querySelector(sel);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [hostSel, inputSel, value],
  );
}
