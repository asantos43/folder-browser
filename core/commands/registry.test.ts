import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry.ts'
import { builtinCommands } from './builtin.ts'

describe('command registry', () => {
  it('rejects duplicates and malformed plugin namespaces', () => {
    const registry = createRegistry()
    registry.register({ id: 'save', title: 'menu.save', category: 'file' })
    expect(() => registry.register({ id: 'save', title: 'menu.save', category: 'file' })).toThrow(/already registered/)
    for (const id of [':save', 'acme:', 'acme:thing:else']) expect(() => registry.register({ id, title: 'title', category: 'x' })).toThrow(/Plugin command id/)
    registry.register({ id: 'acme:save', title: 'title', category: 'x' })
  })

  it('gets by id, unregisters, and filters availability with compiled when clauses', () => {
    const registry = createRegistry()
    registry.register({ id: 'edit', title: 'edit', category: 'file', when: "editor && mode == 'text'" })
    registry.register({ id: 'always', title: 'always', category: 'file' })
    expect(registry.get('edit')?.id).toBe('edit')
    expect(registry.available({ editor: true, mode: 'text' }).map((command) => command.id)).toEqual(['edit', 'always'])
    expect(registry.available({ editor: false, mode: 'text' }).map((command) => command.id)).toEqual(['always'])
    expect(registry.unregister('edit')).toBe(true)
    expect(registry.unregister('edit')).toBe(false)
    expect(registry.get('edit')).toBeUndefined()
  })

  it('meets the construction and availability budgets (median of 20)', () => {
    const sampleMedian = (run: () => void): number => {
      const samples = Array.from({ length: 20 }, () => {
        const start = performance.now(); run(); return performance.now() - start
      }).sort((a, b) => a - b)
      return (samples[9] + samples[10]) / 2
    }
    const hundred = sampleMedian(() => {
      const registry = createRegistry()
      for (let i = 0; i < 100; i++) registry.register({ id: `cmd${i}`, title: 'title', category: 'test', when: 'enabled' })
    })
    const today = sampleMedian(() => {
      const registry = createRegistry()
      for (const command of builtinCommands) registry.register(command)
    })
    const many = createRegistry()
    for (let i = 0; i < 500; i++) many.register({ id: `many${i}`, title: 'title', category: 'test', when: 'enabled' })
    const available = sampleMedian(() => { many.available({ enabled: true }) })
    console.info(`registry median (20): 100=${hundred.toFixed(3)} ms, today=${today.toFixed(3)} ms, available500=${available.toFixed(3)} ms`)
    expect(hundred).toBeLessThan(1)
    expect(today).toBeLessThan(2)
    expect(available).toBeLessThan(2)
  })
})
