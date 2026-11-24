import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  optimizeDeps: {
    exclude: ['manifold-3d']
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600
  },
  server: {
    port: 5173,
    strictPort: false
  }
});
