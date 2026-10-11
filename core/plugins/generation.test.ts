import { describe, expect, it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { activationPlugin } from '../../fixtures/plugin-activation.ts'
import { createGenerationStore } from './generation.ts'
import type { ActivationContext } from './activation.ts'

const enabled: ActivationContext = { enabled: true, disabledCommands: new Map() }
describe('renderer generation', () => {
  it('stages detached immutable data, projects all types, and never leaks execution data', () => {
    const store = createGenerationStore(), source = activationPlugin()
    const initial = store.snapshot(), handle = store.stage('sample', source, enabled)
    expect(store.snapshot()).toBe(initial)
    source.themes[0].label = 'caller edit'
    expect(Object.isFrozen(handle)).toBe(true)
    expect(Object.isFrozen(handle.plugin.themes[0].tokens)).toBe(true)
    expect(Object.isFrozen(handle.definitions[0].owner)).toBe(true)
    store.commit(handle)
    const snapshot = store.snapshot(), plugin = snapshot.plugins[0]
    expect(snapshot.version).toBe(1)
    expect(plugin.themes[0].label).toBe('old')
    expect(plugin.locales).toHaveLength(1)
    expect(plugin.texts.greeting.en).toBe('old')
    expect(plugin.languages).toHaveLength(1)
    expect(plugin.settings).toHaveLength(1)
    expect(plugin.menuItems).toHaveLength(1)
    expect(plugin.keySchemes).toHaveLength(1)
    expect(plugin.keyEntries).toHaveLength(2)
    expect(plugin.commands[0].enabled).toBe(true)
    expect(plugin.commands[1]).toMatchObject({ enabled: false, disabledReason: 'Command has no exec' })
    const visit = (value: unknown): void => {
      expect(typeof value).not.toBe('function')
      if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
        expect(['exec', 'program', 'args', 'keymapKeys', 'validator', 'path']).not.toContain(key)
        visit(child)
      }
    }
    visit(snapshot)
    expect(JSON.stringify(snapshot)).not.toContain('fixture-private-program')
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    expect(store.snapshot()).toBe(snapshot)
    store.commit(handle)
    expect(store.snapshot()).toBe(snapshot)
    store.commit(store.stage('sample', activationPlugin('sample', 'new'), enabled))
    expect(store.snapshot().version).toBe(2)
    store.remove('sample')
    expect(store.snapshot().version).toBe(3)
    const empty = store.snapshot(); store.remove('sample'); expect(store.snapshot()).toBe(empty)
  })
  it('retains disabled definitions and validates inactive contributions', () => {
    const store = createGenerationStore()
    store.commit(store.stage('sample', activationPlugin(), { ...enabled, enabled: false }))
    const plugin = store.snapshot().plugins[0]
    expect(plugin.settings[0].owner).toEqual({ id: 'sample', enabled: false })
    expect(plugin.themes).toEqual([]); expect(plugin.commands).toEqual([])
    const bad = activationPlugin(); bad.themes[0].tokens = { fg: 'url(/private)' }
    expect(() => store.stage('sample', bad, { ...enabled, enabled: false })).toThrow('Invalid theme token')
  })
  it('rejects aggregate oversize in staging and rechecks staged candidates at commit', () => {
    const sizing = createGenerationStore()
    const limit = sizing.stage('first', activationPlugin('first'), enabled).bytes + sizing.stage('second', activationPlugin('second'), enabled).bytes + 65
    const store = createGenerationStore({ bytes: limit })
    const first = store.stage('first', activationPlugin('first'), enabled)
    const second = store.stage('second', activationPlugin('second'), enabled)
    store.commit(first)
    const before = store.snapshot()
    expect(() => store.commit(second)).toThrow('byte limit')
    expect(store.snapshot()).toBe(before)
    expect(() => store.stage('second', activationPlugin('second'), enabled)).toThrow('byte limit')
  })
  it('refuses locale conflicts, foreign owners, functions and forged handles without live mutations', () => {
    const store = createGenerationStore(), a = activationPlugin('a'), b = activationPlugin('b')
    store.commit(store.stage('a', a, enabled))
    const before = store.snapshot()
    b.locales = a.locales
    expect(() => store.stage('b', b, enabled)).toThrow('Locale owned')
    expect(() => store.stage('b', a, enabled)).toThrow('owner mismatch')
    const bad = activationPlugin('b'); bad.themes[0].tokens = { fg: (() => 'red') as unknown as string }
    expect(() => store.stage('b', bad, enabled)).toThrow()
    expect(() => store.commit({} as never)).toThrow('Foreign generation handle')
    expect(store.snapshot()).toBe(before)
  })
  it('discards callbacks and restores snapshot reference and version if the publication fails', () => {
    const store = createGenerationStore()
    store.commit(store.stage('sample', activationPlugin(), enabled))
    const before = store.snapshot(), observed: unknown[] = []
    store.subscribe(() => observed.push(store.snapshot()))
    expect(() => store.transaction(() => {
      store.remove('sample')
      store.commit(store.stage('sample', activationPlugin('sample', 'new'), enabled))
      throw new Error('injected')
    })).toThrow('injected')
    expect(store.snapshot()).toBe(before); expect(observed).toEqual([])
  })
  it('enforces the 50-owner snapshot, cached-reference and heap budgets', () => {
    // Renderer-generation budget, independent of the existing 100-entry run catalog.
    const baseline = process.memoryUsage().heapUsed
    let peak = baseline
    const store = createGenerationStore()
    store.transaction(() => {
      for (let index = 0; index < 50; index++) {
        const owner = `p${index}`
        store.commit(store.stage(owner, activationPlugin(owner, 'budget', { options: 20, commands: 10, themes: 5, locales: 3, localeKeys: 50 }), enabled))
        peak = Math.max(peak, process.memoryUsage().heapUsed)
      }
    })
    const start = performance.now(), snapshot = store.snapshot(), snapshotMs = performance.now() - start
    const second = performance.now(), cached = store.snapshot(), cachedMs = performance.now() - second
    peak = Math.max(peak, process.memoryUsage().heapUsed)
    const heapMiB = (peak - baseline) / 1024 / 1024
    expect(snapshot.plugins).toHaveLength(50)
    expect(snapshot.version).toBe(50)
    expect(snapshotMs).toBeLessThan(20)
    expect(cachedMs).toBeLessThan(0.1)
    expect(cached).toBe(snapshot)
    expect(heapMiB).toBeLessThan(40)
    appendFileSync('.delegate/passo-270.metrics.jsonl', JSON.stringify({ kind: 'generation-50', snapshotMs, cachedMs, heapMiB }) + '\n')
  })
})
