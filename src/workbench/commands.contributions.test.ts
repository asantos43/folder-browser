// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as chords from '@core/keys/chord.ts'
import * as conditions from '@core/commands/when.ts'
import { platformChord } from '@core/keys/table.ts'
import { KeySchemes } from '@core/keys/schemes.ts'
import { builtinKeyCommands } from '@core/commands/builtin.ts'
import { commandFor } from '@core/shortcuts.ts'
import type { PluginGeneration } from '@core/plugins/summary.ts'
import type { MenuPoint } from '@core/contributions/contract.ts'
import { applyContributions, resetContributions } from '@/plugins/contributions.ts'
import { i18nRegistry, translator } from '@/i18n/index.ts'
import {
  currentMenus, dispatchPluginCommand, findPluginCommandByKey, pluginPaletteItems,
  type Commands, isMac,
} from './commands.ts'

interface TestCommand { id: string; title: string; category: string; enabled: boolean; disabledReason?: string; when?: string; palette?: boolean; defaultKeys: readonly string[] }
interface TestMenuItem { id: string; command: string; owner: string; point: MenuPoint; group: string; order: number; when?: string }
interface TestPlugin { owner: string; commands?: readonly TestCommand[]; menuItems?: readonly TestMenuItem[]; resolvedKeys?: readonly { id: string; keys?: readonly string[] }[] }

function cmd(over: Partial<TestCommand> & { id: string; owner?: string }): TestCommand {
  return {
    id: over.id,
    title: over.title ?? over.id,
    category: over.category ?? 'a',
    enabled: over.enabled ?? true,
    ...(over.disabledReason !== undefined ? { disabledReason: over.disabledReason } : {}),
    ...(over.when !== undefined ? { when: over.when } : {}),
    palette: over.palette !== false,
    defaultKeys: over.defaultKeys ?? [],
  }
}

function item(over: Partial<TestMenuItem> & { id: string; command: string; point?: MenuPoint }): TestMenuItem {
  return {
    id: over.id,
    command: over.command,
    owner: over.owner ?? 'a',
    point: over.point ?? 'menubar/tools',
    group: over.group ?? 'commands',
    order: over.order ?? 0,
    ...(over.when !== undefined ? { when: over.when } : {}),
  }
}

function apply(version: number, plugins: readonly TestPlugin[]): void {
  const snapshot: PluginGeneration = {
    version,
    plugins: plugins.map(plugin => ({
      owner: plugin.owner,
      enabled: true,
      themes: [], locales: [], texts: {}, languages: [], settings: [],
      keySchemes: [], keyEntries: [],
      commands: plugin.commands ?? [],
      resolvedKeys: plugin.resolvedKeys ?? (plugin.commands ?? []).map(command => ({ id: command.id, keys: command.defaultKeys.flatMap(key => {
        const chord = platformChord(key, isMac())
        return chord === undefined ? [] : [chord]
      }) })),
      menuItems: plugin.menuItems ?? [],
    })),
  }
  applyContributions(snapshot)
}

function applySingle(version: number, owner: string, commands: readonly TestCommand[], menuItems: readonly TestMenuItem[] = []): void {
  apply(version, [{ owner, commands, menuItems }])
}

function baseCommands(): Commands {
  return {
    toggleSideBar: () => {}, setTheme: () => {}, openFile: () => {}, newFile: () => {},
    openFolder: () => {}, openZip: () => {}, installPlugin: () => {}, openGuide: () => {},
    toggleHidden: () => {}, showHidden: false, sortKey: 'name', sortDescending: false,
    setSortKey: () => {}, setSortDescending: () => {}, print: () => {}, savePdf: () => {},
    saveAsWsnp: () => {}, quickOpen: () => {}, commandPalette: () => {}, goBack: () => {},
    goForward: () => {}, copy: () => {}, find: () => {}, openRecent: () => {}, clearRecent: () => {},
    closeEditor: () => {}, closeAll: () => {}, save: () => {}, saveAll: () => {},
    canSave: false, canSaveAll: false, nextEditor: () => {}, previousEditor: () => {},
    showMetadata: () => {}, openSettings: () => {}, showAbout: () => {}, zoomIn: () => {},
    zoomOut: () => {}, zoomReset: () => {}, hasEditor: false, hasSnapshots: false,
    canFind: false, canPrint: false, canSaveWsnp: false, canGoBack: false, canGoForward: false,
    canZoom: false, recent: [],
  }
}

