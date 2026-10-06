/** The keys of a keyboard event, as the window's `keydown` and the main process's `before-input-event` both give them. */
export interface KeyLike {
  key: string
  control?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
}

export type CommandName = 'toggleSideBar' | 'openFile' | 'openFolder' | 'toggleHidden' | 'find' | 'print' | 'quickOpen' | 'commandPalette' | 'goBack' | 'goForward' | 'openSettings' | 'zoomIn' | 'zoomOut' | 'zoomReset' | 'closeEditor' | 'nextEditor' | 'previousEditor' | 'cycleRecent' | 'cycleRecentBack' | 'goToTab1' | 'goToTab2' | 'goToTab3' | 'goToTab4' | 'goToTab5' | 'goToTab6' | 'goToTab7' | 'goToTab8' | 'goToTab9'

/**
 * VS Code's shortcuts for the commands the viewer has (docs/UI-DESIGN.md, "Behaviour taken from VS Code"): Ctrl on Windows
 * and Linux, Command on macOS. Both processes read this one table, so a key does the same whether the page has the focus
 * or a snapshot's frame does (a frame never lets the interface see the key).
 */
export function commandFor(e: KeyLike, mac: boolean): CommandName | null {
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
      // Show or hide the hidden files, as a file manager's Ctrl+H does.
      if (key === 'h') return 'toggleHidden'
      if (key === 'f') return 'find'
      if (key === 'p') return 'print'
      if (key === 'w') return 'closeEditor'
      if (key === 'PageDown') return 'nextEditor'
      if (key === 'PageUp') return 'previousEditor'
      if (mac && /^[1-9]$/.test(key)) return `goToTab${key}` as CommandName
    }
  }
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
