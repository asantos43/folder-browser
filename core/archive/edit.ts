import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { nameProblem } from '../fs/names.ts'
import { ZIP_LIMIT } from '../filekind.ts'
import { decodeName } from '../zip.ts'
import { ArchiveError, assertNotZip64 } from './reader.ts'

/**
 * Changing a ZIP: add, replace, remove, move (rename) and copy files, and make folders, in one pass. The ZIP is read by its central directory, the entries the operations leave
 * alone are copied to a temporary file next to it as streams (nothing is held in memory but the entry being copied), and the temporary file is renamed over the ZIP, so the
 * ZIP is never half written and a crash leaves the old one. A ZIP inside a ZIP (`chain`) is taken out to a temporary file, changed the same way, and put back in its own ZIP.
 * Nothing is ever replaced by a name that is taken, and a ZIP that cannot be written back faithfully (ZIP64, encryption, a method other than stored and DEFLATE, names that could
 * leave a folder, two entries with one name) is refused before anything is touched: it stays read-only.
 */

/** Why the ZIP was not changed. Nothing is half done: the ZIP is what it was. */
export type ZipEditError = 'read-only' | 'not-found' | 'exists' | 'not-folder' | 'invalid-name' | 'into-itself' | 'same-place' | 'changed' | 'too-large' | 'denied' | 'failed'
export type ZipEditResult = { ok: true; /** For every operation, the name it ended with (the new name of a move, of a copy, the file that was made). */ names: string[] } | { ok: false; error: ZipEditError }

/** The bytes of an entry that is written: in memory, or in a file (an inner ZIP that was changed). */
export type ZipData = Buffer | { file: string; size: number }

/** What an entry was like when it was read: the size and the CRC-32 its directory declares. A replace that finds another entry there was beaten by someone else's change. */
export interface EntryBase {
  size: number
  crc32: number
}

/** Names are the full path inside the ZIP with `/` between the parts, no `/` at the start or the end. */
export type ZipOp =
  | { op: 'create'; name: string; data?: Buffer }
  | { op: 'replace'; name: string; data: ZipData; /** Refused with `changed` when the entry is not this one any more. */ base?: EntryBase }
  | { op: 'mkdir'; name: string }
  | { op: 'remove'; name: string }
  | { op: 'move'; from: string; to: string }
  /** A copy of a file or folder into `toFolder` (`''` is the top), under its own name or, if that is taken, a numbered one. */
  | { op: 'copy'; from: string; toFolder: string }

const S_IFMT = 0o170000
const S_IFLNK = 0o120000
/** The most entries a ZIP may have to be changed: a bigger one is read-only. */
const ENTRY_LIMIT = 100_000
/** The ZIP is written without ZIP64 in mind: more than this in all is refused. */
const SIZE_LIMIT = 0xfffffffe

class Refused extends Error {
  readonly error: ZipEditError
  constructor(error: ZipEditError) {
    super(error)
    this.error = error
  }
}

interface Item {
  /** The full name, without a `/` at the end (a folder too). */
  name: string
  dir: boolean
  size: number
  crc32: number
  method: 0 | 8
  mtime: Date
  mode: number | undefined
  /** Where its bytes are in the ZIP being read. */
  raw?: yauzl.Entry
  /** Or the bytes that were given. */
  data?: ZipData
}

interface Opened {
  zip: yauzl.ZipFile
  items: Item[]
}

