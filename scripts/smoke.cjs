// headless 冒烟测试：加载页面、收集 console 错误、截图、导出 DOM 状态
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const outDir = path.join(require('os').tmpdir(), 'btr-smoke');
fs.mkdirSync(outDir, { recursive: true });
const shot = path.join(outDir, 'initial.png');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = [
  '--headless=new',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--window-size=1600,1000',
  '--virtual-time-budget=8000',
  '--enable-logging=stderr',
  '--v=0',
  `--screenshot=${shot}`,
  '--dump-dom',
  'http://localhost:5173/',
];
const proc = spawn(chrome, args, { maxBuffer: 1024 * 1024 * 64 });
let stderr = '';
let stdout = '';
proc.stdout.on('data', (d) => (stdout += d.toString()));
proc.stderr.on('data', (d) => (stderr += d.toString()));
proc.on('exit', (code) => {
  fs.writeFileSync(path.join(outDir, 'dom.html'), stdout);
  fs.writeFileSync(path.join(outDir, 'chrome-stderr.txt'), stderr);
  const errLines = stderr
    .split(/\r?\n/)
    .filter((l) => /ERROR|SEVERE|Uncaught|Failed|exception/i.test(l) && !/GPU stall|swiftshader|dawn/i.test(l));
  console.log('exit code:', code);
  console.log('screenshot exists:', fs.existsSync(shot), fs.existsSync(shot) ? fs.statSync(shot).size + ' bytes' : '');
  console.log('dom length:', stdout.length);
  console.log('canvas in dom:', /<canvas/.test(stdout));
  console.log('toolbar in dom:', /弹道轨迹三维重建/.test(stdout));
  console.log('--- error-ish lines ---');
  console.log(errLines.slice(0, 40).join('\n') || '(none)');
});
