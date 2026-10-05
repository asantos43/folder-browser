import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { installShortcuts } from './shortcuts.ts'

/** A window that only knows what installShortcuts asks of it. */
function fakeWindow() {
  const webContents = Object.assign(new EventEmitter(), { send: vi.fn() })
  return { webContents: webContents as unknown as Electron.WebContents, sent: webContents.send }
}
const press = (win: ReturnType<typeof fakeWindow>, input: Partial<Electron.Input>) => {
  const event = { preventDefault: vi.fn() }
  win.webContents.emit('before-input-event', event, { type: 'keyDown', key: '', control: false, meta: false, shift: false, alt: false, ...input })
  return event.preventDefault.mock.calls.length > 0
}

describe('installShortcuts', () => {
  it('sends the command of a workbench shortcut before any page sees the key, and stops the key', () => {
    const win = fakeWindow()
    installShortcuts(win, false)
    expect(press(win, { key: 'w', control: true })).toBe(true)
    expect(win.sent).toHaveBeenCalledWith('fb:command', 'closeEditor')
    expect(press(win, { key: 'b', control: true })).toBe(true)
    expect(win.sent).toHaveBeenLastCalledWith('fb:command', 'toggleSideBar')
  })
  it('sends Find and Print from wherever the focus is, even inside a snapshot’s frame, but leaves Copy to the page', () => {
    const win = fakeWindow()
    installShortcuts(win, false)
    expect(press(win, { key: 'f', control: true })).toBe(true)
    expect(win.sent).toHaveBeenLastCalledWith('fb:command', 'find')
    expect(press(win, { key: 'p', control: true })).toBe(true)
    expect(win.sent).toHaveBeenLastCalledWith('fb:command', 'print')
    expect(press(win, { key: 'p', control: true, shift: true })).toBe(true)
    expect(win.sent).toHaveBeenLastCalledWith('fb:command', 'commandPalette')
    expect(press(win, { key: 'F', control: true, shift: true })).toBe(false)
    expect(press(win, { key: 'c', control: true })).toBe(false)
    expect(win.sent).toHaveBeenCalledTimes(3)
  })
  it('leaves every other key to the page, and ignores key releases', () => {
    const win = fakeWindow()
    installShortcuts(win, false)
    expect(press(win, { key: 'c', control: true })).toBe(false)
    expect(press(win, { key: 'w' })).toBe(false)
    expect(press(win, { type: 'keyUp', key: 'w', control: true })).toBe(false)
    expect(win.sent).not.toHaveBeenCalled()
  })
  it('follows the platform: Command on macOS, Control elsewhere', () => {
    const mac = fakeWindow()
    installShortcuts(mac, true)
    expect(press(mac, { key: 'w', control: true })).toBe(false)
    expect(press(mac, { key: 'w', meta: true })).toBe(true)
    expect(mac.sent).toHaveBeenCalledWith('fb:command', 'closeEditor')
  })
  it('lets Ctrl+Tab go on while Control is held, and ends it when Control is let go', () => {
    const win = fakeWindow()
    installShortcuts(win, false)
    press(win, { key: 'Tab', control: true })
    press(win, { key: 'Tab', control: true })
    expect(win.sent.mock.calls.map((c) => c[1])).toEqual(['cycleRecent', 'cycleRecent'])
    press(win, { type: 'keyUp', key: 'Control' })
    expect(win.sent).toHaveBeenLastCalledWith('fb:command', 'cycleEnd')
    press(win, { type: 'keyUp', key: 'Control' })
    expect(win.sent).toHaveBeenCalledTimes(3)
  })
  it('does not send cycleEnd when nothing was cycling', () => {
    const win = fakeWindow()
    installShortcuts(win, false)
    press(win, { type: 'keyUp', key: 'Control' })
    expect(win.sent).not.toHaveBeenCalled()
  })
})
