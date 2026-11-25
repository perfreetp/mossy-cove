import { defineConfig } from 'vite';

// 基础使用相对路径，构建产物可以放在任意静态目录 / 子路径下
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
