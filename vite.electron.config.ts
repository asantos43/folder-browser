import { defineConfig } from 'vite'

// Builds the Electron main process into dist-electron/ as CommonJS. Dependencies are bundled
// (only `electron` stays external) so the packaged app does not need node_modules.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: true,
    outDir: 'dist-electron',
    emptyOutDir: true,
    target: 'node24',
    rolldownOptions: {
      input: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: '[name].cjs' },
    },
  },
  ssr: { noExternal: true },
})
