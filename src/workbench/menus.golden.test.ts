// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ptBR } from '@/i18n/pt-BR.ts'
import { en } from '@/i18n/en.ts'
import { translator } from '@/i18n/index.ts'
import type { MenuEntry } from '@/components/Menu.tsx'
import { commandItems } from './QuickOpen.tsx'
import { MENUS, type Commands } from './commands.ts'

const platforms = ['linux', 'win32', 'darwin'] as const
const languages = ['en', 'pt-BR'] as const
function setPlatform(value: typeof platforms[number]) {
  Object.defineProperty(window, 'fb', { configurable: true, value: { platform: value } })
}
function commands(open: boolean): Commands {
  const noop = () => {}
  return {
    toggleSideBar: noop, setTheme: noop, openFile: noop, newFile: noop, openFolder: noop, openZip: noop, openGuide: noop,
    toggleHidden: noop, showHidden: false, sortKey: 'name', sortDescending: false, setSortKey: noop, setSortDescending: noop,
    print: noop, savePdf: noop, saveAsWsnp: noop, quickOpen: noop, commandPalette: noop, goBack: noop, goForward: noop,
    copy: noop, find: noop, openRecent: noop, clearRecent: noop, closeEditor: noop, closeAll: noop, save: noop, saveAll: noop,
    canSave: open, canSaveAll: open, nextEditor: noop, previousEditor: noop, showMetadata: noop, openSettings: noop, showAbout: noop,
    zoomIn: noop, zoomOut: noop, zoomReset: noop, hasEditor: open, hasSnapshots: open, canFind: open, canPrint: open,
    canSaveWsnp: open, canGoBack: open, canGoForward: open, canZoom: open, recent: [],
  }
}
function menuJSON(language: typeof languages[number], c: Commands) {
  const t = translator(language)
  const entries = (items: MenuEntry[]): unknown[] => items.map((item) => {
    if ('separator' in item) return { separator: true }
    return { id: item.id, label: item.label, ...(item.shortcut ? { shortcut: item.shortcut } : {}), ...(item.disabled !== undefined ? { disabled: item.disabled } : {}), ...(item.checked !== undefined ? { checked: item.checked } : {}), ...(item.submenu ? { submenu: entries(item.submenu) } : {}) }
  })
  return MENUS.map((menu) => ({ id: menu.id, label: t(menu.label), items: entries(menu.entries(t, c)) }))
}
function paletteJSON(language: typeof languages[number], c: Commands) {
  return commandItems(translator(language), c, c.setTheme).map(({ id, label, description, shortcut: key }) => ({ id, label, description, ...(key ? { shortcut: key } : {}) }))
}

describe('menus and command palette golden behavior', () => {
  for (const platform of platforms) for (const language of languages) {
    it(`${platform} / ${language}`, () => {
      setPlatform(platform)
      const snapshots = {
        menus: menuJSON(language, commands(false)),
        paletteNothingOpen: paletteJSON(language, commands(false)),
        paletteTextFileOpen: paletteJSON(language, commands(true)),
      }
      expect(JSON.stringify(snapshots, null, 2)).toMatchSnapshot()
    })
  }

  it('keeps native menu command ids in Commands and menu definitions, with translation key parity', () => {
    const commandNames = new Set(Object.keys(commands(false)))
    const native = readFileSync('electron/menu.ts', 'utf8')
    const sent = [...native.matchAll(/send\('([A-Za-z0-9]+)'\)/g)].map((match) => match[1])
    for (const id of sent) expect(commandNames.has(id), `native menu sends unknown command ${id}`).toBe(true)
    const menuIds = new Set<string>()
    const visit = (items: MenuEntry[]) => items.forEach((item) => { if (!('separator' in item)) { menuIds.add(item.id); if (item.submenu) visit(item.submenu) } })
    for (const menu of MENUS) visit(menu.entries(translator('en'), commands(false)))
    for (const id of sent) expect(menuIds.has(id) || commandNames.has(id), `unregistered native command ${id}`).toBe(true)
    expect(Object.keys(en).sort()).toEqual(Object.keys(ptBR).sort())
  })

  it('assembles current menus and palette within the 5 ms budget (median of 20)', () => {
    setPlatform('linux')
    const samples: number[] = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      menuJSON('en', commands(false))
      paletteJSON('en', commands(false))
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    const median = (samples[9] + samples[10]) / 2
    console.info(`menus + palette median (20): ${median.toFixed(3)} ms`)
    expect(median).toBeLessThanOrEqual(5)
  })
})
