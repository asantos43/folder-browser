import type { CommandDef, CommandHandlers, HandlerMap } from './registry.ts'

/** Current workbench commands copied as data; core never imports the renderer. */
export const builtinCommands = [
  { id: 'newFile', title: 'menu.newFile', category: 'file', keys: ['Ctrl+N'], menu: { menu: 'file', group: 'start', order: 0 }, palette: true },
  { id: 'openFolder', title: 'menu.openFolder', category: 'file', keys: ['Ctrl+Shift+O'], menu: { menu: 'file', group: 'open', order: 0 }, palette: true },
  { id: 'openFile', title: 'menu.openFile', category: 'file', keys: ['Ctrl+O'], menu: { menu: 'file', group: 'open', order: 1 }, palette: true },
  { id: 'openZip', title: 'menu.openZip', category: 'file', menu: { menu: 'file', group: 'open', order: 2 }, palette: true },
  { id: 'clearRecent', title: 'menu.clearRecent', category: 'file', when: 'hasRecent', menu: { menu: 'file', group: 'recent', order: 0 }, palette: true },
  { id: 'save', title: 'menu.save', category: 'file', when: 'canSave', keys: ['Ctrl+S'], menu: { menu: 'file', group: 'save', order: 0 }, palette: true },
  { id: 'saveAll', title: 'menu.saveAll', category: 'file', when: 'canSaveAll', keys: ['Ctrl+Alt+S'], menu: { menu: 'file', group: 'save', order: 1 }, palette: true },
  { id: 'saveAsWsnp', title: 'menu.saveAsWsnp', category: 'file', when: 'canSaveWsnp', menu: { menu: 'file', group: 'export', order: 0 }, palette: true },
  { id: 'savePdf', title: 'menu.savePdf', category: 'file', when: 'canPrint', menu: { menu: 'file', group: 'export', order: 1 }, palette: true },
  { id: 'print', title: 'menu.print', category: 'file', when: 'canPrint', keys: ['Ctrl+P'], menu: { menu: 'file', group: 'print', order: 0 }, palette: true },
  { id: 'openSettings', title: 'menu.settings', category: 'file', keys: ['Ctrl+,'], menu: { menu: 'file', group: 'preferences', order: 0 }, palette: true },
  { id: 'closeEditor', title: 'menu.closeEditor', category: 'file', when: 'hasEditor', keys: ['Ctrl+W'], menu: { menu: 'file', group: 'close', order: 0 }, palette: true },
  { id: 'closeAll', title: 'menu.closeAll', category: 'file', when: 'hasEditor', menu: { menu: 'file', group: 'close', order: 1 }, palette: true },
  { id: 'copy', title: 'menu.copy', category: 'edit', when: 'hasEditor', keys: ['Ctrl+C'], menu: { menu: 'edit', group: 'edit', order: 0 }, palette: true },
  { id: 'find', title: 'menu.find', category: 'edit', when: 'canFind', keys: ['Ctrl+F'], menu: { menu: 'edit', group: 'find', order: 0 }, palette: true },
  { id: 'commandPalette', title: 'menu.commandPalette', category: 'view', keys: ['Ctrl+Shift+P'], menu: { menu: 'view', group: 'commands', order: 0 }, palette: true },
  { id: 'sort', title: 'sort.by', category: 'view', menu: { menu: 'view', group: 'sort', order: 0 }, palette: true },
  { id: 'toggleHidden', title: 'menu.showHidden', category: 'view', keys: ['Ctrl+H'], menu: { menu: 'view', group: 'sort', order: 1 }, palette: true },
  { id: 'showMetadata', title: 'menu.showMetadata', category: 'view', when: 'hasEditor', menu: { menu: 'view', group: 'metadata', order: 0 }, palette: true },
  { id: 'toggleSideBar', title: 'menu.toggleSideBar', category: 'view', keys: ['Ctrl+B'], menu: { menu: 'view', group: 'sidebar', order: 0 }, palette: true },
  { id: 'goBack', title: 'menu.goBack', category: 'go', when: 'canGoBack', keys: ['Alt+Left'], menu: { menu: 'go', group: 'history', order: 0 }, palette: true },
  { id: 'goForward', title: 'menu.goForward', category: 'go', when: 'canGoForward', keys: ['Alt+Right'], menu: { menu: 'go', group: 'history', order: 1 }, palette: true },
  { id: 'quickOpen', title: 'menu.goToFile', category: 'go', when: 'hasSnapshots', keys: ['Ctrl+E'], menu: { menu: 'go', group: 'files', order: 0 }, palette: true },
  { id: 'nextEditor', title: 'menu.nextEditor', category: 'go', when: 'hasEditor', keys: ['Ctrl+PageDown'], menu: { menu: 'go', group: 'editors', order: 0 }, palette: true },
  { id: 'previousEditor', title: 'menu.previousEditor', category: 'go', when: 'hasEditor', keys: ['Ctrl+PageUp'], menu: { menu: 'go', group: 'editors', order: 1 }, palette: true },
  { id: 'openGuide', title: 'menu.userGuide', category: 'help', keys: ['F1'], menu: { menu: 'help', group: 'help', order: 0 }, palette: true },
  { id: 'showAbout', title: 'menu.about', category: 'help', menu: { menu: 'help', group: 'about', order: 0 }, palette: true },
  { id: 'exit', title: 'menu.exit', category: 'file', menu: { menu: 'file', group: 'exit', order: 0 }, palette: true },
  { id: 'zoomIn', title: 'menu.zoomIn', category: 'view', when: 'canZoom', keys: ['Mod+=', 'Mod++', 'Mod+Shift++'], palette: true },
  { id: 'zoomOut', title: 'menu.zoomOut', category: 'view', when: 'canZoom', keys: ['Mod+-'], palette: true },
  { id: 'zoomReset', title: 'menu.resetZoom', category: 'view', when: 'canZoom', keys: ['Mod+0'], palette: true },
  { id: 'themeDark', title: 'quickOpen.theme', category: 'view', palette: true },
  { id: 'themeLight', title: 'quickOpen.theme', category: 'view', palette: true },
] as const satisfies readonly CommandDef[]

export type BuiltinCommandId = typeof builtinCommands[number]['id']

/** Legacy menu strings use Ctrl for Mod; keep their presentation while sharing actual defaults. */
export const builtinKeyCommands = [
  ...builtinCommands.map((command) => ({
    id: command.id,
    keys: 'keys' in command ? command.keys.flatMap((key) => {
      if (key === 'Alt+Left') return ['nonmac:Alt+Left', 'mac:Ctrl+-']
      if (key === 'Alt+Right') return ['nonmac:Alt+Right', 'mac:Ctrl+Shift+-']
      return [key.replace(/^Ctrl\+/, 'Mod+')]
    }) : [],
  })),
  { id: 'cycleRecent', keys: ['Ctrl+Tab'] },
  { id: 'cycleRecentBack', keys: ['Ctrl+Shift+Tab'] },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `goToTab${i + 1}`, keys: [`mac:Mod+${i + 1}`, `nonmac:Alt+${i + 1}`] })),
] as const

export type BuiltinHandlers = HandlerMap<BuiltinCommandId>
export function bindBuiltinHandlers(handlers: BuiltinHandlers): BuiltinHandlers { return handlers }

/** Dispatch an id defensively: ids from old callers or extensions have no effect here. */
export function runBuiltinCommand(handlers: CommandHandlers<BuiltinCommandId>, id: string): void {
  if (Object.hasOwn(handlers, id)) handlers[id as BuiltinCommandId]()
}
