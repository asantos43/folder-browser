import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { ActivationError, activationKinds, createActivation } from './activation.ts'
import type { ActivationAdapters, ActivationContext, ActivationKind } from './activation.ts'
import type { CompiledPlugin } from './compile.ts'
import { compiledPluginSettings } from './settings.ts'
import { SettingsRegistry } from '../settings/registry.ts'
import type { SettingInput } from '../settings/registry.ts'
import { LanguageRegistry } from '../languages/registry.ts'
import { validateContribution } from '../contributions/types.ts'

function payload(owner = 'sample', generation = 'old', count = 1): CompiledPlugin {
  return {
    pluginId: owner, configuration: [{ id: `${owner}:option`, property: { type: 'string', label: 'option', default: generation } }],
    themes: Array.from({ length: count }, (_, i) => ({ id: `${owner}:theme${i}`, label: generation, base: 'light' as const, tokens: { '--color': '#fff' } })),
    languages: [{ id: `${owner}:language`, label: generation, languageId: 'javascript', extensions: ['.sample'], filenames: [] }],
    locales: [{ language: 'fr', label: generation, translations: { greeting: generation } }],
    texts: { greeting: { en: generation } }, keymaps: [], keySchemes: [], openWith: [], warnings: [],
    commands: [{ id: `${owner}:command`, title: generation, category: 'plugins', defaultKeys: [] }],
    contribution: { pluginId: owner, commands: [{ id: `${owner}:command`, title: generation, category: 'plugins' }], keys: [], menuItems: [], keymapKeys: [] },
  }
}
type Snapshot = { owner: string; compiled: CompiledPlugin; context: ActivationContext; settings: readonly SettingInput[] }
type Handles = Record<ActivationKind, Snapshot>
type Failure = { kind: ActivationKind; phase: 'prepare' | 'commit' | 'remove'; after?: boolean }
function harness() {
  const stores = Object.fromEntries(activationKinds.map(kind => [kind, new Map<string, Snapshot>()])) as Record<ActivationKind, Map<string, Snapshot>>
  const settings = new SettingsRegistry()
  const languages = new LanguageRegistry(new Set())
  const observed: string[][] = []
  const calls: string[] = []
  let publishing = false, dirty = false
  let failure: Failure | undefined
  let rollbackFailure: ActivationKind | undefined
  const view = () => activationKinds.map(kind => {
    if (kind === 'settings') return settings.all().find(entry => entry.owner?.id === 'sample')?.default as string ?? '-'
    return stores[kind].get('sample')?.compiled.themes[0]?.label ?? '-'
  })
  const changed = () => { expect(publishing).toBe(true); dirty = true }
  settings.subscribe(() => { observed.push(view()) })
  const trip = (kind: ActivationKind, phase: Failure['phase'], after = false) => {
    if (failure?.kind === kind && failure.phase === phase && !!failure.after === after) {
      failure = undefined
      throw new Error('injected failure')
    }
  }
  const adapters = {} as ActivationAdapters<Handles>
  for (const kind of activationKinds) {
    adapters[kind] = {
      prepare(owner, compiled, context) {
        calls.push(`prepare:${kind}`)
        expect(publishing).toBe(false)
        trip(kind, 'prepare')
        if (kind === 'commands') {
          const { pluginId, commands, keys, menuItems } = compiled.contribution
          validateContribution({ pluginId, commands, keys, menuItems })
        }
        if (kind === 'texts' && [...stores.texts].some(([id, item]) => id !== owner && item.compiled.locales.some(locale => compiled.locales.some(candidate => candidate.language === locale.language)))) throw new Error('Locale owned by another plugin')
        const definitions = kind === 'settings' ? compiledPluginSettings(compiled) : undefined
        const inputs = definitions?.settings.map(entry => ({ ...entry, validator: definitions.validators.get(entry.id), owner: { id: owner, enabled: context.enabled } })) ?? []
        const isolated = new SettingsRegistry()
        for (const input of inputs) isolated.defineSetting(input)
        return { owner, compiled, context, settings: inputs }
      },
      commit(handle) {
        calls.push(`commit:${kind}`)
        trip(kind, 'commit')
        if (rollbackFailure === kind && handle.compiled.themes[0]?.label === 'old') throw new Error('restore failed')
        stores[kind].set(handle.owner, handle)
        if (kind === 'settings') {
          for (const entry of settings.all()) if (entry.owner?.id === handle.owner) settings.remove(entry.id)
          for (const entry of handle.settings) settings.defineSetting(entry)
        }
        if (kind === 'languages') languages.set(handle.compiled)
        changed()
        trip(kind, 'commit', true)
      },
      remove(owner) {
        calls.push(`remove:${kind}`)
        trip(kind, 'remove')
        stores[kind].delete(owner)
        if (kind === 'settings') for (const entry of settings.all()) if (entry.owner?.id === owner) settings.remove(entry.id)
        if (kind === 'languages') languages.remove(owner)
        changed()
        trip(kind, 'remove', true)
      },
    }
  }
  adapters.publish = operation => {
    publishing = true; dirty = false
    try {
      settings.transaction(operation)
      if (dirty) observed.push(view())
    } finally { publishing = false; dirty = false }
  }
  return { activation: createActivation(adapters), adapters, stores, settings, languages, observed, calls, view,
    fail(value: Failure) { failure = value }, failRestore(kind: ActivationKind) { rollbackFailure = kind } }
}
function errorOf(operation: () => void): ActivationError {
  try { operation() } catch (error) { expect(error).toBeInstanceOf(ActivationError); return error as ActivationError }
  throw new Error('Expected activation to fail')
}

