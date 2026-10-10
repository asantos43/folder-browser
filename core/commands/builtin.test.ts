// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { translator, type MessageKey } from '@/i18n/index.ts'
import type { MenuEntry } from '@/components/Menu.tsx'
import { MENUS, type Commands } from '@/workbench/commands.ts'
import { builtinCommands, runBuiltinCommand, type BuiltinHandlers } from './builtin.ts'
import { createRegistry } from './registry.ts'
import type { WhenContext } from './when.ts'

const platforms = ['linux', 'win32', 'darwin'] as const
const languages = ['en', 'pt-BR'] as const
/** The ids the menus use where the command has another id. */
const commandOfMenuId: Record<string, string> = {
  open: 'openFile', settings: 'openSettings', close: 'closeEditor', palette: 'commandPalette', hidden: 'toggleHidden', clear: 'clearRecent',
  metadata: 'showMetadata', sidebar: 'toggleSideBar', back: 'goBack', forward: 'goForward', goToFile: 'quickOpen',
  next: 'nextEditor', previous: 'previousEditor', guide: 'openGuide', about: 'showAbout',
}
const whenKeys = ['hasRecent', 'canSave', 'canSaveAll', 'canSaveWsnp', 'canPrint', 'hasEditor', 'canFind', 'canGoBack', 'canGoForward', 'hasSnapshots', 'canZoom']

function setPlatform(value: typeof platforms[number]) {
  Object.defineProperty(window, 'fb', { configurable: true, value: { platform: value } })
}
const noop = () => {}
it('File install command uses the same handler and translates in both languages', () => {
  for (const language of languages) {
    const c = commandsWith(false), calls: string[] = []; c.installPlugin = () => { calls.push('install') }
    const menu = MENUS.find(menu => menu.id === 'file')!.entries(translator(language), c)
    const entry = menu.find(item => !('separator' in item) && item.id === 'installPlugin')
    expect(entry && !('separator' in entry) && entry.label).toBe(translator(language)('plugins.install'))
    if (entry && !('separator' in entry)) entry.run?.()
    expect(calls).toEqual(['install'])
  }
})
/** Every flag of the context on or off; `recent` is the one the menu turns into `hasRecent`. */
function commandsWith(on: boolean, only?: string): Commands {
  const flag = (key: string) => only === undefined ? on : only === key
  return {
    toggleSideBar: noop, setTheme: noop, openFile: noop, newFile: noop, openFolder: noop, openZip: noop, installPlugin: noop, openGuide: noop, toggleHidden: noop,
    showHidden: false, sortKey: 'name', sortDescending: false, setSortKey: noop, setSortDescending: noop, print: noop, savePdf: noop, saveAsWsnp: noop,
    quickOpen: noop, commandPalette: noop, goBack: noop, goForward: noop, copy: noop, find: noop, openRecent: noop, clearRecent: noop, closeEditor: noop, closeAll: noop,
    save: noop, saveAll: noop, canSave: flag('canSave'), canSaveAll: flag('canSaveAll'), nextEditor: noop, previousEditor: noop, showMetadata: noop, openSettings: noop, showAbout: noop,
    zoomIn: noop, zoomOut: noop, zoomReset: noop, hasEditor: flag('hasEditor'), hasSnapshots: flag('hasSnapshots'), canFind: flag('canFind'), canPrint: flag('canPrint'), canSaveWsnp: flag('canSaveWsnp'),
    canGoBack: flag('canGoBack'), canGoForward: flag('canGoForward'), canZoom: flag('canZoom'), recent: flag('hasRecent') ? ['/a/recent.txt'] : [],
  }
}
const contextWith = (on: boolean, only?: string): WhenContext => Object.fromEntries(whenKeys.map((key) => [key, only === undefined ? on : only === key]))

interface Leaf { id: string; label: string; shortcut?: string; disabled: boolean; block: number | null }
/** The leaves of a menu in the order they are drawn; `block` is the stretch between two separators (null inside the recent submenu). */
function leaves(items: MenuEntry[]): Leaf[] {
  const result: Leaf[] = []
  let block = 0
  for (const item of items) {
    if ('separator' in item) { block++; continue }
    if (item.id === 'recent') {
      for (const inner of item.submenu ?? []) if (!('separator' in inner) && inner.id === 'clear') result.push({ id: inner.id, label: inner.label, shortcut: inner.shortcut, disabled: Boolean(inner.disabled), block: null })
    } else if (item.id === 'preferences') {
      for (const inner of item.submenu ?? []) if (!('separator' in inner)) result.push({ id: inner.id, label: inner.label, shortcut: inner.shortcut, disabled: Boolean(inner.disabled), block })
    } else result.push({ id: item.id, label: item.label, shortcut: item.shortcut, disabled: Boolean(item.disabled), block })
  }
  return result
}
function macShortcut(keys: string): string {
  const parts = keys.split('+')
  const key = parts.pop() ?? ''
  return `${parts.includes('Alt') ? '⌥' : ''}${parts.includes('Shift') ? '⇧' : ''}${parts.includes('Ctrl') ? '⌘' : ''}${key}`
}

