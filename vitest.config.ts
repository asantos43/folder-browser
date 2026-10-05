import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests sit next to the code (`*.test.ts`, `*.test.tsx`); end-to-end tests are in e2e/ (Playwright).
// Component tests ask for a DOM with `// @vitest-environment happy-dom` at the top of the file.
export default defineConfig({
  resolve: {
    alias: {
      '@core': path.resolve(import.meta.dirname, './core'),
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    include: ['core/**/*.test.ts', 'electron/**/*.test.ts', 'export/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    environment: 'node',
    // A snapshot's iframe is served by the main process: in a component test it must not try to load.
    environmentOptions: { happyDOM: { settings: { disableIframePageLoading: true, handleDisabledFileLoadingAsSuccess: true } } },
    testTimeout: 30_000,
    setupFiles: ['src/test/setup.ts'],
  },
})