it('resolves the same title key per owner in menus and palette, with literal fallback', () => {
  i18nRegistry.setPlugin('alpha', [], { title: { en: 'Alpha title' } })
  i18nRegistry.setPlugin('beta', [], { title: { en: 'Beta title' } })
  try {
    apply(1, ['alpha', 'beta', 'gamma'].map(owner => ({
      owner, commands: [cmd({ id: `${owner}:cmd`, title: 'title' })],
      menuItems: [item({ id: `${owner}.item`, owner, command: `${owner}:cmd` })],
    })))
    const palette = pluginPaletteItems(baseCommands())
    expect(palette.map(entry => entry.label)).toEqual(['Alpha title', 'Beta title', 'title'])
    const entries = currentMenus().find(menu => menu.id === 'tools')!.entries(translator('en'), baseCommands())
    expect(entries.map(entry => 'label' in entry ? entry.label : undefined)).toEqual(['Alpha title', 'Beta title', 'title'])
  } finally {
    i18nRegistry.removePlugin('alpha')
    i18nRegistry.removePlugin('beta')
  }
})

afterEach(() => resetContributions())

describe('currentMenus: Tools only when menubar/tools has items', () => {
  it('omits Tools when no plugin contributes to menubar/tools', () => {
    applySingle(1, 'a', [], [])
    const ids = currentMenus().map(menu => menu.id)
    expect(ids).toEqual(['file', 'edit', 'view', 'go', 'help'])
  })

  it('includes Tools when a plugin contributes to menubar/tools', () => {
    applySingle(1, 'a', [cmd({ id: 'a:cmd' })], [item({ id: 'a.tools.cmd', command: 'a:cmd' })])
    const ids = currentMenus().map(menu => menu.id)
    expect(ids).toEqual(['file', 'edit', 'view', 'go', 'tools', 'help'])
  })

  it('hides Tools again when the only contributor is removed', () => {
    applySingle(1, 'a', [], [item({ id: 'a.tools.cmd', command: 'a:cmd' })])
    expect(currentMenus().some(menu => menu.id === 'tools')).toBe(true)
    applySingle(2, 'a', [], [])
    expect(currentMenus().some(menu => menu.id === 'tools')).toBe(false)
  })
})

describe('plugin menu projection', () => {
  it('appends a plugin item to the matching menubar point', () => {
    applySingle(1, 'a', [cmd({ id: 'a:cmd' })], [item({ id: 'a.tools.cmd', command: 'a:cmd' })])
    const tools = currentMenus().find(menu => menu.id === 'tools')!
    const entries = tools.entries(translator("en"), baseCommands())
    expect(entries.some(entry => !('separator' in entry) && entry.id === 'plugin:a.tools.cmd')).toBe(true)
  })

  it('skips items whose command is not in the contributions map (foreign/removed)', () => {
    applySingle(1, 'a', [], [item({ id: 'a.tools.orphan', command: 'gone:cmd' })])
    const tools = currentMenus().find(menu => menu.id === 'tools')!
    const entries = tools.entries(translator("en"), baseCommands())
    expect(entries).toEqual([])
  })

  it('skips items whose when evaluates false; keeps items whose when evaluates true', () => {
    applySingle(1, 'a', [cmd({ id: 'a:cmd' })], [
      item({ id: 'a.tools.visible', command: 'a:cmd', order: 0, when: 'hasEditor' }),
      item({ id: 'a.tools.hidden', command: 'a:cmd', order: 1, when: '!hasEditor' }),
    ])
    const tools = currentMenus().find(menu => menu.id === 'tools')!
    const withEditor = { ...baseCommands(), hasEditor: true }
    const entries = tools.entries(translator("en"), withEditor)
    const ids = entries.filter(entry => !('separator' in entry)).map(entry => 'id' in entry ? entry.id : '')
    expect(ids).toContain('plugin:a.tools.visible')
    expect(ids).not.toContain('plugin:a.tools.hidden')
  })

  it('marks no-exec commands as disabled in the menu', () => {
    applySingle(1, 'a', [cmd({ id: 'a:cmd', enabled: false, disabledReason: 'Command has no exec' })], [item({ id: 'a.tools.cmd', command: 'a:cmd' })])
    const tools = currentMenus().find(menu => menu.id === 'tools')!
    const entries = tools.entries(translator("en"), baseCommands())
    const entry = entries.find(entry => !('separator' in entry) && entry.id === 'plugin:a.tools.cmd') as { disabled?: boolean }
    expect(entry.disabled).toBe(true)
  })

  it('sorts plugin items by group → order → id', () => {
    applySingle(1, 'a', [cmd({ id: 'a:cmd' })], [
      item({ id: 'a.tools.b2', command: 'a:cmd', group: 'b', order: 2 }),
      item({ id: 'a.tools.a0', command: 'a:cmd', group: 'a', order: 0 }),
      item({ id: 'a.tools.b1', command: 'a:cmd', group: 'b', order: 1 }),
      item({ id: 'a.tools.a1', command: 'a:cmd', group: 'a', order: 1 }),
    ])
    const tools = currentMenus().find(menu => menu.id === 'tools')!
    const entries = tools.entries(translator("en"), baseCommands())
    const ids = entries.filter(entry => !('separator' in entry)).map(entry => 'id' in entry ? entry.id : '')
    expect(ids).toEqual(['plugin:a.tools.a0', 'plugin:a.tools.a1', 'plugin:a.tools.b1', 'plugin:a.tools.b2'])
  })
})

