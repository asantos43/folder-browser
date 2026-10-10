import { expect, it } from 'vitest'
import { validateContribution } from './types.ts'
import { fakePlugin, realRegistries } from './fixtures.ts'
import { applyContribution, removeContribution } from './apply.ts'
import { SettingsStore } from '../settings/store.ts'

it('retains the original default string/list/depth budgets and opts into wider data', () => {
  const raw = { pluginId: 'a.b', settings: [{ id: 'a.b:text', type: 'string', default: 'x'.repeat(4096), category: 'plugin', label: 'text' }] }
  expect(() => validateContribution(raw)).toThrow(/256/)
  expect(validateContribution(raw, { stringLength: 4096 }).settings?.[0].default).toBe(raw.settings[0].default)
  const list = { pluginId: 'a.b', settings: [{ id: 'a.b:items', type: 'list', default: Array(1000).fill('a'), category: 'plugin', label: 'items' }] }
  expect(() => validateContribution(list)).toThrow(/500/)
  expect(validateContribution(list, { arrayLength: 1000 }).settings?.[0].default).toHaveLength(1000)
  expect(() => validateContribution({ pluginId: 'a.b', unknown: { a: { b: { c: { d: { e: 1 } } } } } }, { arrayLength: 1000, stringLength: 4096 })).toThrow(/depth/)
  expect(() => validateContribution({ pluginId: 'a.b', commands: Array.from({ length: 501 }, (_, i) => ({ id: `a.b:c${i}`, title: 'c', category: 'c' })) }, { arrayLength: 1000 })).toThrow(/500 items in total/)
})
it.each(['a..b', 'A.b', 'a b.c', 'a.b.', 'a.prototype.b', `a.${'b'.repeat(63)}`])('refuses malformed/forbidden plugin id %s', pluginId => {
  expect(() => validateContribution({ pluginId })).toThrow(/invalid pluginId/)
})
it('applies, removes and round-trips a.b and a-b.c as distinct whole keys of plugins', async () => {
  const a = fakePlugin('a.b'), b = fakePlugin('a-b.c'), r = realRegistries(a, b)
  applyContribution(r, a); applyContribution(r, b)
  expect(r.commands.get('a.b:first')).toBeDefined(); expect(r.commands.get('a-b.c:first')).toBeDefined()
  const writes: string[] = [], store = new SettingsStore(r.settings, async text => { writes.push(text) })
  store.set('a.b:count', 3); store.set('a-b.c:count', 4)
  await store.flush()
  expect(JSON.parse(writes.at(-1)!).plugins).toEqual({ 'a.b': { count: 3 }, 'a-b.c': { count: 4 } })
  const restored = new SettingsStore(r.settings, async () => {})
  expect(restored.load(writes.at(-1)!)).toEqual([])
  expect(restored.get('a.b:count')).toBe(3); expect(restored.get('a-b.c:count')).toBe(4)
  removeContribution(r, 'a.b')
  expect(r.commands.get('a.b:first')).toBeUndefined(); expect(r.commands.get('a-b.c:first')).toBeDefined()
  expect(r.settings.get('a.b:count')).toBeUndefined(); expect(r.settings.get('a-b.c:count')).toBeDefined()
})