describe('built-in command data', () => {
  it('has unique ids without a colon and a context key for every condition', () => {
    const ids = builtinCommands.map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.some((id) => id.includes(':'))).toBe(false)
    for (const command of builtinCommands) if ('when' in command) expect(whenKeys).toContain(command.when)
  })

  it.each(platforms.flatMap((platform) => languages.map((language) => [platform, language] as const)))('%s / %s: the menus rebuilt from the registry equal MENUS', (platform, language) => {
    setPlatform(platform)
    const registry = createRegistry()
    for (const command of builtinCommands) registry.register(command)
    const t = translator(language)
    for (const menu of MENUS) {
      const fromRegistry = registry.list()
        .filter((command) => command.menu?.menu === menu.id && !(platform === 'darwin' && command.id === 'exit'))
      // The data hold the menu's groups and orders; the menu is the list sorted by them, groups in order of first appearance.
      const groupRank = new Map<string, number>()
      for (const command of fromRegistry) if (!groupRank.has(command.menu!.group)) groupRank.set(command.menu!.group, groupRank.size)
      const sorted = [...fromRegistry].sort((a, b) => groupRank.get(a.menu!.group)! - groupRank.get(b.menu!.group)! || a.menu!.order - b.menu!.order)

      // Everything off, everything on, and each flag alone (so that a condition naming the wrong flag is seen).
      for (const [on, only] of [[false, undefined], [true, undefined], ...whenKeys.map((key) => [false, key] as const)] as const) {
        const expected = leaves(menu.entries(t, commandsWith(on, only))).filter((leaf) => leaf.id !== 'none')
        const available = new Set(registry.available(contextWith(on, only)).map((command) => command.id))
        expect(sorted.map((command) => command.id), `${menu.id} ids and order`).toEqual(expected.map((leaf) => commandOfMenuId[leaf.id] ?? leaf.id))
        expect(sorted.map((command) => t(command.title as MessageKey)), `${menu.id} titles`).toEqual(expected.map((leaf) => leaf.label))
        expect(sorted.map((command) => !available.has(command.id)), `${menu.id} disabled (${only ?? `all ${on}`})`).toEqual(expected.map((leaf) => leaf.disabled))
        // The Go menu writes its own symbols on macOS by hand (it does not use shortcut()), so the test says them too.
        const macSymbols: Record<string, string> = { goBack: '⌃-', goForward: '⌃⇧-' }
        const shown = (command: typeof sorted[number]): string | undefined => {
          const keys = command.keys?.[0]
          if (keys === undefined) return undefined
          return platform === 'darwin' ? macSymbols[command.id] ?? macShortcut(keys) : keys
        }
        expect(sorted.map(shown), `${menu.id} shortcuts`).toEqual(expected.map((leaf) => leaf.shortcut))
        // The stretches between separators are the groups: leaves of one stretch share a group and two stretches never share one.
        const groupOfBlock = new Map<number, string>()
        const blockOfGroup = new Map<string, number>()
        sorted.forEach((command, index) => {
          const block = expected[index].block
          if (block === null) return
          expect(groupOfBlock.get(block) ?? command.menu!.group, `${menu.id} ${command.id} group`).toBe(command.menu!.group)
          expect(blockOfGroup.get(command.menu!.group) ?? block, `${menu.id} ${command.id} block`).toBe(block)
          groupOfBlock.set(block, command.menu!.group)
          blockOfGroup.set(command.menu!.group, block)
        })
      }
    }
  })

  it('has the commands that are in no menu (zoom and the themes) and nothing else is outside a menu', () => {
    const outside = builtinCommands.filter((command) => !('menu' in command)).map((command) => command.id)
    expect(outside).toEqual(['zoomIn', 'zoomOut', 'zoomReset', 'themeDark', 'themeLight'])
  })

  it('dispatches every built-in id to its matching handler', () => {
    const called: string[] = []
    const handlers = Object.fromEntries(builtinCommands.map(({ id }) => [id, () => { called.push(id) }])) as unknown as BuiltinHandlers
    for (const { id } of builtinCommands) runBuiltinCommand(handlers, id)
    expect(called).toEqual(builtinCommands.map(({ id }) => id))
    runBuiltinCommand(handlers, 'unknown-command')
    expect(called).toHaveLength(builtinCommands.length)
  })
})
