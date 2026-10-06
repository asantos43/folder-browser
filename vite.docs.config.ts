import path from 'node:path'
import { defineConfig } from 'vite'

/**
 * Builds the scripts that draw office documents (`src/docs/`): one script per library (`--mode docx|pptx|odf`), each a single classic script with the library inside, into
 * `dist/docs/`. They are loaded by the page of a document (`fb-doc://<token>/`, core/docs.ts), a sandboxed frame with no network, never by the interface itself.
 * The OpenDocument one carries its WebAssembly inside (the library names it with `new URL(…)`, which a library build inlines as a data address): one file, nothing to fetch.
 */
export default defineConfig(({ mode }) => ({
  publicDir: false,
  logLevel: 'error',
  resolve: { alias: { '@core': path.resolve(import.meta.dirname, './core') } },
  // odr-core finds its WebAssembly with `new URL(…, import.meta.url)`, and a classic script has no `import.meta`: any address that is valid will do for the base of its data address.
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.url': '"fb-doc://document/odf.js"' },
  build: {
    outDir: 'dist/docs',
    emptyOutDir: false,
    target: 'chrome152',
    chunkSizeWarningLimit: 6000,
    lib: { entry: path.resolve(import.meta.dirname, `src/docs/${mode}.ts`), formats: ['iife'], name: `FbDoc_${mode}`, fileName: () => `${mode}.js` },
  },
}))
