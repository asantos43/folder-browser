import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * pdf.js reads its character maps, the standard fonts, colour profiles and WebAssembly decoders from files. They are copied
 * into the build (`dist/pdfjs/`) so a PDF shows the same with no network, and the interface's own policy is all it needs.
 * Its scripting engine (`quickjs-eval`) is left out: nothing of a PDF runs.
 */
const pdfjsData = (): Plugin => ({
  name: 'wsnp-pdfjs-data',
  apply: 'build',
  writeBundle(options) {
    const from = path.resolve(import.meta.dirname, 'node_modules/pdfjs-dist')
    const to = path.resolve(import.meta.dirname, options.dir ?? 'dist', 'pdfjs')
    for (const folder of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) {
      fs.cpSync(path.join(from, folder), path.join(to, folder), { recursive: true, filter: (source) => !/quickjs|nowasm_fallback/.test(source) })
    }
  },
})

// Builds the interface (the renderer) into dist/. The main process is built by vite.electron.config.ts.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), pdfjsData()],
  resolve: {
    alias: {
      '@core': path.resolve(import.meta.dirname, './core'),
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // The interface is loaded from disk, so its size (React, CodeMirror and its languages) costs no download: no chunk warning.
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome152', chunkSizeWarningLimit: 1500 },
})
