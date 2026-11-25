/** 三套光照预设截图，用于人工核对视觉效果。 */
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox']
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const presets = [
  ['正午', 1],
  ['清晨', 0],
  ['黄昏', 2]
];
for (const [name, idx] of presets) {
  await page.locator('.preset-card').nth(idx).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `scripts/shot-${name}.png` });
  console.log(`saved scripts/shot-${name}.png`);
}
await browser.close();
