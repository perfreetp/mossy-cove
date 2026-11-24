import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  server: {
    host: '127.0.0.1',
  },
});
