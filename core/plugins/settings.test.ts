import { readdirSync, readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { minimalManifest } from '../../fixtures/plugins.ts'
import { SettingsRegistry } from '../settings/registry.ts'
import { SettingsStore } from '../settings/store.ts'
import { applyImport, exportSettings, previewImport } from '../settings/portable.ts'
import type { ConfigurationProperty, PluginManifest } from './manifest.ts'
import { compileConfiguration, installPluginSettings, purgePluginSettings, readPluginSettings, reconcileOnUpdate, removePluginSettings, resetPluginSettings, writePluginSetting } from './settings.ts'

type Property = ConfigurationProperty & { reaches?: boolean }
const boolean: Property = { type: 'boolean', default: false, label: 'setting.label' }
function manifest(properties: Record<string, Property> = { enabled: boolean }, id = 'acme.sample'): PluginManifest {
  return { ...minimalManifest(), id, uses: [], schema: 1, hasCode: false, engines: { folderBrowser: '*', api: 1 }, contributes: { configuration: { title: 'settings.title', properties } } }
}
function setup(properties?: Record<string, Property>) {
  const registry = new SettingsRegistry(), writer = vi.fn(async (_contents: string) => {})
  installPluginSettings(registry, manifest(properties))
  const store = new SettingsStore(registry, writer)
  return { registry, store, writer }
}
const cases: Array<[string, Property, unknown[], unknown[]]> = [
  ['boolean', boolean, [true, false], [0, 'true', null]],
  ['enum', { type: 'enum', default: 'a', label: 'l', values: ['a', 'b'], valueLabels: ['locale.a', 'locale.b'] }, ['a', 'b'], ['c', 1]],
  ['number', { type: 'number', default: 1, label: 'l', min: 1, max: 3, step: 0.5 }, [1, 1.5, 3], [0.5, 3.5, 1.1, NaN, Infinity, '1']],
  ['string', { type: 'string', default: '', label: 'l', maxLength: 4 }, ['', 'abcd', 'éé'], ['abcde', 'ééé', 4]],
  ['colour', { type: 'colour', default: '', label: 'l' }, ['', '#12abEF'], ['#abc', '#12345g', 'red', 0]],
  ['list', { type: 'list', default: [], label: 'l', maxItems: 2 }, [[], ['a', 'b']], [['a', 'b', 'c'], [1], ['é'.repeat(2049)], Array(1), 'a']],
]
it.each(cases)('compiles and validates %s including its limits', (_name, property, good, bad) => {
  const { registry } = setup({ value: property })
  for (const value of good) expect(registry.validate('acme.sample:value', value)).toBe(true)
  for (const value of bad) expect(registry.validate('acme.sample:value', value)).toBe(false)
})
it('preserves locale and UI metadata and confines category and full ids', () => {
  const property = { ...boolean, description: '<b>locale.key</b>', group: 'app', order: 3, enabledWhen: 'enabled == true', keywords: ['search'], reload: true, sensitive: true }
  expect(compileConfiguration(manifest({ 'acme.sample:enabled': property }))[0]).toMatchObject({ id: 'acme.sample:enabled', category: 'plugins.acme.sample', categoryLabel: 'settings.title', label: 'setting.label', description: '<b>locale.key</b>', group: 'app', order: 3, enabledWhen: 'enabled == true', keywords: ['search'], restart: true, safety: false })
  expect(compileConfiguration(manifest({ choice: cases[1][1] }))[0]).toMatchObject({ type: 'choice', choices: ['a', 'b'], choiceLabels: ['locale.a', 'locale.b'] })
  expect(() => compileConfiguration(manifest({ 'other:enabled': boolean }))).toThrow()
})
it.each(['__proto__', 'constructor', 'prototype'])('refuses forbidden key %s without prototype mutation', key => {
  expect(() => compileConfiguration(manifest({ [key]: boolean }))).toThrow()
  const { registry, store } = setup()
  expect(writePluginSetting(registry, store, 'acme.sample', key, true)).toEqual({ ok: false, code: 'settings.key.unknown' })
  const preview = previewImport(JSON.stringify({ [`acme.sample:${key}`]: true }), registry, store)
  expect(preview.changes[0].reason).toBe('Unknown setting')
  expect(Object.getPrototypeOf(readPluginSettings(registry, store, 'acme.sample').values)).toBe(null)
})
it('rechecks property, byte and list caps even without parsing a manifest', () => {
  expect(() => compileConfiguration(manifest(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`p${i}`, boolean]))))).toThrow()
  for (const property of [ { type: 'string', default: '', maxLength: 4097 }, { type: 'list', default: [], maxItems: 1001 }, { type: 'number', default: 1, step: 0 }, { type: 'number', default: 1, min: 3, max: 2 } ]) expect(() => compileConfiguration(manifest({ value: { label: 'l', ...property } as Property }))).toThrow()
  const { registry } = setup({ text: { type: 'string', default: '', label: 'l' }, list: { type: 'list', default: [], label: 'l' } })
  expect(registry.validate('acme.sample:text', 'x'.repeat(4096))).toBe(true)
  expect(registry.validate('acme.sample:text', 'é'.repeat(2049))).toBe(false)
  expect(registry.validate('acme.sample:list', Array(1000).fill('x'))).toBe(true)
  expect(registry.validate('acme.sample:list', Array(1001).fill('x'))).toBe(false)
  expect(registry.validate('acme.sample:list', ['x'.repeat(4097)])).toBe(false)
})
it('rolls back a defect in the middle and never changes application or another plugin', () => {
  const r = new SettingsRegistry()
  r.defineSetting({ id: 'app.enabled', type: 'boolean', default: true, category: 'app', label: null })
  installPluginSettings(r, manifest(undefined, 'other'))
  const before = r.all(), version = r.version(), listener = vi.fn(); r.subscribe(listener)
  expect(() => installPluginSettings(r, manifest({ first: boolean, 'invalid key': boolean, last: boolean }))).toThrow()
  expect(r.all()).toEqual(before); expect(r.version()).toBe(version); expect(listener).not.toHaveBeenCalled()
  expect(() => installPluginSettings(r, manifest({ first: boolean, bad: { ...boolean, default: 2 } }))).toThrow()
  expect(r.all()).toEqual(before)
  const undo = installPluginSettings(r, manifest()); undo(); undo()
  expect(r.all()).toEqual(before)
})
it.each(cases)('resets stored invalid %s with a stable notice', (_name, property, _good, bad) => {
  const { registry, store } = setup({ value: property })
  store.load(JSON.stringify({ plugins: { 'acme.sample': { value: bad[0], unknown: 1 } } }))
  expect(readPluginSettings(registry, store, 'acme.sample')).toEqual({ values: { value: property.default }, notices: [{ key: 'value', code: 'settings.value.reset' }] })
})
it('migrates renamedFrom once, prefers the new key, and discards unknown keys', async () => {
  const { registry, store, writer } = setup({ enabled: { ...boolean, renamedFrom: 'old' } })
  store.load('{"plugins":{"acme.sample":{"old":true,"unknown":1}}}')
  expect(readPluginSettings(registry, store, 'acme.sample').values.enabled).toBe(true)
  store.set('acme.sample:enabled', false); store.set('acme.sample:enabled', true); await store.flush()
  expect(JSON.parse(writer.mock.calls.at(-1)![0])).toEqual({ plugins: { 'acme.sample': { enabled: true } } })
  store.load('{"plugins":{"acme.sample":{"old":true,"enabled":false}}}')
  expect(readPluginSettings(registry, store, 'acme.sample').values.enabled).toBe(false)
  store.load('{}'); expect(store.get('acme.sample:enabled')).toBe(false)
})
it('hydrates after installation and resets a changed type, with cache invalidation', () => {
  const registry = new SettingsRegistry(), store = new SettingsStore(registry, async () => {})
  store.load('{"plugins":{"acme.sample":{"old":true,"unknown":2}}}')
  installPluginSettings(registry, manifest({ enabled: { ...boolean, renamedFrom: 'old' } }))
  const first = readPluginSettings(registry, store, 'acme.sample')
  expect(first.values.enabled).toBe(true)
  expect(readPluginSettings(registry, store, 'acme.sample')).toBe(first)
  removePluginSettings(registry, 'acme.sample')
  installPluginSettings(registry, manifest({ enabled: { type: 'string', default: 'new', label: 'l' } }))
  expect(readPluginSettings(registry, store, 'acme.sample')).toEqual({ values: { enabled: 'new' }, notices: [{ key: 'enabled', code: 'settings.value.reset' }] })
})
it('resets a changed type even when the old value fits the new enum', () => {
  const { registry, store } = setup()
  store.set('acme.sample:enabled', true)
  removePluginSettings(registry, 'acme.sample')
  installPluginSettings(registry, manifest({ enabled: { type: 'enum', default: false, values: [true, false], valueLabels: ['yes', 'no'], label: 'l' } }))
  expect(readPluginSettings(registry, store, 'acme.sample')).toEqual({ values: { enabled: false }, notices: [{ key: 'enabled', code: 'settings.value.reset' }] })
  expect(store.get('acme.sample:enabled')).toBe(false)
})
it('refuses invalid writes without writing and resets one/all without touching other owners', async () => {
  const { registry, store, writer } = setup({ enabled: boolean, second: boolean })
  installPluginSettings(registry, manifest(undefined, 'other'))
  expect(writePluginSetting(registry, store, 'acme.sample', 'enabled', 1)).toEqual({ ok: false, code: 'settings.value.invalid' })
  expect(writePluginSetting(registry, store, 'acme.sample', 'other:enabled', true).ok).toBe(false)
  expect(writePluginSetting(registry, store, 'acme.sample', 'missing', true).ok).toBe(false)
  await store.flush(); expect(writer).not.toHaveBeenCalled()
  for (const key of ['enabled', 'second']) expect(writePluginSetting(registry, store, 'acme.sample', key, true)).toEqual({ ok: true })
  store.set('other:enabled', true)
  resetPluginSettings(registry, store, 'acme.sample', 'enabled')
  expect(readPluginSettings(registry, store, 'acme.sample').values).toEqual({ enabled: false, second: true })
  resetPluginSettings(registry, store, 'acme.sample')
  expect(readPluginSettings(registry, store, 'acme.sample').values).toEqual({ enabled: false, second: false })
  expect(store.get('other:enabled')).toBe(true)
  expect(() => resetPluginSettings(registry, store, 'acme.sample', 'other:enabled')).toThrow()
})
it('removes registry entries and retains or purges persisted data, also after removal', async () => {
  const { registry, store, writer } = setup()
  store.set('acme.sample:enabled', true)
  removePluginSettings(registry, 'acme.sample'); removePluginSettings(registry, 'acme.sample')
  expect(registry.all()).toEqual([])
  await store.flush(); expect(JSON.parse(writer.mock.calls.at(-1)![0])).toEqual({ plugins: { 'acme.sample': { enabled: true } } })
  expect(JSON.parse(exportSettings(store))).toEqual({})
  purgePluginSettings(store, 'acme.sample'); await store.flush()
  expect(JSON.parse(writer.mock.calls.at(-1)![0])).toEqual({})
  store.load('{"plugins":{"removed":{"x":1},"keep":{"x":2}}}')
  purgePluginSettings(store, 'removed'); await store.flush()
  expect(JSON.parse(writer.mock.calls.at(-1)![0])).toEqual({ plugins: { keep: { x: 2 } } })
})
it('exports/imports only declared valid values and requires confirmation for reaches', async () => {
  const { registry, store } = setup({ enabled: boolean, reach: { ...boolean, reaches: true } })
  const preview = previewImport('{"acme.sample:enabled":true,"acme.sample:reach":true,"acme.sample:missing":3}', registry, store)
  expect(preview.needsConfirmation.map(c => c.id)).toEqual(['acme.sample:reach'])
  await expect(applyImport(preview, store)).rejects.toThrow(/Confirmation/)
  expect(store.get('acme.sample:enabled')).toBe(false)
  await applyImport(preview, store, true)
  expect(JSON.parse(exportSettings(store))).toEqual({ 'acme.sample:enabled': true, 'acme.sample:reach': true })
  const invalid = previewImport('{"acme.sample:enabled":"true"}', registry, store)
  expect(invalid.changes[0].reason).toBe('Invalid value')
  await applyImport(invalid, store); expect(store.get('acme.sample:enabled')).toBe(true)
  const sameReach = previewImport('{"acme.sample:reach":true}', registry, store)
  expect(sameReach.needsConfirmation).toHaveLength(1)
})
it('reconciles additions, removals, renames, type changes and reaches changes', () => {
  const old = manifest({ old: boolean, count: { type: 'number', default: 1, label: 'l' }, reach: { type: 'enum', default: 'a', values: ['a', 'b'], valueLabels: ['a', 'b'], label: 'l', reaches: true } })
  const next = manifest({ enabled: { ...boolean, renamedFrom: 'old' }, count: { type: 'string', default: 'new', label: 'l' }, added: boolean, reach: { ...old.contributes.configuration!.properties.reach, default: 'b', reaches: true } })
  expect(reconcileOnUpdate(old, next, { old: true, count: 2, reach: 'a', unknown: 4 })).toEqual({ values: { enabled: true, count: 'new', added: false }, needsConfirmation: { reach: 'a' } })
  expect(reconcileOnUpdate(old, old, { reach: 'b' }).values.reach).toBe('b')
  const changedAllowed = manifest({ reach: { ...old.contributes.configuration!.properties.reach, values: ['a', 'c'], reaches: true } })
  expect(reconcileOnUpdate(old, changedAllowed, { reach: 'a' }).needsConfirmation).toEqual({ reach: 'a' })
  expect(() => reconcileOnUpdate(old, manifest(undefined, 'other'), {})).toThrow()
})
it('keeps cached lists immutable and protects validators from source mutation', () => {
  const property: Property = { type: 'enum', default: 'a', label: 'l', values: ['a'], valueLabels: ['a'] }
  const { registry } = setup({ choice: property })
  property.values!.push('b'); expect(registry.validate('acme.sample:choice', 'b')).toBe(false)
  const s = setup({ items: { type: 'list', default: [], label: 'l' } }), items = ['x']
  writePluginSetting(s.registry, s.store, 'acme.sample', 'items', items); items.push('changed')
  const read = readPluginSettings(s.registry, s.store, 'acme.sample')
  expect(read.values.items).toEqual(['x']); expect(Object.isFrozen(read.values.items)).toBe(true)
})
it('persists rename repairs immediately and drops removed options after an update', async () => {
  const { registry, store, writer } = setup({ enabled: { ...boolean, renamedFrom: 'old' }, removed: boolean })
  store.load('{"plugins":{"acme.sample":{"old":true,"removed":true}}}')
  await store.flush()
  expect(JSON.parse(writer.mock.calls.at(-1)![0])).toEqual({ plugins: { 'acme.sample': { enabled: true, removed: true } } })
  removePluginSettings(registry, 'acme.sample'); installPluginSettings(registry, manifest())
  expect(readPluginSettings(registry, store, 'acme.sample').values).toEqual({ enabled: true })
  await store.flush()
  expect(JSON.parse(writer.mock.calls.at(-1)![0])).toEqual({ plugins: { 'acme.sample': { enabled: true } } })
})
it('meets install, read and cached-read budgets (median of 20)', () => {
  const median = (runs: number[]) => runs.sort((a, b) => a - b)[10]
  const installs: number[] = [], reads: number[] = [], cached: number[] = []
  const properties = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, boolean]))
  for (let run = 0; run < 20; run++) {
    const registry = new SettingsRegistry(), start = performance.now()
    for (let i = 0; i < 50; i++) installPluginSettings(registry, manifest(properties, `bench.p${i}`))
    installs.push(performance.now() - start)
    const s = setup(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, boolean])))
    const readStart = performance.now(); readPluginSettings(s.registry, s.store, 'acme.sample'); reads.push(performance.now() - readStart)
    const cachedStart = performance.now(); for (let i = 0; i < 1000; i++) readPluginSettings(s.registry, s.store, 'acme.sample'); cached.push((performance.now() - cachedStart) / 1000)
  }
  const numbers = { installMs: median(installs), readMs: median(reads), cachedMs: median(cached) }
  process.stdout.write(`Plugin settings budgets: ${JSON.stringify(numbers)}\n`)
  expect(numbers.installMs).toBeLessThan(30); expect(numbers.readMs).toBeLessThan(5); expect(numbers.cachedMs).toBeLessThan(0.05)
})
it('keeps settings compilation out of production startup with only a pure shared helper', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`])
  const module = readFileSync('core/plugins/settings.ts', 'utf8')
  expect(module.split('\n').filter(line => line.startsWith('import ') && !line.startsWith('import type '))).toEqual(["import { reconcileSettings } from '../settings/reconcile.ts'"])
  const helper = readFileSync('core/settings/reconcile.ts', 'utf8')
  expect(helper.split('\n').filter(line => line.startsWith('import ')).every(line => line.startsWith('import type '))).toBe(true)
  for (const path of ['core', 'electron', 'src'].flatMap(walk).filter(p => /\.[cm]?[jt]sx?$/.test(p) && !p.includes('/plugins/') && !/\.test\./.test(p))) {
    const imports = [...readFileSync(path, 'utf8').matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1])
    expect(imports.filter(i => /(?:^|\/)plugins\/settings(?:\.|$)/.test(i)), path).toEqual([])
  }
})

it('P1 flush revalidates current declarations without a prior plugin read', async () => {
  const { registry, store, writer } = setup({ enabled: boolean, other: boolean })
  store.set('acme.sample:enabled', true); await store.flush()
  removePluginSettings(registry, 'acme.sample')
  installPluginSettings(registry, manifest({ enabled: { type: 'string', default: 'new', label: 'l' }, other: boolean }))
  store.set('acme.sample:other', true); await store.flush()
  expect(JSON.parse(writer.mock.calls.at(-1)![0])).toEqual({ plugins: { 'acme.sample': { other: true } } })
  expect(store.get('acme.sample:enabled')).toBe('new')
  expect(store.getNotices()).toContainEqual({ id: 'acme.sample:enabled', message: expect.stringContaining('default restored') })
  removePluginSettings(registry, 'acme.sample')
  installPluginSettings(registry, manifest({ enabled: boolean, other: boolean }))
  await store.flush()
  expect(store.get('acme.sample:enabled')).toBe(false)
  // Same type, narrower range is also revalidated at the write boundary.
  removePluginSettings(registry, 'acme.sample')
  installPluginSettings(registry, manifest({ count: { type: 'number', default: 1, max: 10, label: 'l' }, other: boolean }))
  store.set('acme.sample:count', 8); await store.flush()
  removePluginSettings(registry, 'acme.sample')
  installPluginSettings(registry, manifest({ count: { type: 'number', default: 1, max: 2, label: 'l' }, other: boolean }))
  store.set('acme.sample:other', false); await store.flush()
  expect(store.get('acme.sample:count')).toBe(1)
  expect(JSON.parse(writer.mock.calls.at(-1)![0]).plugins?.['acme.sample']?.count).toBeUndefined()
})
it('P2 portable paths hydrate retained declared values before comparing or exporting', async () => {
  const registry = new SettingsRegistry(), store = new SettingsStore(registry, async () => {})
  store.load('{"plugins":{"acme.sample":{"enabled":true,"unknown":42}}}')
  installPluginSettings(registry, manifest())
  expect(JSON.parse(exportSettings(store))).toEqual({ 'acme.sample:enabled': true })
  // A separate store proves import hydration without an export or a read first.
  const r = new SettingsRegistry(), s = new SettingsStore(r, async () => {})
  s.load('{"plugins":{"acme.sample":{"enabled":true}}}')
  installPluginSettings(r, manifest())
  const preview = previewImport('{"acme.sample:enabled":false}', r, s)
  expect(preview.changes).toEqual([{ id: 'acme.sample:enabled', before: true, after: false, warning: undefined, needsConfirm: false }])
  await applyImport(preview, s)
  expect(readPluginSettings(r, s, 'acme.sample').values.enabled).toBe(false)
})
it('P3 live rename reconciles old values before pruning obsolete keys', async () => {
  const { registry, store, writer } = setup({ old: boolean })
  writePluginSetting(registry, store, 'acme.sample', 'old', true)
  removePluginSettings(registry, 'acme.sample')
  installPluginSettings(registry, manifest({ enabled: { ...boolean, renamedFrom: 'old' } }))
  expect(readPluginSettings(registry, store, 'acme.sample').values.enabled).toBe(true)
  await store.flush()
  expect(JSON.parse(writer.mock.calls.at(-1)![0])).toEqual({ plugins: { 'acme.sample': { enabled: true } } })
  expect(store.snapshot().has('acme.sample:old')).toBe(false)
  // The new key wins if both were present during an update.
  const both = setup({ old: boolean, enabled: boolean })
  both.store.set('acme.sample:old', true)
  removePluginSettings(both.registry, 'acme.sample')
  installPluginSettings(both.registry, manifest({ enabled: { ...boolean, renamedFrom: 'old' } }))
  expect(readPluginSettings(both.registry, both.store, 'acme.sample').values.enabled).toBe(false)
})
it('P4 stale previews recheck current reaches and expire on registry revisions', async () => {
  const { registry, store, writer } = setup()
  const preview = previewImport('{"acme.sample:enabled":true}', registry, store)
  removePluginSettings(registry, 'acme.sample')
  installPluginSettings(registry, manifest({ enabled: { ...boolean, reaches: true } }))
  await expect(applyImport(preview, store)).rejects.toThrow(/Confirmation/)
  await expect(applyImport(preview, store, true)).rejects.toThrow(/preview expired/)
  expect(store.get('acme.sample:enabled')).toBe(false); expect(writer).not.toHaveBeenCalled()
  const fresh = previewImport('{"acme.sample:enabled":true}', registry, store)
  await expect(applyImport(fresh, store)).rejects.toThrow(/Confirmation/)
  await applyImport(fresh, store, true)
  expect(store.get('acme.sample:enabled')).toBe(true)
  const ordinary = previewImport('{"acme.sample:enabled":false}', registry, store)
  installPluginSettings(registry, manifest(undefined, 'other'))
  await expect(applyImport(ordinary, store, true)).rejects.toThrow(/preview expired/)
})
