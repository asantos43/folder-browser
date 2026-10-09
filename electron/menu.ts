import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { builtinCommands, type BuiltinCommandId } from '../core/commands/builtin.ts'

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
  const template: MenuItemConstructorOptions[] = [
    { label: app.name, submenu: [{ label: `About ${app.name}`, click: () => send('showAbout') }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('openSettings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    {
      label: 'File',
      submenu: [
        { label: 'New Text File', accelerator: 'Cmd+N', click: () => send('newFile') },
        { type: 'separator' },
        { label: 'Open File…', accelerator: 'Cmd+O', click: () => send('openFile') },
        { label: 'Open ZIP File…', click: () => send('openZip') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'Cmd+S', click: () => send('save') },
        { label: 'Save All', accelerator: 'Cmd+Alt+S', click: () => send('saveAll') },
        { type: 'separator' },
        { label: 'Save as .wsnp…', click: () => send('saveAsWsnp') },
        { label: 'Save as PDF…', click: () => send('savePdf') },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'Cmd+P', click: () => send('print') },
        { type: 'separator' },
        { label: 'Close Editor', accelerator: 'Cmd+W', click: () => send('closeEditor') },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' }, { label: 'Find', accelerator: 'Cmd+F', click: () => send('find') }] },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette…', accelerator: 'Cmd+Shift+P', click: () => send('commandPalette') },
        { type: 'separator' },
        { label: 'Toggle Side Bar', accelerator: 'Cmd+B', click: () => send('toggleSideBar') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Go Back', accelerator: 'Ctrl+-', click: () => send('goBack') },
        { label: 'Go Forward', accelerator: 'Ctrl+Shift+-', click: () => send('goForward') },
        { type: 'separator' },
        { label: 'Go to File…', accelerator: 'Cmd+E', click: () => send('quickOpen') },
        { type: 'separator' },
        { label: 'Next Editor', accelerator: 'Cmd+PageDown', click: () => send('nextEditor') },
        { label: 'Previous Editor', accelerator: 'Cmd+PageUp', click: () => send('previousEditor') },
      ],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'User Guide', accelerator: 'F1', click: () => send('openGuide') }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