describe('owner activation transaction', () => {
  it('prepares all eight before one synchronous publication; subscribers see the complete state', () => {
    const h = harness()
    h.activation.activate('sample', payload())
    expect(h.calls.slice(0, 8)).toEqual(activationKinds.map(kind => `prepare:${kind}`))
    expect(h.view()).toEqual(Array(8).fill('old'))
    expect(h.observed).toEqual([Array(8).fill('old'), Array(8).fill('old')])
    expect(h.languages.lookup('sample')).toBe('javascript')
    expect(h.stores.commands.get('sample')?.context.disabledCommands.get('sample:command')).toBe('Command has no exec')
  })
  for (const kind of activationKinds) {
    for (const phase of ['prepare', 'commit'] as const) {
      for (const existing of [false, true]) {
        it(`${kind} ${phase} failure preserves ${existing ? 'the old' : 'empty'} generation`, () => {
          const h = harness()
          if (existing) h.activation.activate('sample', payload())
          const before = h.view(); h.calls.length = 0; h.observed.length = 0
          h.fail({ kind, phase })
          const error = errorOf(() => h.activation.update('sample', payload('sample', 'new')))
          expect(error).toMatchObject({ owner: 'sample', adapter: kind, phase, rollbackFailures: [] })
          expect(error.cause).toBeInstanceOf(Error)
          expect(h.view()).toEqual(before)
          expect(h.observed).toEqual([])
          if (phase === 'prepare') expect(h.calls.every(call => call.startsWith('prepare:'))).toBe(true)
          else expect(h.calls.filter(call => call.startsWith('remove:'))).toEqual(activationKinds.slice(0, activationKinds.indexOf(kind) + 1).reverse().map(item => `remove:${item}`))
          h.activation.update('sample', payload('sample', 'new'))
          expect(h.view()).toEqual(Array(8).fill('new'))
        })
      }
    }
    it(`${kind} add-then-throw restores the old generation without notification`, () => {
      const h = harness(); h.activation.activate('sample', payload()); h.observed.length = 0
      h.fail({ kind, phase: 'commit', after: true })
      errorOf(() => h.activation.update('sample', payload('sample', 'new')))
      expect(h.view()).toEqual(Array(8).fill('old')); expect(h.observed).toEqual([])
    })
    it(`${kind} remove-then-throw restores all touched registries`, () => {
      const h = harness(); h.activation.activate('sample', payload()); h.observed.length = 0
      h.fail({ kind, phase: 'remove', after: true })
      expect(errorOf(() => h.activation.remove('sample'))).toMatchObject({ adapter: kind, phase: 'remove' })
      expect(h.view()).toEqual(Array(8).fill('old')); expect(h.observed).toEqual([])
    })
  }
  it('keeps schemas disabled through update and supports disable-all, reenable and idempotent removal', () => {
    const h = harness()
    h.activation.activate('sample', payload(), { enabled: false })
    expect(h.view()).toEqual(['old', ...Array(7).fill('-')])
    expect(h.settings.all()[0].owner).toEqual({ id: 'sample', enabled: false })
    h.activation.update('sample', payload('sample', 'new'))
    expect(h.view()).toEqual(['new', ...Array(7).fill('-')])
    h.activation.activate('sample', payload('sample', 'new'))
    const other = payload('other'); other.locales = []
    h.activation.activate('other', other)
    for (const owner of ['sample', 'other']) h.activation.deactivate(owner)
    expect(h.settings.all()).toHaveLength(2)
    for (const kind of activationKinds.slice(1)) expect(h.stores[kind].size).toBe(0)
    h.calls.length = 0; h.observed.length = 0
    h.activation.deactivate('sample'); h.activation.deactivate('missing'); h.activation.remove('missing')
    expect(h.calls).toEqual([]); expect(h.observed).toEqual([])
    h.activation.remove('sample'); h.activation.remove('other')
    h.calls.length = 0; h.activation.remove('sample')
    expect(h.calls).toEqual([]); expect(h.settings.all()).toEqual([])
  })
  it('rejects conflicts before publication without removing another owner', () => {
    const h = harness(); h.activation.activate('sample', payload())
    h.observed.length = 0; h.calls.length = 0
    expect(errorOf(() => h.activation.activate('other', payload('other')))).toMatchObject({ adapter: 'texts', phase: 'prepare' })
    expect(h.view()).toEqual(Array(8).fill('old'))
    expect(h.observed).toEqual([]); expect(h.calls.some(call => call.startsWith('remove:'))).toBe(false)
    h.activation.remove('other'); expect(h.view()).toEqual(Array(8).fill('old'))
  })
  it('reports rollback failures and continues deterministic best-effort restoration', () => {
    const h = harness(); h.activation.activate('sample', payload())
    h.failRestore('keys'); h.fail({ kind: 'execution', phase: 'commit', after: true })
    const error = errorOf(() => h.activation.update('sample', payload('sample', 'new')))
    expect(error.rollbackFailures.map(item => item.adapter)).toEqual(['keys'])
    expect(h.view()).toEqual(['old', '-', ...Array(6).fill('old')])
  })
  it('rejects owner mismatch without touching any adapter', () => {
    const h = harness()
    expect(errorOf(() => h.activation.activate('other', payload()))).toMatchObject({ adapter: 'payload', phase: 'prepare' })
    expect(h.calls).toEqual([])
  })
  it('keeps the active generation when disable preparation fails', () => {
    const h = harness(); h.activation.activate('sample', payload()); h.observed.length = 0
    h.fail({ kind: 'execution', phase: 'prepare' })
    errorOf(() => h.activation.deactivate('sample'))
    expect(h.view()).toEqual(Array(8).fill('old')); expect(h.observed).toEqual([])
    expect(h.settings.all()[0].owner?.enabled).toBe(true)
  })
  it('validates disabled schemas and the strict gate projection before publication', () => {
    const h = harness(), invalid = payload()
    invalid.configuration[0].property.default = 123
    expect(errorOf(() => h.activation.activate('sample', invalid, { enabled: false }))).toMatchObject({ adapter: 'settings', phase: 'prepare' })
    const foreign = payload()
    Object.assign(foreign.contribution.commands[0], { id: 'other:command' })
    expect(errorOf(() => h.activation.activate('sample', foreign))).toMatchObject({ adapter: 'commands', phase: 'prepare' })
    expect(h.view()).toEqual(Array(8).fill('-')); expect(h.observed).toEqual([])
  })
  it('keeps a private generation and rejects functions instead of calling payload handlers', () => {
    const h = harness(), original = payload()
    h.activation.activate('sample', original)
    original.themes[0].label = 'tampered'
    h.activation.deactivate('sample')
    expect(h.view()[0]).toBe('old')
    const hostile = payload()
    Object.assign(hostile.commands[0], { handler: () => { throw new Error('must never run') } })
    h.calls.length = 0
    expect(errorOf(() => h.activation.update('sample', hostile))).toMatchObject({ adapter: 'payload', phase: 'prepare' })
    expect(h.calls).toEqual([])
  })
  it('enforces 500 items activate + remove below 100 ms, median of five runs', () => {
    const samples: number[] = []
    // 495 themes + schema + language + locale + command + owner text = 500.
    const compiled = payload('sample', 'old', 495)
    for (let round = 0; round < 5; round++) {
      const h = harness()
      const start = performance.now()
      h.activation.activate('sample', compiled); h.activation.remove('sample')
      samples.push(performance.now() - start)
      expect(h.settings.all()).toEqual([])
    }
    const median = samples.sort((a, b) => a - b)[2]
    console.info(`activation: 500 items activate/remove median ${median.toFixed(3)} ms`)
    expect(median).toBeLessThan(100)
  })
})
