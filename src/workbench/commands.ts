import type { MessageKey, Translate } from '@/i18n/index.ts'
import type { MenuEntry } from '@/components/Menu.tsx'
import { basename } from '@/lib/format.ts'
import type { SortKey } from '@core/fs/sort.ts'
import { sortMenuEntries } from './sortMenu.ts'
import { builtinCommands, type BuiltinCommandId } from '@core/commands/builtin.ts'
import { createRegistry, type CommandDef } from '@core/commands/registry.ts'
import { formatChord } from '@core/keys/chord.ts'
import { builtinKeyTables } from '@core/keys/table.ts'
import { effectiveKeyTable } from '@core/keys/effective.ts'

/** What the workbench can do; the menus, the keyboard and the native menu of macOS all end up here. */
export interface Commands {
  toggleSideBar: () => void
  setTheme: (theme: 'auto' | 'dark' | 'light') => void
  openFile: () => void
  /** A new text file that exists only in the window. */
  newFile: () => void
  openFolder: () => void
  /** Asks for a ZIP file to browse (the folder picker of Linux and Windows cannot choose a file). */
  openZip: () => void
  installPlugin: () => void
  /** Opens the user guide in a tab. */
  openGuide: () => void
  toggleHidden: () => void
  /** The hidden files are shown in the tree. */
  showHidden: boolean
  /** How the files of a folder are ordered. */
  sortKey: SortKey
  sortDescending: boolean
  setSortKey: (key: SortKey) => void
  setSortDescending: (descending: boolean) => void
  print: () => void
  savePdf: () => void
  saveAsWsnp: () => void
  quickOpen: () => void
  commandPalette: () => void
  goBack: () => void
  goForward: () => void
  copy: () => void
  find: () => void
  openRecent: (path: string) => void
  clearRecent: () => void
  closeEditor: () => void
  closeAll: () => void
  /** Saves the text file on screen, or all that have unsaved changes. */
  save: () => void
  saveAll: () => void
  /** The tab on screen has unsaved changes; some tab has. */
  canSave: boolean
  canSaveAll: boolean
  nextEditor: () => void
  previousEditor: () => void
  showMetadata: () => void
  openSettings: () => void
  showAbout: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  /** A tab is open: the commands that act on it can run. */
  hasEditor: boolean
  /** A snapshot is open: there are files to go to. */
  hasSnapshots: boolean
  /** The tab on screen has text to search, and something that can be printed. */
  canFind: boolean
  canPrint: boolean
  /** The snapshot on screen was converted from a ZIP saved by PageKeep. */
  canSaveWsnp: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** The tab on screen has a zoom: its own, or one it keeps for itself. */
  canZoom: boolean
  /** The files opened lately, the latest first. */
  recent: string[]
}

export const platform = (): string => window.fb?.platform ?? (navigator.platform.toLowerCase().startsWith('mac') ? 'darwin' : 'linux')
export const isMac = (): boolean => platform() === 'darwin'

/** VS Code writes a shortcut as `Ctrl+Shift+P`, and on macOS as symbols in the order ⌃⌥⇧⌘. */
export function shortcut(keys: string): string {
  const ids = (isMac() ? builtinKeyTables.mac : builtinKeyTables.nonmac).get(keys.replace(/^Ctrl\+/, 'Mod+'))
  if (ids.length === 1) return effectiveKeyTable(isMac()).shortcut(ids[0]) ?? ''
  return formatChord(keys.replace(/^Ctrl\+/, 'Mod+'), isMac())
}

export interface MenuDef {
  id: string
  label: MessageKey
  entries: (t: Translate, commands: Commands) => MenuEntry[]
}

/**
 * VS Code's menus, trimmed to what the viewer does (docs/UI-DESIGN.md, "Behaviour taken from VS Code"). Items of features
 * that do not exist yet are disabled, not hidden, so the structure is the final one.
 */
