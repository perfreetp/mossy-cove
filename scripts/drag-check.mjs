import puppeteer from 'puppeteer-core';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', defaultViewport: { width: 1600, height: 1000 },
  args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://127.0.0.1:4188/', { waitUntil: 'networkidle0' });
await page.waitForFunction('document.documentElement.dataset.appReady === "true"');
await sleep(2000);

const box = await page.evaluate(() => {
  const el = document.querySelector('height-band-control').shadowRoot.querySelector('[data-testid="band-low"]');
  const r = el.getBoundingClientRect();
  return { left:r.left, right:r.right, top:r.top, h:r.height };
});
const y = box.top + box.h/2;
// 拖下限滑块向右 ~180px
await page.mouse.move(box.left+12, y); await page.mouse.down();
for (let i=1;i<=8;i++) await page.mouse.move(box.left+12+i*22, y);
await page.mouse.up(); await sleep(200);
const afterLow = await page.evaluate(()=>window.__VEG_TOOL__.state.bandLow);
console.log('拖拽后 bandLow =', afterLow.toFixed(3));

// 拖上限滑块向左 ~220px
await page.mouse.move(box.right-12, y); await page.mouse.down();
for (let i=1;i<=10;i++) await page.mouse.move(box.right-12-i*22, y);
await page.mouse.up(); await sleep(200);
const afterHigh = await page.evaluate(()=>window.__VEG_TOOL__.state.bandHigh);
console.log('拖拽后 bandHigh =', afterHigh.toFixed(3));

// 撤销两次应恢复 0/1
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
await sleep(200);
const restored = await page.evaluate(()=>[window.__VEG_TOOL__.state.bandLow, window.__VEG_TOOL__.state.bandHigh]);
console.log('两次撤销后 =', restored.map(v=>v.toFixed(2)).join(', '));
const ok = afterLow > 0.15 && afterHigh < 0.85 && restored[0]===0 && restored[1]===1 && errs.length===0;
console.log(ok ? '真实滑块拖拽 ✅' : '滑块拖拽 ❌ '+errs.join(';'));
await page.screenshot({path:'screenshots/09-real-drag.png'});
await browser.close();
process.exit(ok?0:1);
