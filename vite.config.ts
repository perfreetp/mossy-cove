import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2000,
  },
  server: {
    watch: {
      // 测试产物与浏览器 profile 不纳入监视，避免 Windows 上锁定文件触发 EBUSY
      ignored: ['**/scripts/smoke-out/**', '**/dist/**'],
    },
  },
});
