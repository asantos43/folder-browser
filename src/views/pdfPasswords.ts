/**
 * A password remembered for a single, current version of a PDF, **only while the app is open**: a key the renderer can ask for
 * before showing the password form, and forget as soon as the user types one that is wrong. The map lives in the module
 * (closing the window empties it), and is never written to disk, `localStorage`, `sessionStorage`, IPC or anywhere else.
 *
 * The key is the file's id (`${snapshotId}:${path}` in `PdfView`), its size, and a cheap FNV-1a 32-bit hash of the first
 * and last 4 KiB of its bytes (or of the whole file when it is smaller than 8 KiB). It catches a re-save of the same file
 * (size or first/last byte changed) without ever reading the whole file.
 */

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const HEAD_BYTES = 4096
const TAIL_BYTES = 4096
/** The most passwords kept in memory: enough for a session, small enough that the map stays free. */
const PASSWORD_LIMIT = 32

const passwords = new Map<string, string>()

function fnv1a(bytes: Uint8Array, start: number, end: number): number {
  let hash = FNV_OFFSET >>> 0
  for (let i = start; i < end; i++) {
    hash = Math.imul(hash ^ bytes[i]!, FNV_PRIME) >>> 0
  }
  return hash
}

const toHex = (n: number): string => n.toString(16).padStart(8, '0')

/** A key that changes when the id, the size, or the first/last bytes change, but never scans the whole file. */
export function pdfPasswordKey(id: string, bytes: Uint8Array): string {
  const size = bytes.byteLength
  let headHash: number
  let tailHash: number
  if (size <= HEAD_BYTES + TAIL_BYTES) {
    headHash = fnv1a(bytes, 0, size)
    tailHash = 0
  } else {
    headHash = fnv1a(bytes, 0, HEAD_BYTES)
    tailHash = fnv1a(bytes, size - TAIL_BYTES, size)
  }
  return `${id}|${size}|${toHex(headHash)}${toHex(tailHash)}`
}

/** The password remembered for `key`, or `undefined`. A read renews the entry: it counts as the most recent. */
export function getPdfPassword(key: string): string | undefined {
  const value = passwords.get(key)
  if (value === undefined) return undefined
  passwords.delete(key)
  passwords.set(key, value)
  return value
}

/** Remember `password` for `key`. An empty password is ignored, leaving any prior entry in place. The 33rd distinct key evicts the oldest. */
export function rememberPdfPassword(key: string, password: string): void {
  if (!password) return
  if (passwords.has(key)) {
    passwords.delete(key)
  } else if (passwords.size >= PASSWORD_LIMIT) {
    const oldest = passwords.keys().next().value
    if (oldest !== undefined) passwords.delete(oldest)
  }
  passwords.set(key, password)
}

/** Drop the password of one file (after a wrong one, when the user asks, or when the file changes). */
export function forgetPdfPassword(key: string): void {
  passwords.delete(key)
}

/** Drop every password (used by tests and by anything that resets the app state). */
export function clearPdfPasswords(): void {
  passwords.clear()
}
