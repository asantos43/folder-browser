import { describe, expect, it } from 'vitest'
import { commandFor } from './shortcuts.ts'

describe('commandFor', () => {
  it('uses Ctrl on Windows and Linux', () => {
    expect(commandFor({ key: 'b', control: true }, false)).toBe('toggleSideBar')
    expect(commandFor({ key: 'B', control: true }, false)).toBe('toggleSideBar')
    expect(commandFor({ key: 'o', control: true }, false)).toBe('openFile')
    expect(commandFor({ key: 'w', control: true }, false)).toBe('closeEditor')
    expect(commandFor({ key: 'PageDown', control: true }, false)).toBe('nextEditor')
    expect(commandFor({ key: 'PageUp', control: true }, false)).toBe('previousEditor')
    expect(commandFor({ key: 'b', meta: true }, false)).toBeNull()
  })
  it('finds with Ctrl+F and prints with Ctrl+P (Command on macOS), and Ctrl+Shift+P is the palette, not Print', () => {
    expect(commandFor({ key: 'f', control: true }, false)).toBe('find')
    expect(commandFor({ key: 'F', control: true }, false)).toBe('find')
    expect(commandFor({ key: 'p', control: true }, false)).toBe('print')
    expect(commandFor({ key: 'f', meta: true }, true)).toBe('find')
    expect(commandFor({ key: 'p', meta: true }, true)).toBe('print')
    expect(commandFor({ key: 'p', control: true, shift: true }, false)).toBe('commandPalette')
    expect(commandFor({ key: 'f', control: true, shift: true }, false)).toBeNull()
    expect(commandFor({ key: 'f', control: true, alt: true }, false)).toBeNull()
    expect(commandFor({ key: 'f', meta: true }, false)).toBeNull()
  })
  it('opens Go to File with Ctrl+E and the palette with Ctrl+Shift+P; goes back and forward with Alt+Left and Alt+Right (Control+- on macOS)', () => {
    expect(commandFor({ key: 'e', control: true }, false)).toBe('quickOpen')
    expect(commandFor({ key: 'P', control: true, shift: true }, false)).toBe('commandPalette')
    expect(commandFor({ key: 'p', meta: true, shift: true }, true)).toBe('commandPalette')
    expect(commandFor({ key: 'ArrowLeft', alt: true }, false)).toBe('goBack')
    expect(commandFor({ key: 'ArrowRight', alt: true }, false)).toBe('goForward')
    expect(commandFor({ key: 'ArrowLeft', alt: true, control: true }, false)).toBeNull()
    expect(commandFor({ key: 'ArrowLeft', alt: true }, true)).toBeNull()
    expect(commandFor({ key: '-', control: true }, true)).toBe('goBack')
    expect(commandFor({ key: '_', control: true, shift: true }, true)).toBeNull()
    expect(commandFor({ key: '-', control: true, shift: true }, true)).toBe('goForward')
    expect(commandFor({ key: '-', meta: true }, true)).toBe('zoomOut')
    expect(commandFor({ key: '-', control: true }, false)).toBe('zoomOut')
  })
  it('uses Command on macOS', () => {
    expect(commandFor({ key: 'b', meta: true }, true)).toBe('toggleSideBar')
    expect(commandFor({ key: 'w', meta: true }, true)).toBe('closeEditor')
    expect(commandFor({ key: 'b', control: true }, true)).toBeNull()
  })
  it('goes to tab N with Alt+N, or Command+N on macOS', () => {
    expect(commandFor({ key: '3', alt: true }, false)).toBe('goToTab3')
    expect(commandFor({ key: '9', alt: true }, false)).toBe('goToTab9')
    expect(commandFor({ key: '0', alt: true }, false)).toBeNull()
    expect(commandFor({ key: '2', meta: true }, true)).toBe('goToTab2')
    expect(commandFor({ key: '2', control: true }, false)).toBeNull()
  })
  it('cycles through the tabs in the order of use with Ctrl+Tab and Ctrl+Shift+Tab, everywhere', () => {
    for (const mac of [false, true]) {
      expect(commandFor({ key: 'Tab', control: true }, mac)).toBe('cycleRecent')
      expect(commandFor({ key: 'Tab', control: true, shift: true }, mac)).toBe('cycleRecentBack')
    }
  })
  it('leaves everything else to the page: no modifier, other modifiers, other keys', () => {
    expect(commandFor({ key: 'b' }, false)).toBeNull()
    expect(commandFor({ key: 'b', control: true, shift: true }, false)).toBeNull()
    expect(commandFor({ key: 'b', control: true, alt: true }, false)).toBeNull()
    expect(commandFor({ key: 'c', control: true }, false)).toBeNull()
    expect(commandFor({ key: 'Tab' }, false)).toBeNull()
  })
})

describe('commandFor: settings and zoom of the interface', () => {
  it('opens Settings with Ctrl+, (Command+, on macOS)', () => {
    expect(commandFor({ key: ',', control: true }, false)).toBe('openSettings')
    expect(commandFor({ key: ',', meta: true }, true)).toBe('openSettings')
    expect(commandFor({ key: ',', control: true }, true)).toBeNull()
  })
  it('zooms with Ctrl+=, Ctrl++ (Ctrl+Shift+=), Ctrl+- and Ctrl+0', () => {
    expect(commandFor({ key: '=', control: true }, false)).toBe('zoomIn')
    expect(commandFor({ key: '+', control: true, shift: true }, false)).toBe('zoomIn')
    expect(commandFor({ key: '-', control: true }, false)).toBe('zoomOut')
    expect(commandFor({ key: '0', control: true }, false)).toBe('zoomReset')
    expect(commandFor({ key: '=', meta: true }, true)).toBe('zoomIn')
    expect(commandFor({ key: '0', meta: true }, true)).toBe('zoomReset')
  })
  it('leaves the plain keys to a viewer: + - 0 zoom a picture, not the interface', () => {
    for (const key of ['+', '-', '=', '0']) expect(commandFor({ key }, false), key).toBeNull()
  })
})

describe('commandFor: saving', () => {
  it('saves with Ctrl+S (Command+S on macOS), and saves all with Ctrl+Alt+S (Command+Option+S)', () => {
    expect(commandFor({ key: 's', control: true }, false)).toBe('save')
    expect(commandFor({ key: 'S', control: true }, false)).toBe('save')
    expect(commandFor({ key: 's', meta: true }, true)).toBe('save')
    expect(commandFor({ key: 's', control: true, alt: true }, false)).toBe('saveAll')
    expect(commandFor({ key: 's', meta: true, alt: true }, true)).toBe('saveAll')
  })
  it('leaves a plain s, Command+S on Linux, and Ctrl+Shift+S to the page', () => {
    expect(commandFor({ key: 's' }, false)).toBeNull()
    expect(commandFor({ key: 's', meta: true }, false)).toBeNull()
    expect(commandFor({ key: 's', control: true, shift: true }, false)).toBeNull()
  })
})
