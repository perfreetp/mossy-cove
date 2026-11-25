import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  },
  resolve: {
    alias: [
      { find: /manifold-3d\/manifold\.wasm\?(url|import&url)$/, replacement: root + 'tests/wasm-url-stub.ts' }
    ]
  }
});
