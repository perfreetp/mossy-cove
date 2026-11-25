// e2e 运行器:自动拉起 Vite dev server,依次跑 4 套 headless Chrome 冒烟,最后收尾
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');
const PORT = 5199;
const SUITES = ['e2e-smoke.cjs', 'e2e-full.cjs', 'e2e-export.cjs', 'e2e-measure.cjs'];

function run(cmd, args, options = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
    p.on('exit', code => (code === 0 ? res() : rej(new Error(`${cmd} 退出码 ${code}`))));
  });
}

(async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32'
  });
  try {
    // 等待 dev server 就绪
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`http://localhost:${PORT}/`);
        if (r.ok) break;
      } catch { /* 未就绪 */ }
      await sleep(500);
    }
    for (const suite of SUITES) {
      console.log(`\n========== ${suite} ==========`);
      await run('node', [resolve(__dirname, suite)], {
        env: { ...process.env, NODE_PATH: resolve(__dirname, '../node_modules') }
      });
    }
    console.log('\n全部 e2e 套件通过');
  } finally {
    vite.kill();
  }
})().catch(err => {
  console.error('e2e 失败:', err.message);
  process.exit(1);
});