export const registry = createRegistry()
for (const definition of builtinCommands) registry.register(definition)
const definitions = new Map<string, Readonly<CommandDef>>(builtinCommands.map((definition) => [definition.id, definition] as const))
const labels: Record<string, string> = { openFile: 'open', openSettings: 'settings', closeEditor: 'close', commandPalette: 'palette', toggleHidden: 'hidden', clearRecent: 'clear', showMetadata: 'metadata', toggleSideBar: 'sidebar', goBack: 'back', goForward: 'forward', quickOpen: 'goToFile', nextEditor: 'next', previousEditor: 'previous', openGuide: 'guide', showAbout: 'about' }
const headers: Array<Pick<MenuDef, 'id' | 'label'>> = [
  { id: 'file', label: 'menu.file' }, { id: 'edit', label: 'menu.edit' }, { id: 'view', label: 'menu.view' },
  { id: 'go', label: 'menu.go' }, { id: 'help', label: 'menu.help' },
]

export function contextOf(c: Commands) {
  return {
    hasRecent: c.recent.length > 0, canSave: c.canSave, canSaveAll: c.canSaveAll, canSaveWsnp: c.canSaveWsnp,
    canPrint: c.canPrint, hasEditor: c.hasEditor, canFind: c.canFind, canGoBack: c.canGoBack,
    canGoForward: c.canGoForward, hasSnapshots: c.hasSnapshots, canZoom: c.canZoom,
  }
}

function registeredEntry(id: BuiltinCommandId, t: Translate, c: Commands): MenuEntry {
  const definition = definitions.get(id)!
  const available = registry.available(contextOf(c)).some((command) => command.id === id)
  const keyLabel = effectiveKeyTable(isMac()).shortcut(id)
  const actions: Partial<Record<BuiltinCommandId, () => void>> = {
    newFile: c.newFile, openFolder: c.openFolder, openFile: c.openFile, openZip: c.openZip, installPlugin: c.installPlugin, clearRecent: c.clearRecent,
    save: c.save, saveAll: c.saveAll, saveAsWsnp: c.saveAsWsnp, savePdf: c.savePdf, print: c.print,
    openSettings: c.openSettings, closeEditor: c.closeEditor, closeAll: c.closeAll, copy: c.copy, find: c.find,
    commandPalette: c.commandPalette, toggleHidden: c.toggleHidden, toggleSideBar: c.toggleSideBar, goBack: c.goBack,
    goForward: c.goForward, quickOpen: c.quickOpen, nextEditor: c.nextEditor, previousEditor: c.previousEditor,
    openGuide: c.openGuide, showAbout: c.showAbout, showMetadata: c.showMetadata, exit: () => window.close(),
  }
  const item: MenuEntry = {
    id: labels[id] ?? id,
    label: t(definition.title as MessageKey),
    ...(keyLabel ? { shortcut: keyLabel } : {}),
    ...(!available ? { disabled: true } : {}),
    ...(id === 'toggleHidden' ? { checked: c.showHidden } : {}),
    ...(actions[id] ? { run: actions[id] } : {}),
  }
  if (id === 'sort') item.submenu = sortMenuEntries(t, c.sortKey, c.sortDescending, { key: c.setSortKey, descending: c.setSortDescending })
  return item
}

function entriesFor(menuId: string, t: Translate, c: Commands): MenuEntry[] {
  const menuCommands = (builtinCommands as readonly CommandDef[]).filter((command) => command.menu?.menu === menuId && !(isMac() && command.id === 'exit'))
  const groups: string[] = []
  for (const command of menuCommands) if (!groups.includes(command.menu!.group)) groups.push(command.menu!.group)
  const result: MenuEntry[] = []
  for (const group of groups) {
    if (result.length && group !== 'recent') result.push({ separator: true })
    const commands = menuCommands.filter((command) => command.menu!.group === group).sort((a, b) => a.menu!.order - b.menu!.order)
    if (group === 'recent') {
      result.push({ id: 'recent', label: t('menu.openRecent'), submenu: [
        ...(c.recent.length ? c.recent.map((path): MenuEntry => ({ id: `recent:${path}`, label: basename(path), run: () => c.openRecent(path) })) : [{ id: 'none', label: t('menu.noRecent'), disabled: true }]),
        { separator: true }, registeredEntry('clearRecent', t, c),
      ] })
    } else if (group === 'preferences') {
      result.push({ id: 'preferences', label: t('menu.preferences'), submenu: [registeredEntry('openSettings', t, c)] })
    } else result.push(...commands.map((command) => registeredEntry(command.id as BuiltinCommandId, t, c)))
  }
  return result
}

export const MENUS: MenuDef[] = headers.map(({ id, label }) => ({ id, label, entries: (t, c) => entriesFor(id, t, c) }))

