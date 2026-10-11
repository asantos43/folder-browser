import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { builtinCommands, type BuiltinCommandId } from '../core/commands/builtin.ts'
import { effectiveKeyTable } from '../core/keys/effective.ts'
import { createKeyTable, platformChord } from '../core/keys/table.ts'
import { assertPluginChord } from '../core/keys/reserved.ts'
import type { GenerationSnapshot } from '../core/plugins/generation.ts'

const pluginMenus = ['file', 'edit', 'view', 'go', 'tools', 'help'] as const
type PluginMenu = typeof pluginMenus[number]
type NativePluginItem = Pick<MenuItemConstructorOptions, 'id' | 'label' | 'enabled' | 'accelerator' | 'type'> & { command?: string }

/** Pure projection: only published owners and resolved keys, never window context. */
export function nativePluginMenus(generation: GenerationSnapshot, platform: string, language = 'en'): Record<PluginMenu, NativePluginItem[]> {
  const result: Record<PluginMenu, NativePluginItem[]> = { file: [], edit: [], view: [], go: [], tools: [], help: [] }
  const active = generation.plugins.filter(plugin => plugin.enabled)
  const commands = new Map(active.flatMap(plugin => plugin.commands.map(command => [command.id, { command, plugin }] as const)))
  const mac = platform === 'darwin'
  const keys = createKeyTable(active.flatMap(plugin => (plugin.resolvedKeys ?? []).map(entry => ({ id: entry.id, keys: (entry.keys ?? []).filter(key => {
    const chord = platformChord(key, mac)
    if (chord === undefined) return false
    try { assertPluginChord(chord, mac); return true } catch { return false }
  }) }))), mac)
  for (const menu of pluginMenus) {
    const items = active.flatMap(plugin => plugin.menuItems).filter(item => item.point === `menubar/${menu}`)
      .sort((a, b) => a.group < b.group ? -1 : a.group > b.group ? 1 : a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    let group: string | undefined
    for (const item of items) {
      const owned = commands.get(item.command)
      if (!owned) continue
      const { command, plugin } = owned
      const text = plugin.texts[command.title]
      const label = text?.[language.startsWith('pt') ? 'pt-BR' : 'en'] ?? text?.en ?? text?.['pt-BR'] ?? command.title
      if (group !== undefined && group !== item.group) result[menu].push({ type: 'separator' })
      group = item.group
      const accelerator = item.when || command.when ? undefined : keys.accelerator(command.id)
      result[menu].push({ id: item.id, label, enabled: command.enabled, command: command.id, ...(accelerator ? { accelerator } : {}) })
    }
  }
  return result
}

const menuCommandIds = new Set(builtinCommands.filter((command) => 'menu' in command && command.menu).map((command) => command.id))
function commandId(id: BuiltinCommandId): string {
  if (!menuCommandIds.has(id)) throw new Error(`Command has no menu registration: ${id}`)
  return id
}

/**
 * The native application menu of macOS, as VS Code has it: File, Edit, View, Go, Help. Commands the interface
 * handles go to it as `fb:command`. On Windows and Linux the menu is drawn in the title bar by the interface.
 */
export function installMenu(sendCommand: (command: string) => void, generation?: GenerationSnapshot): void {
  const send = (id: BuiltinCommandId) => sendCommand(commandId(id))
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  // Native accelerators only forward unambiguous chords; when is resolved in the window.
  const accelerator = (id: BuiltinCommandId) => effectiveKeyTable(true).accelerator(id)
  const template: MenuItemConstructorOptions[] = [
    { label: app.name, submenu: [{ label: `About ${app.name}`, click: () => send('showAbout') }, { type: 'separator' }, { label: 'Settings…', accelerator: accelerator('openSettings'), click: () => send('openSettings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    {
      label: 'File',
      submenu: [
        { label: 'New Text File', accelerator: accelerator('newFile'), click: () => send('newFile') },
        { type: 'separator' },
        { label: 'Open File…', accelerator: accelerator('openFile'), click: () => send('openFile') },
        { label: 'Open ZIP File…', click: () => send('openZip') },
        { label: app.getLocale().toLowerCase().startsWith('pt') ? 'Instalar Plugin de um Arquivo…' : 'Install Plugin from File…', click: () => send('installPlugin') },
        { type: 'separator' },
        { label: 'Save', accelerator: accelerator('save'), click: () => send('save') },
        { label: 'Save All', accelerator: accelerator('saveAll'), click: () => send('saveAll') },
        { type: 'separator' },
        { label: 'Save as .wsnp…', click: () => send('saveAsWsnp') },
        { label: 'Save as PDF…', click: () => send('savePdf') },
        { type: 'separator' },
        { label: 'Print…', accelerator: accelerator('print'), click: () => send('print') },
        { type: 'separator' },
        { label: 'Close Editor', accelerator: accelerator('closeEditor'), click: () => send('closeEditor') },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' }, { label: 'Find', accelerator: accelerator('find'), click: () => send('find') }] },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette…', accelerator: accelerator('commandPalette'), click: () => send('commandPalette') },
        { type: 'separator' },
        { label: 'Toggle Side Bar', accelerator: accelerator('toggleSideBar'), click: () => send('toggleSideBar') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Go Back', accelerator: accelerator('goBack'), click: () => send('goBack') },
        { label: 'Go Forward', accelerator: accelerator('goForward'), click: () => send('goForward') },
        { type: 'separator' },
        { label: 'Go to File…', accelerator: accelerator('quickOpen'), click: () => send('quickOpen') },
        { type: 'separator' },
        { label: 'Next Editor', accelerator: accelerator('nextEditor'), click: () => send('nextEditor') },
        { label: 'Previous Editor', accelerator: accelerator('previousEditor'), click: () => send('previousEditor') },
      ],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'User Guide', accelerator: accelerator('openGuide'), click: () => send('openGuide') }] },
  ]
  if (generation) {
    const projected = nativePluginMenus(generation, process.platform, app.getLocale())
    for (const menu of pluginMenus) {
      const entries: MenuItemConstructorOptions[] = projected[menu].map(({ command, ...item }) => ({ ...item, ...(command ? { click: () => sendCommand(command) } : {}) }))
      if (!entries.length) continue
      if (menu === 'tools') {
        template.splice(template.findIndex(item => item.role === 'windowMenu'), 0, { label: 'Tools', submenu: entries })
      } else {
        const target = template.find(item => menu === 'help' ? item.role === 'help' : item.label?.toLowerCase() === menu)!
        ;(target.submenu as MenuItemConstructorOptions[]).push({ type: 'separator' }, ...entries)
      }
    }
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
