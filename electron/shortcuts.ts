import type { BrowserWindow } from 'electron'
import { commandFor } from '../core/shortcuts.ts'

/**
 * The workbench's shortcuts work wherever the focus is: a snapshot's frame would never let the interface see `Ctrl+W`, so the
 * main process reads the key before any page does and sends the command. (`before-input-event` also stops the native menu's
 * accelerator, so a key never runs twice.) The interface reads the same table for keys that reach it without this.
 */
export function installShortcuts(win: Pick<BrowserWindow, 'webContents'>, mac = process.platform === 'darwin'): void {
  let cycling = false
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyUp') {
      // Ctrl+Tab goes on while Control is held, and ends when it is let go.
      if (cycling && (input.key === 'Control' || input.key === 'Meta')) {
        cycling = false
        win.webContents.send('fb:command', 'cycleEnd')
      }
      return
    }
    if (input.type !== 'keyDown') return
    const command = commandFor({ key: input.key, control: input.control, meta: input.meta, shift: input.shift, alt: input.alt }, mac)
    if (!command) return
    event.preventDefault()
    if (command === 'cycleRecent' || command === 'cycleRecentBack') cycling = true
    win.webContents.send('fb:command', command)
  })
}
