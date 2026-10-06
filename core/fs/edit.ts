import crypto from 'node:crypto'
import type { Stats } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { TEXT_LIMIT } from '../filekind.ts'
import { INNER } from '../vpath.ts'
import { resolveInside } from './guard.ts'

/** What a file was like when it was read: if the disk says otherwise when it is saved, someone else changed it. */
export interface FileVersion {
  mtimeMs: number
  size: number
  /** An entry of a ZIP also has the CRC-32 its directory declares (the ZIP's own date has a resolution of two seconds). */
  crc32?: number
}

/** How the lines of a file end; an editor works with `\n` and the file's own ending is put back when it is saved. */
export type LineEnding = 'lf' | 'crlf' | 'cr'

export type EditError = 'too-large' | 'not-text' | 'not-utf8' | 'no-file' | 'unsupported' | 'denied' | 'read-only'
export type EditOpen = { ok: true; text: string; version: FileVersion; eol: LineEnding; bom: boolean } | { ok: false; error: EditError }
/** The biggest file that is edited as bytes (the hexadecimal view reads such a file whole). */
export const HEX_EDIT_LIMIT = 16 * 2 ** 20
export type EditBytesOpen = { ok: true; bytes: Uint8Array; version: FileVersion } | { ok: false; error: 'too-large' | 'no-file' | 'unsupported' | 'denied' }
export type SaveError = 'changed' | 'no-file' | 'unsupported' | 'denied' | 'too-large' | 'read-only' | 'failed'
export type EditSave = { ok: true; version: FileVersion } | { ok: false; error: SaveError }

/** The biggest file that is opened to be edited (a bigger one is shown, not edited), and the biggest one that is written. */
export const EDIT_LIMIT = TEXT_LIMIT
export const SAVE_LIMIT = 64 * 2 ** 20

const ENDINGS: Record<LineEnding, string> = { lf: '\n', crlf: '\r\n', cr: '\r' }

/** The ending most of the lines of a text have (a file with none is `lf`). */
export function detectLineEnding(text: string): LineEnding {
  let crlf = 0
  let lf = 0
  let cr = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r') {
      if (text[i + 1] === '\n') {
        crlf++
        i++
      } else cr++
    } else if (text[i] === '\n') lf++
  }
  if (crlf > lf && crlf >= cr) return 'crlf'
  if (cr > lf && cr > crlf) return 'cr'
  return 'lf'
}

const failOf = (err: unknown): 'no-file' | 'denied' | 'failed' => {
  const code = (err as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'no-file' : code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? 'denied' : 'failed'
}

/** The file of the disk inside the root that `relative` names, and how it is now: not through a link that leaves the root, not inside a ZIP. */
async function fileAt(root: string, relative: string): Promise<{ real: string; stat: Stats } | { error: 'no-file' | 'unsupported' | 'denied' }> {
  if (relative === '' || relative.includes(INNER)) return { error: 'unsupported' }
  const real = await resolveInside(root, relative)
  if (!real) return { error: 'no-file' }
  try {
    const stat = await fsp.stat(real)
    return stat.isFile() ? { real, stat } : { error: 'no-file' }
  } catch (err) {
    return { error: failOf(err) === 'failed' ? 'no-file' : (failOf(err) as 'no-file' | 'denied') }
  }
}

/**
 * A file of a folder to be edited: its text (with `\\n` for every line ending, and no byte order mark), how its lines end, whether it had the mark, and what it was like on
 * the disk (to notice, when it is saved, that it changed). Only a UTF-8 text up to 5 MB is edited: a binary file (a NUL byte), another encoding and a bigger file are refused,
 * and are shown as they were.
 */
export async function readForEdit(root: string, relative: string): Promise<EditOpen> {
  const file = await fileAt(root, relative)
  if ('error' in file) return { ok: false, error: file.error }
  if (file.stat.size > EDIT_LIMIT) return { ok: false, error: 'too-large' }
  let bytes: Buffer
  try {
    bytes = await fsp.readFile(file.real)
  } catch (err) {
    return { ok: false, error: failOf(err) === 'failed' ? 'no-file' : (failOf(err) as 'no-file' | 'denied') }
  }
  const decoded = decodeForEdit(bytes)
  return 'error' in decoded ? { ok: false, error: decoded.error } : { ok: true, ...decoded, version: { mtimeMs: file.stat.mtimeMs, size: file.stat.size } }
}

/** The bytes of a text file as an editor takes them: `\n` for every line ending, no byte order mark, and how the lines ended and whether there was the mark. Binary and non-UTF-8 files are refused. */
export function decodeForEdit(bytes: Uint8Array): { text: string; eol: LineEnding; bom: boolean } | { error: 'not-text' | 'not-utf8' } {
  if (bytes.includes(0)) return { error: 'not-text' }
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let raw: string
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes)
  } catch {
    return { error: 'not-utf8' }
  }
  const eol = detectLineEnding(raw)
  return { text: eol === 'lf' ? raw.replace(/\r\n?/g, '\n') : raw.replace(/\r\n|\r/g, '\n'), eol, bom }
}