/** The entries of a ZIP of the disk, read as the viewer reads them (the same names), or why it cannot be written back. */
async function openForEdit(file: string): Promise<Opened> {
  try {
    assertNotZip64(file)
  } catch (err) {
    if (err instanceof ArchiveError) throw new Refused('read-only')
    throw err
  }
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    // Names are read as bytes and decoded like the listing does, so that an entry has the same name here and in the tree.
    yauzl.open(file, { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true }, (err, opened) => (err || !opened ? reject(new Refused('read-only')) : resolve(opened)))
  })
  try {
    const items = await new Promise<Item[]>((resolve, reject) => {
      const found: Item[] = []
      const seen = new Set<string>()
      zip.on('error', () => reject(new Refused('read-only')))
      zip.on('end', () => resolve(found))
      zip.on('entry', (raw: yauzl.Entry) => {
        const named = decodeName(raw.fileName as unknown as Buffer, raw.generalPurposeBitFlag)
        const dir = named.endsWith('/')
        const name = dir ? named.slice(0, -1) : named
        const unsafe = name === '' || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').some((p) => p === '' || p === '.' || p === '..')
        if (raw.isEncrypted() || unsafe || seen.has(name) || found.length >= ENTRY_LIMIT || (!dir && raw.compressionMethod !== 0 && raw.compressionMethod !== 8)) return reject(new Refused('read-only'))
        seen.add(name)
        const mode = (raw.externalFileAttributes >>> 16) & 0xffff
        found.push({ name, dir, size: raw.uncompressedSize, crc32: raw.crc32, method: raw.compressionMethod === 0 ? 0 : 8, mtime: raw.getLastModDate(), mode: mode || undefined, raw })
        zip.readEntry()
      })
      zip.readEntry()
    })
    return { zip, items }
  } catch (err) {
    zip.close()
    throw err
  }
}

/** The ZIP's entries as a tree of names that the operations change in memory; the bytes are only moved when it is written. */
class Plan {
  private items = new Map<string, Item>()

  constructor(items: Item[]) {
    for (const item of items) this.items.set(item.name, item)
  }

  list(): Item[] {
    return [...this.items.values()]
  }

  /** What is at `name`: a file, a folder (an entry of its own, or any name under it), or nothing. */
  kindAt(name: string): 'file' | 'dir' | undefined {
    const item = this.items.get(name)
    if (item) return item.dir ? 'dir' : 'file'
    const under = `${name}/`
    for (const key of this.items.keys()) if (key.startsWith(under)) return 'dir'
    return undefined
  }

  /** A new name: every part is a name a file can have, and nothing above it is a file. */
  private checkNew(name: string): void {
    const parts = name.split('/')
    if (parts.some((p) => nameProblem(p, 'linux'))) throw new Refused('invalid-name')
    for (let i = 1; i < parts.length; i++) if (this.kindAt(parts.slice(0, i).join('/')) === 'file') throw new Refused('not-folder')
  }

  /** A folder that held only what was taken out stays (as an entry of its own), as a folder of the disk would. */
  private keepParent(name: string): void {
    const parent = name.split('/').slice(0, -1).join('/')
    if (parent && this.kindAt(parent) === undefined) this.items.set(parent, { name: parent, dir: true, size: 0, crc32: 0, method: 0, mtime: new Date(), mode: undefined })
  }

  private under(name: string): Item[] {
    const under = `${name}/`
    return this.list().filter((i) => i.name === name || i.name.startsWith(under))
  }