describe('plugin palette projection', () => {
  it('includes plugin commands with palette: true; excludes palette: false', () => {
    applySingle(1, 'a', [
      cmd({ id: 'a:show', palette: true }),
      cmd({ id: 'a:hide', palette: false }),
    ], [])
    const items = pluginPaletteItems(baseCommands())
    expect(items.some(item => item.id === 'plugin:a:show')).toBe(true)
    expect(items.some(item => item.id === 'plugin:a:hide')).toBe(false)
  })

  it('excludes items whose when evaluates false in the current context', () => {
    applySingle(1, 'a', [cmd({ id: 'a:needsEditor', when: 'hasEditor' })], [])
    expect(pluginPaletteItems(baseCommands()).some(item => item.id === 'plugin:a:needsEditor')).toBe(false)
    expect(pluginPaletteItems({ ...baseCommands(), hasEditor: true }).some(item => item.id === 'plugin:a:needsEditor')).toBe(true)
  })

  it('orders palette items by owner then id', () => {
    apply(1, [
      { owner: 'a', commands: [
        cmd({ id: 'a:other', owner: 'a' }),
        cmd({ id: 'a:cmd', owner: 'a' }),
      ] },
      { owner: 'b', commands: [
        cmd({ id: 'b:cmd', owner: 'b' }),
      ] },
    ])
    const ids = pluginPaletteItems(baseCommands()).map(item => item.commandId)
    expect(ids).toEqual(['a:cmd', 'a:other', 'b:cmd'])
  })

  it('zero duplication: same id from the same owner replaces the previous', () => {
    applySingle(1, 'a', [cmd({ id: 'a:cmd', title: 'first' })], [])
    applySingle(2, 'a', [cmd({ id: 'a:cmd', title: 'second' })], [])
    const items = pluginPaletteItems(baseCommands())
    expect(items).toHaveLength(1)
    expect(items[0]!.label).toBe('second')
  })
})

describe('plugin dispatch', () => {
  it('rejects an unknown command id (a removed plugin command)', () => {
    const result = dispatchPluginCommand('gone:cmd', {})
    expect(result).toEqual({ ok: false, reason: 'unknown' })
  })

  it('refuses a disabled (no-exec) command and surfaces the reason', () => {
    applySingle(1, 'a', [cmd({ id: 'a:noExec', enabled: false, disabledReason: 'Command has no exec' })], [])
    const result = dispatchPluginCommand('a:noExec', {})
    expect(result).toEqual({ ok: false, reason: 'disabled', disabledReason: 'Command has no exec' })
  })

  it('refuses a command whose when evaluates false in the current context', () => {
    applySingle(1, 'a', [cmd({ id: 'a:context', when: 'hasEditor' })], [])
    expect(dispatchPluginCommand('a:context', {})).toEqual({ ok: false, reason: 'when' })
    expect(dispatchPluginCommand('a:context', { hasEditor: true })).toMatchObject({ ok: true, id: 'a:context' })
  })

  it('accepts an enabled command whose when evaluates true (no exec path in phase 2)', () => {
    applySingle(1, 'a', [cmd({ id: 'a:ok' })], [])
    expect(dispatchPluginCommand('a:ok', {})).toMatchObject({ ok: true, id: 'a:ok' })
  })

  it('a removed command is refused: id absent from the store', () => {
    applySingle(1, 'a', [cmd({ id: 'a:tmp' })], [])
    expect(dispatchPluginCommand('a:tmp', {})).toMatchObject({ ok: true })
    applySingle(2, 'a', [], [])
    expect(dispatchPluginCommand('a:tmp', {})).toEqual({ ok: false, reason: 'unknown' })
  })
})

