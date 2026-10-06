import { canProbe, TEXT_LIMIT, viewKind } from './filekind.ts'

/** One side of a comparison: a file of a folder or ZIP that was opened (`path` is relative to the root, `zip!/entry` inside a ZIP). */
export interface DiffSide {
  rootId: string
  path: string
}

export type LineEnding = 'lf' | 'crlf' | 'cr'

/**
 * Whether a file can be a side of a comparison: it is shown as text (or may be: a file of no known type is looked at when it is read) and is no bigger than `TEXT_LIMIT`.
 * A log, which a tab opens up to 32 MiB, is not compared: the diff keeps both texts, and their differences, in memory.
 */
export function comparable(name: string, size: number): boolean {
  return size <= TEXT_LIMIT && (viewKind(undefined, name, size) === 'text' || canProbe(undefined, name, size))
}

/** The line ending a text mostly uses: the first one it has (`lf` when it has none). */
export function lineEndingOf(text: string): LineEnding {
  const at = text.search(/\r|\n/)
  if (at < 0 || text[at] === '\n') return 'lf'
  return text[at + 1] === '\n' ? 'crlf' : 'cr'
}

export type DiffText = { ok: true; text: string; eol: LineEnding } | { ok: false; error: 'too-large' | 'not-text' | 'not-utf8' }

/**
 * The text of a side: UTF-8 with no byte order mark, and `\n` for every line ending (the ending is told apart in `eol`, and is not what the comparison is about: a file saved
 * with another ending would else be a difference on every line).
 */
export function decodeSide(bytes: Uint8Array): DiffText {
  if (bytes.length > TEXT_LIMIT) return { ok: false, error: 'too-large' }
  if (bytes.subarray(0, 8192).includes(0)) return { ok: false, error: 'not-text' }
  let text: string
  try {
    // (The decoder drops a byte order mark.)
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, error: 'not-utf8' }
  }
  return { ok: true, text: text.replace(/\r\n?/g, '\n'), eol: lineEndingOf(text) }
}
