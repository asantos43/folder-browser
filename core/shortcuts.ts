import { effectiveKeyTable } from './keys/effective.ts'
import type { WhenContext } from './commands/when.ts'

/** The keys of a keyboard event, as the window's `keydown` and the main process's `before-input-event` both give them. */
export interface KeyLike {
  key: string
  control?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
}

export type CommandName = 'newFile' | 'toggleSideBar' | 'openFile' | 'openFolder' | 'openZip' | 'openGuide' | 'toggleHidden' | 'find' | 'print' | 'quickOpen' | 'commandPalette' | 'goBack' | 'goForward' | 'openSettings' | 'zoomIn' | 'zoomOut' | 'zoomReset' | 'closeEditor' | 'save' | 'saveAll' | 'nextEditor' | 'previousEditor' | 'cycleRecent' | 'cycleRecentBack' | 'goToTab1' | 'goToTab2' | 'goToTab3' | 'goToTab4' | 'goToTab5' | 'goToTab6' | 'goToTab7' | 'goToTab8' | 'goToTab9'

/**
 * VS Code's shortcuts for the commands the viewer has (docs/UI-DESIGN.md, "Behaviour taken from VS Code"): Ctrl on Windows
 * and Linux, Command on macOS. Both processes read this one table, so a key does the same whether the page has the focus
 * or a snapshot's frame does (a frame never lets the interface see the key).
 */
export function commandFor(e: KeyLike, mac: boolean, context?: WhenContext): CommandName | null {
  const ids = effectiveKeyTable(mac).lookup(e, context)
  // The main process has no window context: only unambiguous chords may be forwarded.
  // Copy stays with the focused editor/page, as before the table existed.
  return ids.length === 1 && ids[0] !== 'copy' ? ids[0] as CommandName : null
}
