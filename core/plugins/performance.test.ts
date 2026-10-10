import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { completeManifest, minimalManifest } from '../../fixtures/plugins.ts'
import { MANIFEST_TEXT_LIMIT, parseManifest } from './manifest.ts'
import { classifyImports, violations, type FileRecord } from './startupGuard.ts'

// Opt-in audit output survives runners that suppress successful tests' stdout.
const recordBudget = (kind: string, ms: number) => {
  if (process.env.FB_MANIFEST_BUDGET_REPORT === '1') appendFileSync('.delegate/reprova-budget-metrics.jsonl', JSON.stringify({ kind, ms }) + '\n')
}

it('validates 100 complete manifests in under 50 ms, median of 20 rounds', () => {
  const input = completeManifest(), samples: number[] = []
  for (let round = 0; round < 20; round++) {
    const start = performance.now()
    for (let i = 0; i < 100; i++) { const result = parseManifest(input); if (!result.ok) throw new Error(JSON.stringify(result.errors)) }
    samples.push(performance.now() - start)
  }
  const sorted = samples.toSorted((a, b) => a - b), median = (sorted[9] + sorted[10]) / 2
  process.stdout.write(`Manifest budget: 100 complete=${median.toFixed(3)} ms; median/20\n`)
  recordBudget('100-complete-median20', median)
  expect(median).toBeLessThan(50)
})
it('rejects exactly 256 KB of hostile JSON in under 20 ms', () => {
  const json = JSON.stringify({ ...minimalManifest(), evil: Array(900).fill('x'.repeat(280)) })
  const input = json + ' '.repeat(MANIFEST_TEXT_LIMIT - Buffer.byteLength(json))
  expect(Buffer.byteLength(input)).toBe(MANIFEST_TEXT_LIMIT)
  const start = performance.now(), result = parseManifest(input), elapsed = performance.now() - start
  expect(result.ok).toBe(false)
  process.stdout.write(`Manifest budget: hostile 256 KB=${elapsed.toFixed(3)} ms\n`)
  recordBudget('hostile-256KB', elapsed)
  expect(elapsed).toBeLessThan(20)
})

const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = `${directory}/${entry.name}`
  return entry.isDirectory() ? walk(path) : /\.(?:ts|tsx)$/.test(path) && !/\.(?:test|spec)\./.test(path) ? [path] : []
})
const readFiles = (roots: string[]): FileRecord[] => roots.flatMap(walk).filter(path => !path.startsWith('core/plugins/')).map(path => ({ path, source: readFileSync(path, 'utf8') }))

it('keeps the plugin host out of every production startup module, including dynamic imports', () => {
  // The two-allowlist: the panel UI surface (`src/plugins/` + `src/views/PluginsPanel.tsx`)
  // may import `core/plugins/...` only via `import type` (erased by `tsc`); everything else
  // must reach the plugin host through `lazy(() => import(...))` or not at all.
  const files = readFiles(['src', 'electron', 'core'])
  const report = violations(files)
  expect(report, report.join('\n')).toEqual([])
})

