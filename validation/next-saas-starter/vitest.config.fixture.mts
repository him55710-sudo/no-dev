import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': resolve('.') } },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['pureobom-validation/permissions.test.tsx'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
