import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { posix } from 'node:path'
import { classifyImports } from '../plugins/startupGuard.ts'
import { applyContribution, removeContribution } from './apply.ts'
import type { Contribution } from './contract.ts'
import { realRegistries } from './fixtures.ts'

it('applies and removes 500 items under 100 ms (median of 20)', () => {
  // 150 commands + 50 keys + 150 options + 150 menu items = exactly 500.
  const plugin: Contribution = { pluginId: 'budget',
    commands: Array.from({ length: 150 }, (_, i) => ({ id: `budget:c${i}`, title: 'command', category: 'tools' })),
    keys: Array.from({ length: 50 }, (_, i) => ({ command: `budget:c${i}`, key: `Ctrl+Alt+Shift+${String.fromCharCode(33 + i) === '+' ? 'Plus' : String.fromCharCode(33 + i)}` })),
    settings: Array.from({ length: 150 }, (_, i) => ({ id: `budget:s${i}`, type: 'boolean', default: true, category: 'tools', label: null })),
    menuItems: Array.from({ length: 150 }, (_, i) => ({ id: `budget:m${i}`, command: `budget:c${i}`, point: 'menubar/tools', group: 'tools', order: i })),
  }
  expect(Object.values(plugin).filter(Array.isArray).reduce((sum, items) => sum + items.length, 0)).toBe(500)
  const r = realRegistries(plugin), apply: number[] = [], remove: number[] = []
  for (let i = 0; i < 20; i++) {
    let start = performance.now(); applyContribution(r, plugin); apply.push(performance.now() - start)
    expect(r.commands.list().filter(command => command.id.startsWith('budget:'))).toHaveLength(150)
    expect(r.settings.all().filter(setting => setting.id.startsWith('budget:'))).toHaveLength(150)
    expect(r.menus.at('menubar/tools')).toHaveLength(150)
    start = performance.now(); removeContribution(r, plugin.pluginId); remove.push(performance.now() - start)
  }
  const median = (samples: number[]) => { const sorted = samples.toSorted((a, b) => a - b); return (sorted[9] + sorted[10]) / 2 }
  const applied = median(apply), removed = median(remove)
  console.info(`S8 budget: apply=${applied.toFixed(3)} ms, remove=${removed.toFixed(3)} ms; 500 items, median/20`)
  expect(applied).toBeLessThan(100); expect(removed).toBeLessThan(100)
})

// These exact files belong to the host shell loaded after the window is ready.
// No other Electron/startup consumer gains access to the contribution package.
const contributionImports = (path: string, source: string): string[] => classifyImports(source).filter(({ specifier, kind }) => {
  const target = specifier.startsWith('@core/') ? `core/${specifier.slice(6)}`
    : specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(path), specifier)) : specifier
  if (!/(?:^|\/)contributions(?:\/|$)/.test(target)) return false
  if (target.startsWith('core/contributions/')) {
    if (path === 'electron/plugins-host.ts' || path === 'electron/plugins-adapters.ts') return false
    if (path === 'src/plugins/contributions.ts' && kind === 'type') return false
  }
  return true
}).map(({ specifier }) => specifier)

it('keeps contributions out of every production startup import (including transitives)', () => {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return walk(path)
    return /\.(?:ts|tsx)$/.test(path) && !/\.(?:test|spec)\./.test(path) ? [path] : []
  })
  // Scan transitives too; only the exact lazy host files may consume the package.
  // Plugins have their own startup scan, including the renderer store's imports.
  for (const path of ['src', 'electron', 'core'].flatMap(walk).filter(path => !path.startsWith('core/contributions/') && !path.startsWith('core/plugins/'))) {
    const source = readFileSync(path, 'utf8')
    expect(contributionImports(path, source), path).toEqual([])
  }
})

it('allows only the exact lazy host files to import the core contribution package', () => {
  for (const path of ['electron/plugins-host.ts', 'electron/plugins-adapters.ts']) {
    for (const specifier of ['../core/contributions/menus.ts', '@core/contributions/apply.ts']) {
      expect(contributionImports(path, `import { value } from '${specifier}'`)).toEqual([])
    }
  }
  expect(contributionImports('src/plugins/contributions.ts', "import type { Contribution } from '@core/contributions/contract.ts'")).toEqual([])
  for (const path of ['electron/main.ts', 'electron/plugins-host-other.ts', 'src/main.tsx', 'src/views/Foo.tsx', 'src/plugins/contributions.ts']) {
    for (const source of [
      "import { value } from '@core/contributions/menus.ts'",
      "import('../core/contributions/menus.ts')",
      "require('@core/contributions/menus.ts')",
      "export { value } from '@core/contributions/menus.ts'",
    ]) expect(contributionImports(path, source), `${path}: ${source}`).not.toEqual([])
  }
})
