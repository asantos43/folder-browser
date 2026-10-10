import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
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

it('keeps contributions out of every production startup import (including transitives)', () => {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return walk(path)
    return /\.(?:ts|tsx)$/.test(path) && !/\.(?:test|spec)\./.test(path) ? [path] : []
  })
  // Stronger than checking just main.ts/main.tsx: only the gate and the new
  // install-time manifest parser may consume it. Plugins have their own startup scan.
  for (const path of ['src', 'electron', 'core'].flatMap(walk).filter(path => !path.startsWith('core/contributions/') && !path.startsWith('core/plugins/'))) {
    const source = readFileSync(path, 'utf8')
    const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1])
    expect(imports.filter(specifier => /(?:^|\/)contributions(?:\/|$)/.test(specifier)), path).toEqual([])
  }
})