it('extracts the guard into a pure `violations(files)` function', () => {
  // A controlled file list exercises every rule branch.
  const fixture: FileRecord[] = [
    { path: 'src/plugins/usePlugins.tsx', source: `
      import type { PluginsApi } from '@core/plugins/summary.ts'
      export function usePlugins() {}
    ` },
    { path: 'src/views/PluginsPanel.tsx', source: `
      import type { PluginSummary } from '@core/plugins/summary.ts'
      import { usePlugins } from '@/plugins/usePlugins.tsx'
      export function PluginsPanel() {}
    ` },
    { path: 'src/views/SettingsView.tsx', source: `
      const PluginsPanel = lazy(() => import('./PluginsPanel.tsx').then(m => ({ default: m.PluginsPanel })))
    ` },
    // Hostile: `electron/` is forbidden entirely.
    { path: 'electron/main.ts', source: `import { manifest } from '@core/plugins/manifest.ts'` },
    // Hostile: a static import of the panel UI from elsewhere.
    { path: 'src/main.tsx', source: `import { PluginsPanel } from '@/views/PluginsPanel.tsx'` },
    // Allowed test files: never looked at.
    { path: 'src/views/PluginsPanel.test.tsx', source: `import { manifest } from '@core/plugins/manifest.ts'` },
  ]
  const report = violations(fixture)
  expect(report).toContain('electron/main.ts: static import of \'@core/plugins/manifest.ts\' (only the panel UI may import plugins)')
  expect(report).toContain('src/main.tsx: static import of \'@/views/PluginsPanel.tsx\' (the panel UI is reached only via lazy())')
  expect(report).not.toContain('src/plugins/usePlugins.tsx')
  expect(report).not.toContain('src/views/PluginsPanel.tsx')
  expect(report).not.toContain('src/views/SettingsView.tsx')
})

it('classifies `import type` and dynamic `import()` separately from static imports', () => {
  const source = `
    import type { A } from '@core/plugins/summary.ts'
    import { usePlugins } from '@/plugins/usePlugins.tsx'
    const P = lazy(() => import('./PluginsPanel.tsx').then(m => ({ default: m.PluginsPanel })))
    import('./lazy-mod.ts')
  `
  const kinds = classifyImports(source).map(i => `${i.kind}:${i.specifier}`)
  expect(kinds).toContain('type:@core/plugins/summary.ts')
  expect(kinds).toContain('static:@/plugins/usePlugins.tsx')
  expect(kinds).toContain('dynamic:./PluginsPanel.tsx')
  expect(kinds).toContain('dynamic:./lazy-mod.ts')
})

it('flags an eagerly-imported panel UI even when it is wrapped in `React.lazy`', () => {
  // Negative mutation: removing `lazy()` and importing the panel as `static` must trip the guard.
  const fixture: FileRecord[] = [
    { path: 'src/views/SettingsView.tsx', source: `import { PluginsPanel } from './PluginsPanel.tsx'` },
  ]
  const report = violations(fixture)
  expect(report.some(line => line.includes('static import of \'./PluginsPanel.tsx\''))).toBe(true)
})

it('refuses runtime imports of the plugin host (static, dynamic, require, re-export) outside the panel UI and any but the contract inside it', () => {
  const bad: Array<[string, string]> = [
    ['electron/main.ts', "const host = await import('./plugins/host.ts')"],
    ['electron/main.ts', "const host = require('../core/plugins/package.ts')"],
    ['core/roots.ts', "export { x } from './plugins/manifest.ts'"],
    ['src/workbench/Workbench.tsx', "import { usePlugins } from '@/plugins/usePlugins.tsx'"],
    ['src/views/PluginsPanel.tsx', "import { readPackage } from '@core/plugins/package.ts'"],
    ['src/plugins/usePlugins.tsx', "import {\n  readPackage\n} from '@core/plugins/package.ts'"],
  ]
  for (const [path, source] of bad) expect(violations([{ path, source }]), `${path}: ${source}`).not.toEqual([])
  const good: Array<[string, string]> = [
    ['src/views/SettingsView.tsx', "const P = lazy(() => import('./PluginsPanel.tsx'))"],
    ['src/plugins/usePlugins.tsx', "import type { PluginsApi } from '@core/plugins/summary.ts'"],
    ['src/views/PluginsPanel.tsx', "import { usePlugins } from '@/plugins/usePlugins.tsx'"],
    ['src/workbench/Workbench.tsx', "import type {\n  PluginSummary\n} from '@core/plugins/summary.ts'"],
    ['core/api.ts', "import type { PluginsApi } from './plugins/summary.ts'"],
  ]
  for (const [path, source] of good) expect(violations([{ path, source }]), `${path}: ${source}`).toEqual([])
})
