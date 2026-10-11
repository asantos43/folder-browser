// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { i18nRegistry } from '@/i18n/index.ts'
import { getSnapshot, applyContributions, resetContributions } from '@/plugins/contributions.ts'
import { activeKeyboardCommands, filterKeyboard, indexKeyboard, keyboardConflicts, replaceCommand, restoreCommand } from './keyboardModel.ts'

afterEach(() => { resetContributions(); i18nRegistry.removePlugin('acme'); i18nRegistry.select('en') })
const commands = [
  { id: 'internal', title: 'Internal', category: 'file', keys: ['Mod+B'] },
  { id: 'acme:run', owner: 'acme', title: 'run', category: 'tools', keys: ['nonmac:Ctrl+Alt+J', 'mac:Cmd+Alt+J'] },
]
it('indexes active plugin keys, owner labels, category and user overrides', () => {
  i18nRegistry.setPlugin('acme', [], { run: { en: 'Run plugin' }, tools: { en: 'Acme tools' } })
  const indexed = indexKeyboard(commands, [{ key: 'Ctrl+Alt+K', command: 'acme:run' }], false, key => key)
  expect(indexed[1]).toMatchObject({ title: 'Run plugin', category: 'Acme tools', key: 'Ctrl+Alt+K', changed: true })
  expect(filterKeyboard(indexed, 'run plugin', true)).toHaveLength(1)
  expect(indexKeyboard(commands, [], true, key => key)[1].key).toContain('⌘')
  i18nRegistry.removePlugin('acme')
  expect(indexKeyboard(commands, [], false, key => key)[1]).toMatchObject({ title: 'run', category: 'tools' })
})
it('replaces/removes all platform defaults from the supplied catalog and restores entries', () => {
  const entries = [{ key: 'Ctrl+Alt+L', command: 'acme:run' }, { key: 'Ctrl+Alt+U', command: 'internal' }]
  const next = replaceCommand(commands, entries, 'acme:run', 'Ctrl+Alt+K', false)
  expect(next).toEqual([entries[1], { key: 'Ctrl+Alt+J', command: '-acme:run' }, { key: 'Ctrl+Alt+K', command: 'acme:run' }])
  expect(indexKeyboard(commands, next, false, key => key)[1].key).toBe('Ctrl+Alt+K')
  expect(indexKeyboard(commands, replaceCommand(commands, entries, 'acme:run', undefined, false), false, key => key)[1].key).toBe('')
  expect(restoreCommand(next, 'acme:run')).toEqual([entries[1]])
})
it('checks conflicts with plugin defaults and conditional user keys before overriding them', () => {
  expect(keyboardConflicts(commands, [], 'internal', 'Ctrl+Alt+J', false)).toEqual(['acme:run'])
  expect(keyboardConflicts(commands, [], 'acme:run', 'Mod+B', false)).toEqual(['internal'])
  expect(keyboardConflicts(commands, [{ key: 'Ctrl+Alt+L', command: 'acme:run', when: 'hasEditor' }], 'internal', 'Ctrl+Alt+L', false)).toEqual(['acme:run'])
  expect(keyboardConflicts(commands, [{ key: 'Ctrl+Alt+J', command: '-acme:run' }], 'internal', 'Ctrl+Alt+J', false)).toEqual([])
  expect(keyboardConflicts(commands, [], 'acme:run', 'Ctrl+Alt+J', false)).toEqual([])
})
it('keeps removed plugin defaults on repeated edits when the host only projects the effective keys', () => {
  const active = [{ ...commands[1], keys: ['Ctrl+Alt+K'] }]
  const entries = [{ key: 'Ctrl+Alt+J', command: '-acme:run' }, { key: 'Ctrl+Alt+K', command: 'acme:run' }]
  expect(replaceCommand(active, entries, 'acme:run', undefined, false)).toEqual([
    { key: 'Ctrl+Alt+J', command: '-acme:run' }, { key: 'Ctrl+Alt+K', command: '-acme:run' },
  ])
})
it('builds the active catalog from enabled owners and host bindings without resurrecting claimed core chords', () => {
  applyContributions({ version: 1, plugins: [{ owner: 'acme', enabled: true, themes: [], locales: [], texts: {}, languages: [], settings: [], keySchemes: [], keyEntries: [], menuItems: [],
    commands: [{ id: 'acme:run', title: 'run', category: 'tools', enabled: true, defaultKeys: ['Ctrl+Alt+Z'] }],
    resolvedKeys: [{ id: 'acme:run', keys: ['Mod+B'] }],
  }] })
  const active = activeKeyboardCommands([commands[0]], getSnapshot(), false)
  expect(active[0].keys).toEqual([])
  expect(active[1].keys).toEqual(['Mod+B'])
  expect(indexKeyboard(active, [], false, key => key)[1].key).toBe('Ctrl+B')
  applyContributions({ version: 2, plugins: [] })
  expect(activeKeyboardCommands([commands[0]], getSnapshot(), false)).toEqual([commands[0]])
})
it('filters 500 plugin commands under 10 ms (median of seven rounds)', () => {
  const indexed = indexKeyboard(Array.from({ length: 500 }, (_, i) => ({ id: `acme:command${i}`, owner: 'acme', title: `Command ${i}`, category: 'tools', keys: [] })), [], false, key => key)
  const times = Array.from({ length: 7 }, () => {
    const start = performance.now()
    const filtered = filterKeyboard(indexed, 'command49', false)
    const elapsed = performance.now() - start
    expect(filtered).toHaveLength(11)
    return elapsed
  }).sort((a, b) => a - b)
  expect(times[3]).toBeLessThan(10)
  console.info(`Keyboard plugin filter median: ${times[3].toFixed(3)} ms`)
})
