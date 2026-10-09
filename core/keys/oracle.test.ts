import { expect, it } from 'vitest'
import { commandFor, type KeyLike, type CommandName } from '../shortcuts.ts'

// Frozen pre-table implementation; do not import any new key logic here.
function referenceCommandFor(e: KeyLike, mac: boolean): CommandName | null {
  const mod = mac ? e.meta && !e.control : e.control && !e.meta
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (mod && !e.alt) {
    // Zoom: Ctrl+= (and Ctrl++, which is Ctrl+Shift+= on most keyboards), Ctrl+-, Ctrl+0, as VS Code does.
    if (key === '+' || (key === '=' && !e.shift)) return 'zoomIn'
    if (key === '-' && !e.shift) return 'zoomOut'
    if (key === '0' && !e.shift) return 'zoomReset'
    // The command palette, as in VS Code (Ctrl+P is Print here).
    if (e.shift && key === 'p') return 'commandPalette'
    // Open Folder (Ctrl+Shift+O); in VS Code it is a chord, which the viewer has no way to wait for.
    if (e.shift && key === 'o') return 'openFolder'
    if (!e.shift) {
      if (key === 'e') return 'quickOpen'
      if (key === ',') return 'openSettings'
      if (key === 'b') return 'toggleSideBar'
      if (key === 'o') return 'openFile'
      if (key === 'n') return 'newFile'
      // Show or hide the hidden files, as a file manager's Ctrl+H does.
      if (key === 'h') return 'toggleHidden'
      if (key === 'f') return 'find'
      if (key === 's') return 'save'
      if (key === 'p') return 'print'
      if (key === 'w') return 'closeEditor'
      if (key === 'PageDown') return 'nextEditor'
      if (key === 'PageUp') return 'previousEditor'
      if (mac && /^[1-9]$/.test(key)) return `goToTab${key}` as CommandName
    }
  }
  // The user guide: F1 (in VS Code it is the command palette, which has Ctrl+Shift+P here).
  if (key === 'F1' && !e.control && !e.meta && !e.alt && !e.shift) return 'openGuide'
  // Save All: Ctrl+Alt+S (in VS Code it is a chord, which the viewer has no way to wait for).
  if (mod && e.alt && !e.shift && key === 's') return 'saveAll'
  // Ctrl+Tab goes through the tabs in the order they were used, on every system, Control (not Command) as in VS Code.
  if (e.control && !e.meta && !e.alt && key === 'Tab') return e.shift ? 'cycleRecentBack' : 'cycleRecent'
  if (!mac && e.alt && !e.control && !e.meta && !e.shift && /^[1-9]$/.test(key)) return `goToTab${key}` as CommandName
  // Back and forward through the tabs visited: Alt+Left and Alt+Right, and Control+- and Control+Shift+- on macOS, as VS Code has them.
  if (!mac && e.alt && !e.control && !e.meta && !e.shift) {
    if (key === 'ArrowLeft') return 'goBack'
    if (key === 'ArrowRight') return 'goForward'
  }
  if (mac && e.control && !e.meta && !e.alt && key === '-') return e.shift ? 'goForward' : 'goBack'
  return null
}


it('matches the frozen oracle for every relevant key, modifier and platform', () => {
  const keys = [...new Set([
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown',
    'Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'Home', 'End', ' ',
    ...'!@#$%^&*()-_=+[]{};:\'",.<>/?`~\\',
  ])]
  const differences: string[] = []
  for (const mac of [false, true]) for (const key of keys) for (let mask = 0; mask < 16; mask++) {
    const event = { key, control: !!(mask & 1), meta: !!(mask & 2), shift: !!(mask & 4), alt: !!(mask & 8) }
    const expected = referenceCommandFor(event, mac)
    const actual = commandFor(event, mac)
    if (actual !== expected) differences.push(`${JSON.stringify({ mac, ...event })}: expected ${expected}, got ${actual}`)
  }
  expect(differences, differences.join('\n')).toEqual([])
})
