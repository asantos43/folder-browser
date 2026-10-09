import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { builtinCommands, type BuiltinCommandId } from '../core/commands/builtin.ts'
import { builtinKeyTables } from '../core/keys/table.ts'

const menuCommandIds = new Set(builtinCommands.filter((command) => 'menu' in command && command.menu).map((command) => command.id))
function commandId(id: BuiltinCommandId): string {
  if (!menuCommandIds.has(id)) throw new Error(`Command has no menu registration: ${id}`)
  return id
}

/**
 * The native application menu of macOS, as VS Code has it: File, Edit, View, Go, Help. Commands the interface
 * handles go to it as `fb:command`. On Windows and Linux the menu is drawn in the title bar by the interface.
 */
export function installMenu(sendCommand: (command: string) => void): void {
  const send = (id: BuiltinCommandId) => sendCommand(commandId(id))
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  // Native accelerators only forward unambiguous chords; when is resolved in the window.
  const accelerator = (id: BuiltinCommandId) => builtinKeyTables.mac.accelerator(id)
  const template: MenuItemConstructorOptions[] = [
    { label: app.name, submenu: [{ label: `About ${app.name}`, click: () => send('showAbout') }, { type: 'separator' }, { label: 'Settings…', accelerator: accelerator('openSettings'), click: () => send('openSettings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    {
      label: 'File',
      submenu: [
        { label: 'New Text File', accelerator: accelerator('newFile'), click: () => send('newFile') },
        { type: 'separator' },
        { label: 'Open File…', accelerator: accelerator('openFile'), click: () => send('openFile') },
        { label: 'Open ZIP File…', click: () => send('openZip') },
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
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
