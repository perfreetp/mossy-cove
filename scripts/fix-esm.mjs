// selftest 后处理：给编译产物的相对导入补 .js 扩展名（Node ESM 要求）
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = '.selftest';

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith('.js')) {
      const src = readFileSync(p, 'utf8');
      const out = src.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (m, a, spec, c) => {
        if (spec.endsWith('.js')) return m;
        return `${a}${spec}.js${c}`;
      });
      if (out !== src) writeFileSync(p, out);
    }
  }
}

walk(root);
console.log('selftest 导入扩展名补全完成');
