import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    host: '127.0.0.1',
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
});
