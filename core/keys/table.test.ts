import { expect, it } from 'vitest'
import { builtinKeyCommands } from '../commands/builtin.ts'
import { createRegistry } from '../commands/registry.ts'
import { createKeyTable } from './table.ts'

it('builds registry bindings, retains ambiguity and removes only the requested command', () => {
  const registry = createRegistry()
  registry.register({ id: 'save', title: 'Save', category: 'file', keys: ['Mod+S', 'Mod+S'], when: 'canSave' })
  registry.register({ id: 'plugin:save', title: 'Other save', category: 'file', keys: ['shift+mod+s', 'Mod+S'], when: '!canSave' })
  registry.register({ id: 'next', title: 'Next', category: 'go', keys: ['Ctrl+Tab', 'mac:Mod+1', 'nonmac:Alt+1'] })
  for (const mac of [true, false]) {
    const table = createKeyTable(registry.list(), mac)
    expect(table.get('Mod+S')).toEqual(['save', 'plugin:save'])
    expect(table.lookup({ key: 'S', meta: mac, control: !mac })).toEqual(['save', 'plugin:save'])
    expect(table.lookup({ key: 's', meta: mac, control: !mac, alt: true })).toEqual([])
    expect(table.get('Mod+Shift+S')).toEqual(['plugin:save'])
    expect(table.get(mac ? 'Cmd+1' : 'Alt+1')).toEqual(['next'])
    expect(table.get(mac ? 'Alt+1' : 'Cmd+1')).toEqual([])
    expect(table.shortcut('next')).toBe(mac ? '⌃Tab' : 'Ctrl+Tab')
    expect(table.shortcut('absent')).toBeUndefined()
    expect(table.accelerator('save')).toBeUndefined()
    // Conditions are intentionally left for a caller in the window.
    expect(registry.available({ canSave: true }).map((command) => command.id)).toEqual(['save', 'next'])
    table.remove('save')
    expect(table.get('Mod+S')).toEqual(['plugin:save'])
    expect(table.accelerator('plugin:save')).toBe(mac ? 'Cmd+Shift+S' : 'Ctrl+Shift+S')
    expect(table.shortcut('save')).toBeUndefined()
    table.remove('plugin:save')
    table.remove('absent')
    expect(table.get('Mod+S')).toEqual([])
    expect(table.get('Mod+Shift+S')).toEqual([])
    expect(table.get('Ctrl+Tab')).toEqual(['next'])
  }
  expect(() => createKeyTable([{ id: 'bad', keys: ['Nope+S'] }], false)).toThrow('Invalid key chord')
  expect(createKeyTable(builtinKeyCommands, true).accelerator('goBack')).toBe('Ctrl+-')
})