describe('findPluginCommandByKey', () => {
  it('returns null when there are no plugin commands', () => {
    expect(findPluginCommandByKey({ key: 'k', control: true, meta: false, shift: false, alt: false }, {})).toBeNull()
  })

  it('matches the host-resolved key for the current platform', () => {
    const key = isMac() ? 'mac:Mod+K' : 'Ctrl+K'
    applySingle(1, 'a', [cmd({ id: 'a:cmd', defaultKeys: [key] as readonly string[] })], [])
    const ev = isMac()
      ? { key: 'k', meta: true, control: false, shift: false, alt: false }
      : { key: 'k', control: true, meta: false, shift: false, alt: false }
    expect(findPluginCommandByKey(ev, {})).toBe('a:cmd')
  })

  it('skips commands whose when evaluates false', () => {
    applySingle(1, 'a', [cmd({ id: 'a:cmd', defaultKeys: ['Ctrl+K'] as readonly string[], when: 'hasEditor' })], [])
    const ev = { key: 'k', control: true, meta: false, shift: false, alt: false }
    expect(findPluginCommandByKey(ev, { hasEditor: false })).toBeNull()
    expect(findPluginCommandByKey(ev, { hasEditor: true })).toBe('a:cmd')
  })

  it('returns the first match in insertion order when several share a chord', () => {
    applySingle(1, 'a', [
      cmd({ id: 'a:first', defaultKeys: ['Ctrl+K'] as readonly string[] }),
      cmd({ id: 'b:second', defaultKeys: ['Ctrl+K'] as readonly string[] }),
    ], [])
    const ev = { key: 'k', control: true, meta: false, shift: false, alt: false }
    const id = findPluginCommandByKey(ev, {})
    expect(id).toBe('a:first')
  })

  it('skips the other platform when the default key is qualified', () => {
    applySingle(1, 'a', [cmd({ id: 'a:macOnly', defaultKeys: ['mac:Mod+K'] as readonly string[] })], [])
    const macEvent = { key: 'k', meta: true, control: false, shift: false, alt: false }
    const nonMacEvent = { key: 'k', control: true, meta: false, shift: false, alt: false }
    if (isMac()) {
      expect(findPluginCommandByKey(macEvent, {})).toBe('a:macOnly')
      expect(findPluginCommandByKey(nonMacEvent, {})).toBeNull()
    } else {
      expect(findPluginCommandByKey(macEvent, {})).toBeNull()
      expect(findPluginCommandByKey(nonMacEvent, {})).toBeNull()
    }
  })

  it('never resurrects missing, unbound or replaced defaults, including displayed shortcuts', () => {
    const command = cmd({ id: 'a:cmd', defaultKeys: ['Ctrl+K'] })
    const menuItems = [item({ id: 'a.item', command: command.id })]
    const oldEvent = { key: 'k', control: true }
    for (const resolvedKeys of [[], [{ id: command.id }], [{ id: command.id, keys: [] }]]) {
      apply(1, [{ owner: 'a', commands: [command], menuItems, resolvedKeys }])
      expect(findPluginCommandByKey(oldEvent, {})).toBeNull()
      expect(pluginPaletteItems(baseCommands())[0]?.shortcut).toBeUndefined()
      const entry = currentMenus().find(menu => menu.id === 'tools')!.entries(translator('en'), baseCommands())[0]!
      expect('shortcut' in entry ? entry.shortcut : undefined).toBeUndefined()
    }
    apply(2, [{ owner: 'a', commands: [command], menuItems, resolvedKeys: [{ id: command.id, keys: ['Ctrl+Alt+J'] }] }])
    expect(findPluginCommandByKey(oldEvent, {})).toBeNull()
    expect(findPluginCommandByKey({ key: 'j', control: true, alt: true }, {})).toBe(command.id)
    const label = chords.formatChord('Ctrl+Alt+J', isMac())
    expect(pluginPaletteItems(baseCommands())[0]?.shortcut).toBe(label)
    expect(currentMenus().find(menu => menu.id === 'tools')!.entries(translator('en'), baseCommands())[0]).toMatchObject({ shortcut: label })
  })

  it('honours host user unbinding, replacement and reserved built-in conflict resolution', () => {
    const command = cmd({ id: 'a:cmd', defaultKeys: ['Mod+Alt+J', 'Mod+B'] })
    const schemes = new KeySchemes()
    schemes.set('a', { commands: [command], keySchemes: [], keymaps: [] })
    const user = [{ key: 'Mod+Alt+J', command: '-a:cmd' }, { key: 'Mod+Alt+K', command: 'a:cmd' }]
    const resolvedKeys = schemes.compose(builtinKeyCommands, user, isMac()).table.entries().filter(entry => entry.id.startsWith('a:'))
    apply(1, [{ owner: 'a', commands: [command], resolvedKeys }])
    const modifier = isMac() ? { meta: true } : { control: true }
    expect(findPluginCommandByKey({ key: 'j', alt: true, ...modifier }, {})).toBeNull()
    expect(findPluginCommandByKey({ key: 'k', alt: true, ...modifier }, {})).toBe(command.id)
    expect(findPluginCommandByKey({ key: 'b', ...modifier }, {})).toBeNull()
    expect(commandFor({ key: 'b', ...modifier }, isMac(), {})).toBe('toggleSideBar')
  })

  it('does not parse during 1000 keydowns and stays below 1 ms per lookup', () => {
    applySingle(1, 'a', [cmd({ id: 'a:cmd', when: 'hasEditor', defaultKeys: ['Ctrl+Alt+J'] })])
    const normalize = vi.spyOn(chords, 'normalizeChord')
    const compile = vi.spyOn(conditions, 'compileWhen')
    try {
      let maximum = 0
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        const before = performance.now()
        const result = findPluginCommandByKey({ key: 'j', control: true, alt: true }, { hasEditor: i % 2 === 0 })
        if (result) expect(dispatchPluginCommand(result, { hasEditor: true }).ok).toBe(true)
        maximum = Math.max(maximum, performance.now() - before)
        expect(result).toBe(i % 2 === 0 ? 'a:cmd' : null)
      }
      const average = (performance.now() - start) / 1000
      console.info(`1000 keydowns: average ${average.toFixed(4)} ms; maximum ${maximum.toFixed(4)} ms`)
      expect(normalize).not.toHaveBeenCalled()
      expect(compile).not.toHaveBeenCalled()
      expect(maximum).toBeLessThan(1)
    } finally { normalize.mockRestore(); compile.mockRestore() }
  })
})

