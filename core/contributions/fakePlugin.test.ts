import { expect, it, vi } from 'vitest'
import { mergeUserKeys } from '../keys/user.ts'
import { SettingsStore } from '../settings/store.ts'
import { applyContribution, removeContribution, type ContributionRegistries } from './apply.ts'
import { contributedMenu } from './menus.ts'
import { validateContribution } from './types.ts'
import { fakePlugin, realRegistries } from './fixtures.ts'

function snapshot(r: ContributionRegistries): string {
  return JSON.stringify({ commands: r.commands.list(), settings: r.settings.all(), menus: r.menus.all(),
    keys: r.keys.entries(),
    chords: [...new Set(r.keys.entries().flatMap(command => command.keys ?? []))].map(key => [key, r.keys.get(key)]),
  })
}

it('applies a made-up plugin to every real registry and removes it byte for byte, twice', () => {
  const plugin = fakePlugin(), r = realRegistries(plugin), before = snapshot(r)
  const handle = applyContribution(r, plugin)
  expect(handle.commands).toEqual(['invented:first', 'invented:second', 'invented:third'])
  expect(handle.keys).toEqual(['invented:first', 'invented:second'])
  expect(handle.settings).toEqual(['invented:enabled', 'invented:count'])
  expect(handle.menuItems).toEqual(['invented:second-item', 'invented:first-item'])
  expect(handle.conflicts).toEqual([])
  expect(r.commands.available({ enabled: true, busy: false }).filter(command => command.id.startsWith('invented:'))).toHaveLength(3)
  expect(r.commands.available({ enabled: true, busy: true }).some(command => command.id.startsWith('invented:'))).toBe(false)
  r.commands.handler('invented:first')!()
  expect(r.handlers.get('invented:first')).toHaveBeenCalledOnce()
  expect(r.keys.get('Mod+Alt+J')).toEqual(['invented:first'])
  expect(r.keys.get('Mod+Alt+K')).toEqual(['invented:second'])
  expect(r.settings.getDefault('invented:enabled')).toBe(true)
  expect(r.settings.getDefault('invented:count')).toBe(2)
  expect(contributedMenu(r.menus, 'menubar/file', ['open'], item => item.command, { enabled: true })).toEqual(['open', 'invented:first', 'invented:second'])
  const after = snapshot(r)
  expect(() => applyContribution(r, plugin)).toThrow(/already applied/)
  expect(snapshot(r)).toBe(after)
  removeContribution(r, 'invented'); removeContribution(r, 'invented')
  expect(snapshot(r)).toBe(before)
  for (const command of plugin.commands!) expect(r.commands.handler(command.id)).toBeUndefined()
  const builtin = ['open', 'save']
  expect(contributedMenu(r.menus, 'menubar/file', builtin, item => item.command)).toBe(builtin)
  applyContribution(r, plugin); removeContribution(r, 'invented')
  expect(snapshot(r)).toBe(before)
})

it('lists plugin/plugin, core and user conflicts, leaving the existing chord winner', () => {
  const first = fakePlugin(), second = fakePlugin('other'), r = realRegistries(first, second)
  applyContribution(r, first)
  expect(applyContribution(r, second).conflicts).toEqual([
    { key: 'Mod+Alt+J', commands: ['invented:first', 'other:first'] },
    { key: 'Mod+Alt+K', commands: ['invented:second', 'other:second'] },
  ])
  expect(r.keys.get('Mod+Alt+J')).toEqual(['invented:first'])
  removeContribution(r, 'other'); expect(r.keys.get('Mod+Alt+J')).toEqual(['invented:first'])
  const core = realRegistries(first)
  core.keys.add('coreExtra', 'Mod+Alt+J')
  core.userKeys = mergeUserKeys([{ id: 'userCommand' }], [{ key: 'Mod+Alt+K', command: 'userCommand' }], false).table
  expect(applyContribution(core, first).conflicts).toEqual([
    { key: 'Mod+Alt+J', commands: ['coreExtra', 'invented:first'] },
    { key: 'Mod+Alt+K', commands: ['userCommand', 'invented:second'] },
  ])
  expect(core.keys.get('Mod+Alt+J')).toEqual(['coreExtra'])
  expect(core.keys.get('Mod+Alt+K')).toEqual([])
  expect(core.userKeys.get('Mod+Alt+K')).toEqual(['userCommand'])
})

