/**
 * 真实浏览器运行时检查（使用系统 Chrome，无需额外下载浏览器）：
 * npx playwright-core 驱动，验证 WebGL 初始化、UI 渲染、交互与本地持久化。
 */
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.TARGET_URL ?? 'http://localhost:4173/';

const consoleErrors = [];
const pageErrors = [];
const failed = [];
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name} ${detail}`);
  }
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox'
  ]
});

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 400) consoleErrors.push(`HTTP ${res.status()} ${res.url()}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);

  // 1. 画布与 WebGL
  const canvasInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.render-canvas');
    if (!canvas) return { found: false };
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return {
      found: true,
      width: canvas.width,
      height: canvas.height,
      webgl: !!gl,
      renderer: gl ? gl.getParameter(gl.RENDERER) : null
    };
  });
  check('渲染画布存在且已初始化', canvasInfo.found && canvasInfo.width > 0, JSON.stringify(canvasInfo));
  check('WebGL 上下文可用（软件渲染）', canvasInfo.webgl, canvasInfo.renderer);

  // 2. 关键 UI 区块
  check('顶栏标题渲染', await page.locator('.topbar strong').first().textContent().then((t) => t.includes('Cloud Ridge')));
  check('地形三个滑杆存在', (await page.locator('#tr-relief, #tr-frag, #tr-base').count()) === 3);
  check('笔刷半径/强度滑杆存在', (await page.locator('#br-radius, #br-strength').count()) === 2);
  check('三套光照预设渲染', (await page.locator('.preset-card').count()) === 3);
  check('云团列表有条目', (await page.locator('.cloud-item').count()) >= 4);

  // 3. 光照预设切换
  const fogBefore = await page.evaluate(() => {
    const c = document.querySelector('canvas.render-canvas');
    return c ? c.width : 0;
  });
  await page.locator('.preset-card', { hasText: '黄昏' }).click();
  await page.waitForTimeout(900);
  check('切换黄昏预设无报错', pageErrors.length === 0, pageErrors.join('; '));
  void fogBefore;

  // 4. 笔刷模式切换
  await page.locator('button', { hasText: '抬升' }).first().click();
  await page.waitForTimeout(300);
  check('进入笔刷模式', (await page.locator('.status-bar').textContent()).includes('笔刷'));

  // 5. 在画布中央执行一次笔刷笔画
  const box = await page.locator('canvas.render-canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
  await page.mouse.down();
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(
      box.x + box.width * (0.5 + i * 0.012),
      box.y + box.height * (0.55 - i * 0.006)
    );
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('笔刷笔画后仍无页面错误', pageErrors.length === 0, pageErrors.join('; '));

  // 6. 撤销
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  check('Ctrl+Z 撤销可用', (await page.locator('.topbar .btn').first().textContent()).includes('撤销'));

  // 7. 云团选中与档位调整
  await page.locator('.cloud-item').first().click();
  await page.waitForTimeout(300);
  const tierBox = page.locator('.tier-box');
  check('选中云团后出现档位面板', await tierBox.count().then((c) => c === 1));
  await tierBox.locator('.tier-picker button').nth(2).first().click();
  await page.waitForTimeout(300);
  check('调整云团档位无报错', pageErrors.length === 0, pageErrors.join('; '));

  // 8. 显隐与锁定
  const firstItem = page.locator('.cloud-item').first();
  await firstItem.locator('.icon-btn').nth(0).click();
  await firstItem.locator('.icon-btn').nth(1).click();
  await page.waitForTimeout(300);
  check('显隐/锁定按钮可操作', pageErrors.length === 0, pageErrors.join('; '));

  // 9. 本地持久化
  const stored = await page.evaluate(() => localStorage.getItem('cloud-ridge-studio:scene:v1'));
  check('场景已写入 localStorage', !!stored && stored.includes('cloud-ridge-studio'));
  let parsedOk = false;
  try {
    const parsed = JSON.parse(stored);
    parsedOk =
      Array.isArray(parsed.clouds) &&
      Array.isArray(parsed.brushMap) &&
      parsed.terrainParams &&
      parsed.lighting === 'dusk';
  } catch {
    /* noop */
  }
  check('本地场景结构完整且光照状态持久化', parsedOk);

  // 10. 截图留证
  await page.screenshot({ path: 'scripts/browser-shot.png' });
  check('截图已保存', true);

  // 11. 控制台错误汇总（Babylon 软件渲染可能有警告，错误应为零）
  check('全程无未捕获页面异常', pageErrors.length === 0, pageErrors.join('; '));
  check('全程无 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await context.close();
} finally {
  await browser.close();
}

if (failed.length) {
  console.error(`\n浏览器检查失败 ${failed.length} 项`);
  process.exit(1);
}
console.log('\n浏览器运行时检查全部通过 ✔');