/** The text of an editor as the bytes of its file: the line endings and the byte order mark put back. */
export function encodeEdited(text: string, options: { eol: LineEnding; bom: boolean }): Buffer {
  const body = Buffer.from(options.eol === 'lf' ? text : text.replace(/\n/g, ENDINGS[options.eol]), 'utf8')
  return options.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body
}

/**
 * Writes the edited text of a file of a folder: to a temporary file in the same folder, then renamed over it, so the file is never half written and a crash leaves the old one
 * (the permissions are kept). Before that the disk is looked at: if the file is not what it was when it was read (`base`), it was changed meanwhile, and nothing is written
 * unless `overwrite` says the user chose to. The line endings and the byte order mark of the file are put back. A link is written through (the file it points to, inside the root).
 */
export async function saveEdited(root: string, relative: string, text: string, base: FileVersion, options: { eol: LineEnding; bom: boolean; overwrite?: boolean }): Promise<EditSave> {
  return saveEditedBytes(root, relative, encodeEdited(text, options), base, options.overwrite === true)
}

/** A file of a folder to be edited as bytes (the hexadecimal view): all of them (up to 16 MiB), and what the file was like on the disk. */
export async function readBytesForEdit(root: string, relative: string): Promise<EditBytesOpen> {
  const file = await fileAt(root, relative)
  if ('error' in file) return { ok: false, error: file.error }
  if (file.stat.size > HEX_EDIT_LIMIT) return { ok: false, error: 'too-large' }
  try {
    const bytes = await fsp.readFile(file.real)
    return { ok: true, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), version: { mtimeMs: file.stat.mtimeMs, size: file.stat.size } }
  } catch (err) {
    return { ok: false, error: failOf(err) === 'failed' ? 'no-file' : (failOf(err) as 'no-file' | 'denied') }
  }
}

/** The bytes of a file written whole, the way `saveEdited` writes a text: a temporary file renamed over it, the permissions kept, and the disk looked at first. */
export async function saveEditedBytes(root: string, relative: string, bytes: Uint8Array, base: FileVersion, overwrite = false): Promise<EditSave> {
  const file = await fileAt(root, relative)
  if ('error' in file) return { ok: false, error: file.error }
  if (!overwrite && (file.stat.mtimeMs !== base.mtimeMs || file.stat.size !== base.size)) return { ok: false, error: 'changed' }
  if (bytes.length > SAVE_LIMIT) return { ok: false, error: 'too-large' }
  const temporary = path.join(path.dirname(file.real), `.${path.basename(file.real)}.${crypto.randomBytes(6).toString('hex')}.fbtmp`)
  try {
    const handle = await fsp.open(temporary, 'wx', Number(file.stat.mode) & 0o777)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    // (The mode asked for above is cut by the umask: the file's own is put back.)
    await fsp.chmod(temporary, Number(file.stat.mode) & 0o7777).catch(() => undefined)
    await fsp.rename(temporary, file.real)
    const stat = await fsp.stat(file.real)
    return { ok: true, version: { mtimeMs: stat.mtimeMs, size: stat.size } }
  } catch (err) {
    await fsp.rm(temporary, { force: true }).catch(() => undefined)
    const code = failOf(err)
    return { ok: false, error: code }
  }
}