  apply(op: ZipOp): string {
    switch (op.op) {
      case 'create': {
        this.checkNew(op.name)
        if (this.kindAt(op.name)) throw new Refused('exists')
        const data = op.data ?? Buffer.alloc(0)
        this.items.set(op.name, { name: op.name, dir: false, size: data.length, crc32: 0, method: 8, mtime: new Date(), mode: undefined, data })
        return op.name
      }
      case 'mkdir': {
        this.checkNew(op.name)
        if (this.kindAt(op.name)) throw new Refused('exists')
        this.items.set(op.name, { name: op.name, dir: true, size: 0, crc32: 0, method: 0, mtime: new Date(), mode: undefined })
        return op.name
      }
      case 'replace': {
        const item = this.items.get(op.name)
        if (!item || item.dir) throw new Refused('not-found')
        if (op.base && (item.size !== op.base.size || item.crc32 !== op.base.crc32)) throw new Refused('changed')
        if (item.mode !== undefined && (item.mode & S_IFMT) === S_IFLNK) throw new Refused('read-only')
        const { raw: _raw, ...rest } = item
        this.items.set(op.name, { ...rest, size: Buffer.isBuffer(op.data) ? op.data.length : op.data.size, crc32: 0, method: 8, mtime: new Date(), data: op.data })
        return op.name
      }
      case 'remove': {
        const gone = this.under(op.name)
        if (!gone.length && this.kindAt(op.name) === undefined) throw new Refused('not-found')
        for (const item of gone) this.items.delete(item.name)
        this.keepParent(op.name)
        return op.name
      }
      case 'move': {
        if (this.kindAt(op.from) === undefined) throw new Refused('not-found')
        if (op.from === op.to) throw new Refused('same-place')
        this.checkNew(op.to)
        if (op.to.startsWith(`${op.from}/`)) throw new Refused('into-itself')
        if (this.kindAt(op.to)) throw new Refused('exists')
        // The entries keep their places in the ZIP: the map is made again with the new names.
        const moved = new Set(this.under(op.from).map((i) => i.name))
        const next = new Map<string, Item>()
        for (const [key, item] of this.items) {
          if (!moved.has(key)) next.set(key, item)
          else {
            const name = op.to + key.slice(op.from.length)
            next.set(name, { ...item, name })
          }
        }
        this.items = next
        this.keepParent(op.from)
        return op.to
      }
      case 'copy': {
        const sources = this.under(op.from)
        if (this.kindAt(op.from) === undefined) throw new Refused('not-found')
        const base = op.from.split('/').at(-1)!
        const folder = this.kindAt(op.from) === 'dir'
        if (op.toFolder && this.kindAt(op.toFolder) === 'file') throw new Refused('not-folder')
        if (folder && (op.toFolder === op.from || op.toFolder.startsWith(`${op.from}/`))) throw new Refused('into-itself')
        const target = this.freeName(op.toFolder, base, folder)
        this.checkNew(target)
        for (const item of sources) {
          const name = target + item.name.slice(op.from.length)
          this.items.set(name, { ...item, name })
        }
        if (!sources.some((i) => i.name === op.from) && folder) this.items.set(target, { name: target, dir: true, size: 0, crc32: 0, method: 0, mtime: new Date(), mode: undefined })
        return target
      }
    }
  }

  /** `name`, or `name (2)`, `name (3)`… (the number before the extension of a file) for the first one that is free in `folder`. */
  private freeName(folder: string, name: string, dir: boolean): string {
    const join = (n: string) => (folder ? `${folder}/${n}` : n)
    if (!this.kindAt(join(name))) return join(name)
    const tar = /\.tar\.[a-z0-9]+$/i.exec(name)
    const dot = tar ? tar.index : name.lastIndexOf('.')
    const split = !dir && dot > 0 ? dot : name.length
    for (let n = 2; n < 10_000; n++) {
      const candidate = join(`${name.slice(0, split)} (${n})${name.slice(split)}`)
      if (!this.kindAt(candidate)) return candidate
    }
    return join(`${name} (${Date.now()})`)
  }
}

