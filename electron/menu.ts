import { app, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * The native application menu of macOS, as VS Code has it: File, Edit, View, Go, Help. Commands the interface
 * handles go to it as `fb:command`. On Windows and Linux the menu is drawn in the title bar by the interface.
 */
export function installMenu(send: (command: string) => void): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const template: MenuItemConstructorOptions[] = [
    { label: app.name, submenu: [{ label: `About ${app.name}`, click: () => send('showAbout') }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('openSettings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    {
      label: 'File',
      submenu: [
        { label: 'Open File…', accelerator: 'Cmd+O', click: () => send('openFile') },
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
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'selectAll' }, { type: 'separator' }, { label: 'Find', accelerator: 'Cmd+F', click: () => send('find') }] },
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
    { role: 'help', submenu: [] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
