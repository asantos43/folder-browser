import { describe, expect, it, vi } from 'vitest'

// (window.ts imports electron: the part under test does not use it.)
vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, ipcMain: {}, session: {} }))
const { mayLeave, unsavedFrom } = await import('./window.ts')

const MAIN = { frame: 'main' }
/** A window as Electron has it: while it is there, `webContents` answers; once destroyed, asking for it throws, as it does there. */
function windowOf(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    get webContents() {
      if (destroyed) throw new TypeError('Object has been destroyed')
      return { mainFrame: MAIN }
    },
  }
}

describe('unsavedFrom', () => {
  it('takes the count of tabs with changes from the main frame of a window that is there', () => {
    expect(unsavedFrom(windowOf(), MAIN, 3)).toBe(3)
    expect(unsavedFrom(windowOf(), MAIN, 0)).toBe(0)
  })
  it('does not believe another frame, or a count that is not a small whole number', () => {
    expect(unsavedFrom(windowOf(), { frame: 'child' }, 3)).toBeNull()
    for (const count of [-1, 1.5, 10_000, '3', null, undefined, NaN]) expect(unsavedFrom(windowOf(), MAIN, count), String(count)).toBeNull()
  })
  it('ignores a message that arrives as its window is destroyed, with no error (it used to show the user "Object has been destroyed")', () => {
    expect(() => unsavedFrom(windowOf(true), MAIN, 3)).not.toThrow()
    expect(unsavedFrom(windowOf(true), MAIN, 3)).toBeNull()
  })
})

describe('mayLeave', () => {
  it('lets the main frame of a window that is there close it, and nothing else', () => {
    expect(mayLeave(windowOf(), MAIN)).toBe(true)
    expect(mayLeave(windowOf(), { frame: 'child' })).toBe(false)
  })
  it('does nothing for a window that is destroyed, with no error', () => {
    expect(() => mayLeave(windowOf(true), MAIN)).not.toThrow()
    expect(mayLeave(windowOf(true), MAIN)).toBe(false)
  })
})
