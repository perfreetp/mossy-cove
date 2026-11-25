import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // svelte.config.js 中的 vitePreprocess 会被插件自动加载
  plugins: [svelte()],
  server: {
    port: 5173,
    open: false
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600
  }
});
