import type { BrowserWindow } from 'electron'
import { commandFor } from '../core/shortcuts.ts'

const recording = new WeakMap<object, () => void>()
export function setKeyRecording(contents: BrowserWindow['webContents'], active: boolean): void {
  const resume = recording.get(contents)
  if (active && !resume) {
    // A reload or a crash of the interface unmounts nothing: the shortcuts must come back then too.
    const back = () => setKeyRecording(contents, false)
    contents.once?.('did-navigate', back); contents.once?.('render-process-gone', back)
    recording.set(contents, back)
  } else if (!active && resume) {
    contents.removeListener?.('did-navigate', resume); contents.removeListener?.('render-process-gone', resume)
    recording.delete(contents)
  }
  contents.setIgnoreMenuShortcuts?.(active)
}

/**
 * The workbench's shortcuts work wherever the focus is: a snapshot's frame would never let the interface see `Ctrl+W`, so the
 * main process reads the key before any page does and sends the command. (`before-input-event` also stops the native menu's
 * accelerator, so a key never runs twice.) The interface reads the same table for keys that reach it without this.
 */
export function installShortcuts(win: Pick<BrowserWindow, 'webContents'>, mac = process.platform === 'darwin'): void {
  let cycling = false
  win.webContents.on('before-input-event', (event, input) => {
    if (recording.has(win.webContents)) return // while a key is being recorded every key is the user's
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
