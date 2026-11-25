import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// manifold.wasm 以 ?url 方式引用,依赖预构建排除即可
export default defineConfig({
  plugins: [svelte()],
  optimizeDeps: { exclude: ['manifold-3d'] },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500
  }
});