/** The ZIP of `plan` written to `out`: the entries in their order, copied by stream from `source` when they were not changed. */
async function writePlan(source: yauzl.ZipFile, items: Item[], out: string): Promise<void> {
  const total = items.reduce((sum, i) => sum + (i.dir ? 0 : i.size), 0)
  if (total > SIZE_LIMIT) throw new Refused('too-large')
  const zip = new yazl.ZipFile()
  const failure = new Promise<never>((_, reject) =>
    zip.on('error', (err) => {
      (zip.outputStream as unknown as Readable).destroy(err)
      reject(err)
    }),
  )
  failure.catch(() => undefined)
  for (const item of items) {
    const options = { mtime: item.mtime, ...(item.mode !== undefined ? { mode: item.mode } : {}) }
    if (item.dir) zip.addEmptyDirectory(`${item.name}/`, options)
    else if (item.data && Buffer.isBuffer(item.data)) zip.addBuffer(item.data, item.name, { ...options, compress: true })
    else if (item.data) {
      const { file, size } = item.data
      zip.addReadStreamLazy(item.name, { ...options, compress: true, size }, (done) => done(null, fs.createReadStream(file)))
    } else {
      const raw = item.raw!
      zip.addReadStreamLazy(item.name, { ...options, compress: item.method === 8, size: item.size }, (done) => source.openReadStream(raw, (err, stream) => done(err, stream as NodeJS.ReadableStream)))
    }
  }
  zip.end()
  await Promise.race([pipeline(zip.outputStream, fs.createWriteStream(out, { flags: 'wx' })), failure])
  const handle = await fsp.open(out, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const tempNear = (file: string): string => path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.fbtmp`)

const failOf = (err: unknown): ZipEditError => {
  if (err instanceof Refused) return err.error
  const code = (err as NodeJS.ErrnoException).code
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? 'denied' : code === 'ENOENT' || code === 'ENOTDIR' ? 'not-found' : 'failed'
}

/** Applies the operations to the ZIP file `file`, and writes it back atomically: the names are those of the operations, in order. */
async function rewrite(file: string, ops: ZipOp[], before?: fs.Stats): Promise<string[]> {
  const stat = before ?? (await fsp.stat(file))
  const { zip, items } = await openForEdit(file)
  const temporary = tempNear(file)
  try {
    const plan = new Plan(items)
    const names = ops.map((op) => plan.apply(op))
    await writePlan(zip, plan.list(), temporary)
    zip.close()
    // Something else changed the ZIP while this was written: that is not undone by a rename.
    const now = await fsp.stat(file)
    if (now.mtimeMs !== stat.mtimeMs || now.size !== stat.size || now.ino !== stat.ino) throw new Refused('changed')
    await fsp.chmod(temporary, Number(stat.mode) & 0o7777).catch(() => undefined)
    await fsp.rename(temporary, file)
    return names
  } catch (err) {
    zip.close()
    await fsp.rm(temporary, { force: true }).catch(() => undefined)
    throw err
  }
}

/** The ZIP `chain` names inside `file` (each an entry of the one before), changed; the inner ones are taken to a temporary file, changed, and put back. */
async function through(file: string, chain: readonly string[], ops: ZipOp[]): Promise<string[]> {
  if (!chain.length) return rewrite(file, ops)
  const [inner, ...rest] = chain
  const before = await fsp.stat(file)
  const { zip, items } = await openForEdit(file)
  const temporary = tempNear(file)
  try {
    const entry = items.find((i) => i.name === inner && !i.dir)
    if (!entry) throw new Refused('not-found')
    if (!/\.zip$/i.test(inner)) throw new Refused('read-only')
    if (entry.size > ZIP_LIMIT) throw new Refused('too-large')
    const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(entry.raw!, (err, s) => (err || !s ? reject(err ?? new Refused('failed')) : resolve(s))))
    await pipeline(stream, fs.createWriteStream(temporary, { flags: 'wx' }))
    zip.close()
    const names = await through(temporary, rest, ops)
    const { size } = await fsp.stat(temporary)
    await rewrite(file, [{ op: 'replace', name: inner, data: { file: temporary, size } }], before)
    return names
  } finally {
    zip.close()
    await fsp.rm(temporary, { force: true }).catch(() => undefined)
  }
}

/** Changes the ZIP at `chain` inside the ZIP file `file` of the disk (`chain` is empty for the file's own entries), with all the operations or none. */
export async function editZip(file: string, chain: readonly string[], ops: ZipOp[]): Promise<ZipEditResult> {
  try {
    return { ok: true, names: await through(file, chain, ops) }
  } catch (err) {
    return { ok: false, error: failOf(err) }
  }
}

/** Whether the ZIP file `file` could be written back as it is (not ZIP64, encrypted, with a method or names that cannot be kept): looked at without changing anything. */
export async function zipIsWritable(file: string): Promise<boolean> {
  try {
    ;(await openForEdit(file)).zip.close()
    return true
  } catch {
    return false
  }
}
