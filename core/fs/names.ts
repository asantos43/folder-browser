/** What a name given to a new file or folder, or to a renamed one, may be. Pure: the same rules decide in the interface (before asking) and in the main process (before doing). */

export type NameProblem = 'empty' | 'dots' | 'separator' | 'control' | 'too-long' | 'reserved' | 'trailing' | 'characters'

/** The longest a name may be: 255 bytes of UTF-8, the limit of the usual file systems. */
export const NAME_LIMIT = 255

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const WINDOWS_CHARACTERS = /[<>:"|?*]/

/**
 * (The interface passes the platform the preload says: a page has no `process`.)
 * Why a name cannot be used, or null when it can. Everywhere: not empty (spaces alone are empty), not `.` or `..`, no `/` or `\\` (the app's paths use `/`, and a name with
 * `\\` could not be told from a path), no control characters (a NUL ends a name for the system), at most 255 bytes. On Windows also the characters `< > : " | ? *`, the names the
 * system keeps for devices (`CON`, `NUL`, `COM1`…, with or without an extension), and a name that ends with a space or a dot.
 */
export function nameProblem(name: string, platform: string = typeof process === 'undefined' ? 'linux' : process.platform): NameProblem | null {
  if (name.trim() === '') return 'empty'
  if (name === '.' || name === '..') return 'dots'
  if (name.includes('/') || name.includes('\\')) return 'separator'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'control'
  if (new TextEncoder().encode(name).length > NAME_LIMIT) return 'too-long'
  if (platform === 'win32') {
    if (WINDOWS_CHARACTERS.test(name)) return 'characters'
    if (WINDOWS_RESERVED.test(name)) return 'reserved'
    if (/[ .]$/.test(name)) return 'trailing'
  }
  return null
}