it('rejects hostile and malformed declarations without touching a live registry', () => {
  const base = fakePlugin()
  const hostile: unknown[] = [
    JSON.parse('{"pluginId":"invented","__proto__":{}}'),
    JSON.parse('{"pluginId":"invented","constructor":{}}'),
    { ...base, commands: [{ ...base.commands![0], id: 'unprefixed' }] },
    { ...base, commands: [{ ...base.commands![0], id: 'save' }] },
    { ...base, commands: [{ ...base.commands![0], id: 'other:command' }] },
    { ...base, keys: [{ command: 'invented:first', key: 'Mod+S' }] },
    { ...base, keys: [{ command: 'invented:first', key: 'mac:Mod+H' }] },
    { ...base, commands: Array.from({ length: 501 }, (_, i) => ({ id: `invented:c${i}`, title: 'x', category: 'x' })) },
    { ...base, menuItems: [{ ...base.menuItems![0], point: 'menubar/nope' }] },
    ...['context/tree', 'context/tab', 'context/editor'].map(point => ({ ...base, menuItems: [{ ...base.menuItems![0], point }] })),
    { ...base, settings: [...base.settings!, { ...base.settings![1], id: 'invented:bad', default: 99 }] },
    { ...base, menuItems: [{ ...base.menuItems![0], command: 'invented:missing' }] },
    { ...base, keys: [{ command: 'invented:missing', key: 'Mod+Alt+J' }] },
    { ...base, commands: [{ ...base.commands![0], when: 'x &&' }] },
    { ...base, settings: [{ ...base.settings![0], surprise: true }] },
    { ...base, commands: [{ ...base.commands![0], title: 'x'.repeat(257) }] },
    { ...base, settings: [{ ...base.settings![0], default: [[[[['deep']]]]] }] },
    { ...base, menuItems: [base.menuItems![0], base.menuItems![0]] },
    { ...base, settings: [{ ...base.settings![0], id: 'invented:constructor' }] },
    { ...base, commands: [{ ...base.commands![0], keys: ['Mod+S'] }] },
  ]
  for (const plugin of hostile) {
    const r = realRegistries(base), before = snapshot(r), revision = r.settings.version()
    const writes = vi.spyOn(r.commands, 'register')
    expect(() => applyContribution(r, plugin)).toThrow()
    expect(snapshot(r)).toBe(before)
    expect(r.settings.version()).toBe(revision)
    expect(writes).not.toHaveBeenCalled()
  }
  expect(() => validateContribution({ pluginId: 'invented', menuItems: [{ ...base.menuItems![0], point: 'context/tree' }] })).toThrow(/reserved, not implemented/)
  for (const id of ['unprefixed', 'save', 'other:command', 'invented:'])
    expect(() => validateContribution({ ...base, commands: [{ ...base.commands![0], id }] }), id).toThrow(/prefixed with invented:/)
  expect(() => validateContribution({ ...base, settings: [{ ...base.settings![0], id: 'other:enabled' }] })).toThrow(/prefixed with invented:/)
  expect(() => validateContribution({ ...base, menuItems: [{ ...base.menuItems![0], id: 'file-item' }] })).toThrow(/prefixed with invented:/)
  expect(() => validateContribution({ ...base, keys: [{ command: 'save', key: 'Mod+Alt+J' }] })).toThrow(/prefixed with invented:/)
  const r = realRegistries(base)
  expect(() => applyContribution(r, { ...base, keys: [{ command: 'invented:first', key: 'Mod+S' }] })).toThrow(/Reserved key chord/)
})