describe('projection budget (500 commands + 500 menu items < 10 ms)', () => {
  it('projects within 10 ms (median of 5)', () => {
    const commands: TestCommand[] = []
    const items: TestMenuItem[] = []
    for (let i = 0; i < 500; i++) {
      const letter = String.fromCharCode(65 + (i % 26))
      commands.push({
        id: `p${i}:cmd`, title: `p${i}.cmd`, category: `p${i}`,
        enabled: i % 4 !== 0, ...(i % 4 === 0 ? { disabledReason: 'Command has no exec' } : {}),
        palette: true, defaultKeys: [`Ctrl+${letter}`] as readonly string[],
      })
      items.push({ id: `p${i}.tools.cmd`, command: `p${i}:cmd`, owner: `p${i}`, point: 'menubar/tools', group: 'commands', order: i })
    }
    applySingle(1, 'p0', commands, items)
    const cmds = baseCommands()
    const samples: number[] = []
    for (let i = 0; i < 5; i++) {
      const start = performance.now()
      for (const menu of currentMenus()) menu.entries(translator('en'), cmds)
      pluginPaletteItems(cmds)
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    const median = samples[2]!
    console.info(`500 commands + 500 menu items: ${median.toFixed(3)} ms`)
    expect(median).toBeLessThanOrEqual(10)
  })
})
