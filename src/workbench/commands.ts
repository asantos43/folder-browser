import type { MessageKey, Translate } from '@/i18n/index.ts'
import type { MenuEntry } from '@/components/Menu.tsx'
import { basename } from '@/lib/format.ts'
import type { SortKey } from '@core/fs/sort.ts'
import { sortMenuEntries } from './sortMenu.ts'

/** What the workbench can do; the menus, the keyboard and the native menu of macOS all end up here. */
export interface Commands {
  toggleSideBar: () => void
  setTheme: (theme: 'auto' | 'dark' | 'light') => void
  openFile: () => void
  openFolder: () => void
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
  if (!isMac()) return keys
  const parts = keys.split('+')
  const key = parts.pop() ?? ''
  const has = (m: string) => parts.includes(m)
  return [has('Alt') ? '⌥' : '', has('Shift') ? '⇧' : '', has('Ctrl') ? '⌘' : '', key].join('')
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
export const MENUS: MenuDef[] = [
  {
    id: 'file',
    label: 'menu.file',
    entries: (t, c) => [
      { id: 'openFolder', label: t('menu.openFolder'), shortcut: shortcut('Ctrl+Shift+O'), run: c.openFolder },
      { id: 'open', label: t('menu.openFile'), shortcut: shortcut('Ctrl+O'), run: c.openFile },
      {
        id: 'recent',
        label: t('menu.openRecent'),
        submenu: [
          ...(c.recent.length ? c.recent.map((path): MenuEntry => ({ id: `recent:${path}`, label: basename(path), run: () => c.openRecent(path) })) : [{ id: 'none', label: t('menu.noRecent'), disabled: true } as MenuEntry]),
          { separator: true },
          { id: 'clear', label: t('menu.clearRecent'), disabled: !c.recent.length, run: c.clearRecent },
        ],
      },
      { separator: true },
      { id: 'saveAsWsnp', label: t('menu.saveAsWsnp'), disabled: !c.canSaveWsnp, run: c.saveAsWsnp },
      { id: 'savePdf', label: t('menu.savePdf'), disabled: !c.canPrint, run: c.savePdf },
      { separator: true },
      { id: 'print', label: t('menu.print'), shortcut: shortcut('Ctrl+P'), disabled: !c.canPrint, run: c.print },
      { separator: true },
      { id: 'preferences', label: t('menu.preferences'), submenu: [{ id: 'settings', label: t('menu.settings'), shortcut: shortcut('Ctrl+,'), run: c.openSettings }] },
      { separator: true },
      { id: 'close', label: t('menu.closeEditor'), shortcut: shortcut('Ctrl+W'), disabled: !c.hasEditor, run: c.closeEditor },
      { id: 'closeAll', label: t('menu.closeAll'), disabled: !c.hasEditor, run: c.closeAll },
      ...(isMac() ? [] : [{ separator: true } as const, { id: 'exit', label: t('menu.exit'), run: () => window.close() }]),
    ],
  },
  {
    id: 'edit',
    label: 'menu.edit',
    entries: (t, c) => [
      { id: 'copy', label: t('menu.copy'), shortcut: shortcut('Ctrl+C'), disabled: !c.hasEditor, run: c.copy },
      { separator: true },
      { id: 'find', label: t('menu.find'), shortcut: shortcut('Ctrl+F'), disabled: !c.canFind, run: c.find },
    ],
  },
  {
    id: 'view',
    label: 'menu.view',
    entries: (t, c) => [
      { id: 'palette', label: t('menu.commandPalette'), shortcut: shortcut('Ctrl+Shift+P'), run: c.commandPalette },
      { separator: true },
      { id: 'sort', label: t('sort.by'), submenu: sortMenuEntries(t, c.sortKey, c.sortDescending, { key: c.setSortKey, descending: c.setSortDescending }) },
      { id: 'hidden', label: t('menu.showHidden'), shortcut: shortcut('Ctrl+H'), checked: c.showHidden, run: c.toggleHidden },
      { separator: true },
      { id: 'metadata', label: t('menu.showMetadata'), disabled: !c.hasEditor, run: c.showMetadata },
      { separator: true },
      { id: 'sidebar', label: t('menu.toggleSideBar'), shortcut: shortcut('Ctrl+B'), run: c.toggleSideBar },
    ],
  },
  {
    id: 'go',
    label: 'menu.go',
    entries: (t, c) => [
      { id: 'back', label: t('menu.goBack'), shortcut: isMac() ? '⌃-' : 'Alt+Left', disabled: !c.canGoBack, run: c.goBack },
      { id: 'forward', label: t('menu.goForward'), shortcut: isMac() ? '⌃⇧-' : 'Alt+Right', disabled: !c.canGoForward, run: c.goForward },
      { separator: true },
      { id: 'goToFile', label: t('menu.goToFile'), shortcut: shortcut('Ctrl+E'), disabled: !c.hasSnapshots, run: c.quickOpen },
      { separator: true },
      { id: 'next', label: t('menu.nextEditor'), shortcut: shortcut('Ctrl+PageDown'), disabled: !c.hasEditor, run: c.nextEditor },
      { id: 'previous', label: t('menu.previousEditor'), shortcut: shortcut('Ctrl+PageUp'), disabled: !c.hasEditor, run: c.previousEditor },
    ],
  },
  { id: 'help', label: 'menu.help', entries: (t, c) => [{ id: 'about', label: t('menu.about'), run: c.showAbout }] },
]