it('copies plain input, rejects accessors and inherited objects without running getters', () => {
  const plugin = fakePlugin(), copy = validateContribution(plugin)
  expect(copy).toEqual(plugin); expect(copy).not.toBe(plugin)
  expect(copy.commands![0]).not.toBe(plugin.commands![0])
  const getter = vi.fn(() => 'invented')
  expect(() => validateContribution(Object.defineProperty({}, 'pluginId', { enumerable: true, get: getter }))).toThrow(/accessors/)
  expect(getter).not.toHaveBeenCalled()
  expect(() => validateContribution(Object.create(plugin))).toThrow(/plain data/)
})

it('rolls back even a writer that inserts then fails, at each registry', () => {
  for (const target of ['commands', 'keys', 'settings', 'menus'] as const) {
    const plugin = fakePlugin(), r = realRegistries(plugin), before = snapshot(r), revision = r.settings.version()
    const notify = vi.fn(); r.settings.subscribe(notify)
    const fail = () => { throw new Error('injected write failure') }
    if (target === 'commands') { const original = r.commands.register; vi.spyOn(r.commands, 'register').mockImplementation((...args) => { original(...args); fail() }) }
    if (target === 'keys') { const original = r.keys.add; vi.spyOn(r.keys, 'add').mockImplementation((...args) => { original(...args); fail() }) }
    if (target === 'settings') { const original = r.settings.defineSetting.bind(r.settings); vi.spyOn(r.settings, 'defineSetting').mockImplementation(input => { original(input); return fail() }) }
    if (target === 'menus') { const original = r.menus.add; vi.spyOn(r.menus, 'add').mockImplementation(input => { original(input); fail() }) }
    expect(() => applyContribution(r, plugin)).toThrow(/injected write failure/)
    expect(snapshot(r)).toBe(before); expect(r.settings.version()).toBe(revision)
    expect(notify).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    applyContribution(r, plugin); removeContribution(r, plugin.pluginId)
    expect(snapshot(r)).toBe(before)
  }
})

it('rejects existing ids and missing handlers before any write', () => {
  const plugin = fakePlugin()
  for (const target of ['commands', 'settings', 'menus', 'handlers']) {
    const r = realRegistries(plugin)
    if (target === 'commands') r.commands.register(plugin.commands![2])
    if (target === 'settings') r.settings.defineSetting(plugin.settings![1])
    if (target === 'menus') r.menus.add(plugin.menuItems![1])
    if (target === 'handlers') r.handlers = new Map()
    const before = snapshot(r), write = vi.spyOn(r.commands, 'register')
    expect(() => applyContribution(r, plugin)).toThrow()
    expect(snapshot(r)).toBe(before); expect(write).not.toHaveBeenCalled()
  }
})

it('persists contributed setting values under plugins.<id>, through the existing store', async () => {
  const plugin = fakePlugin(), r = realRegistries(plugin)
  applyContribution(r, plugin)
  const writes: string[] = [], store = new SettingsStore(r.settings, async text => { writes.push(text) })
  store.set('invented:count', 4)
  await store.flush()
  expect(JSON.parse(writes[0]).plugins).toEqual({ invented: { count: 4 } })
})

it('also keeps the existing settings batch API atomic and its removal idempotent', () => {
  const r = realRegistries(fakePlugin()), before = JSON.stringify(r.settings.all()), revision = r.settings.version()
  const valid = fakePlugin().settings![0], invalid = { ...fakePlugin().settings![1], default: 99 }
  const notify = vi.fn(); r.settings.subscribe(notify)
  expect(() => r.settings.contribute([valid, invalid])).toThrow(/Invalid default/)
  expect(JSON.stringify(r.settings.all())).toBe(before)
  expect(r.settings.version()).toBe(revision); expect(notify).not.toHaveBeenCalled()
  const remove = r.settings.contribute([valid])
  expect(notify).toHaveBeenCalledOnce(); remove(); remove()
  expect(notify).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(r.settings.all())).toBe(before)
})
