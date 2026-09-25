import { defineConfig } from 'vite';

// base: './' — чтобы сборка работала и на GitHub Pages (подпуть /repo/), и на собственном домене, и как один файл.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 2000,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: process.env.DEBUG_TESTS ? ['node_modules/**'] : ['tests/tmp/**', 'node_modules/**'],
  },
} as any);
