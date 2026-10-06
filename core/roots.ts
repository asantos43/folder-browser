import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import type { Readable } from 'node:stream'
import path from 'node:path'
import type { ByteRange } from './archive/reader.ts'
import { ZIP_LIMIT } from './filekind.ts'
import { isHidden } from './fs/hidden.ts'
import { resolveInside } from './fs/guard.ts'
import { createEntry, moveEntry, removeEntry, renameEntry, type OpResult } from './fs/ops.ts'
import { sortEntries } from './fs/sort.ts'
import { INNER, MAX_DEPTH, partsOf } from './vpath.ts'
import { openZipBuffer, ZipError, type ZipArchive, type ZipEntryInfo } from './zip.ts'

/** A folder or a ZIP file that the user opened to browse: the tree starts at it. */
export interface RootInfo {
  /** Unguessable, like a snapshot's: the interface names a root by it and never sends an absolute path. */
  id: string
  kind: 'folder' | 'zip'
  /** The folder, or the ZIP file, on this computer. */
  path: string
  name: string
  /** The trash of the system, opened from the side bar: its items can be put back and it can be emptied. */
  trash?: boolean
}

/** A `.wsnp` file of the disk is its own kind: it opens as a snapshot (and, as a ZIP, as a list). */
export type EntryKind = 'dir' | 'file' | 'zip' | 'wsnp'

/** One row of a listing: a file or folder of the disk, or an entry of a ZIP. */
export interface DirEntry {
  name: string
  /** Relative to the root, with `/` between the parts and `!/` into a ZIP (`docs/a.zip!/x/y.txt`); what the interface sends back. */
  path: string
  kind: EntryKind
  size: number
  /** ISO 8601. */
  modified: string
  hidden: boolean
  /** A symbolic link (on disk). */
  link?: boolean
}

export type ListResult = { entries: DirEntry[]; truncated: boolean } | { error: 'no-root' | 'no-dir' | 'denied' | 'too-large' | 'not-zip' }
export type OpenRootResult = { root: RootInfo; already: boolean } | { error: 'not-found' | 'not-supported' | 'too-large' | 'not-zip' | 'denied' }
/** The same words as the snapshots' registry, so the callers do not tell the two apart. */
type Fail = { error: 'no-snapshot' | 'no-file' | 'too-large' }

/** The most rows one listing returns: a folder with more is cut, and says so. */
export const LIST_LIMIT = 20_000
const ZIP_NAME = /\.zip$/i
const WSNP_NAME = /\.wsnp$/i

interface OpenRoot extends RootInfo {
  /** The real path (symbolic links resolved), the one every file is checked to be inside. */
  real: string
}

/** Where a path is: a file of the disk, or an entry of a ZIP (`zip` is the ZIP's own path, `''` for the root ZIP). */
type Located = { file: string } | { zip: string; entry: string }

/**
 * The roots that are open. Everything the interface asks of the disk goes through here, by (root id, relative path): a path that leaves the root, by `..` or by a
 * symbolic link, is refused (`resolveInside`), and a ZIP, also inside a ZIP, is read in memory (at most `ZIP_LIMIT`) and never unzipped to disk.
 */
export class RootRegistry {
  private readonly open = new Map<string, OpenRoot>()
  /** The ZIPs opened (the last few: listing and reading ask again and again). */
  private readonly zips = new Map<string, Promise<ZipArchive>>()

  get ids(): string[] {
    return [...this.open.keys()]
  }
  has(id: string): boolean {
    return this.open.has(id)
  }
  info(id: string): RootInfo | undefined {
    const root = this.open.get(id)
    return root && { id: root.id, kind: root.kind, path: root.path, name: root.name, ...(root.trash ? { trash: true } : {}) }
  }

  /** Opens a folder, or a ZIP file, as a root. One that is open already is not opened twice. */
  async openPath(target: string, options: { trash?: boolean } = {}): Promise<OpenRootResult> {
    let real: string
    let stat: fs.Stats
    try {
      real = await fsp.realpath(target)
      stat = await fsp.stat(real)
    } catch (err) {
      return { error: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'denied' }
    }
    const kind = stat.isDirectory() ? 'folder' : stat.isFile() && ZIP_NAME.test(real) ? 'zip' : null
    if (!kind) return { error: 'not-supported' }
    for (const root of this.open.values()) {
      if (root.real !== real) continue
      if (options.trash) root.trash = true
      return { root: this.info(root.id)!, already: true }
    }
    if (kind === 'folder') {
      try {
        await fsp.access(real, fs.constants.R_OK | fs.constants.X_OK)
      } catch {
        return { error: 'denied' }
      }
    }
    const root: OpenRoot = { id: `r${crypto.randomBytes(8).toString('hex')}`, kind, path: target, real, name: path.basename(target) || target, ...(options.trash ? { trash: true } : {}) }
    this.open.set(root.id, root)
    if (kind === 'zip') {
      // A ZIP that cannot be read is refused here, not when the tree first opens.
      const zip = await this.zipArchive(root, '').catch((err: unknown) => err)
      if (zip instanceof Error) {
        this.open.delete(root.id)
        for (const key of [...this.zips.keys()]) if (key.startsWith(`${root.id}\0`)) this.zips.delete(key)
        return { error: zip instanceof ZipError ? (zip.code === 'too-large' ? 'too-large' : 'not-zip') : 'denied' }
      }
    }
    return { root: this.info(root.id)!, already: false }
  }

  async close(id: string): Promise<void> {
    this.open.delete(id)
    for (const key of [...this.zips.keys()]) if (key.startsWith(`${id}\0`)) this.zips.delete(key)
  }

  // ---- where a path is

  private locate(root: OpenRoot, name: string): Located | null {
    const parts = partsOf(name)
    if (!parts.length || parts.length > MAX_DEPTH + 1) return null
    if (parts.length === 1) return root.kind === 'folder' ? { file: parts[0] } : { zip: '', entry: parts[0] }
    return { zip: parts.slice(0, -1).join(INNER), entry: parts.at(-1)! }
  }

  /** The ZIP at `zipPath` (`''` is the root of a ZIP root), opened in memory and kept for the next call. */
  private zipArchive(root: OpenRoot, zipPath: string): Promise<ZipArchive> {
    const key = `${root.id}\0${zipPath}`
    let zip = this.zips.get(key)
    if (!zip) {
      const loading = this.zipBytes(root, zipPath).then((bytes) => openZipBuffer(bytes))
      this.zips.set(key, loading)
      // Only the last two stay (each holds its bytes in memory); one that failed is not kept.
      for (const old of [...this.zips.keys()].slice(0, -2)) this.zips.delete(old)
      loading.catch(() => this.zips.get(key) === loading && this.zips.delete(key))
      zip = loading
    }
    return zip
  }

  private async zipBytes(root: OpenRoot, zipPath: string): Promise<Buffer> {
    if (zipPath === '') return this.readDisk(root.real, ZIP_LIMIT)
    const got = await this.bytes(root, zipPath, ZIP_LIMIT)
    if ('error' in got) throw new ZipError(got.error === 'too-large' ? 'too-large' : 'missing', got.error)
    return got.bytes
  }

  private async readDisk(file: string, limit: number): Promise<Buffer> {
    const stat = await fsp.stat(file)
    if (!stat.isFile()) throw new ZipError('missing', 'no-file')
    if (stat.size > limit) throw new ZipError('too-large', 'too-large')
    return fsp.readFile(file)
  }

  private async bytes(root: OpenRoot, name: string, limit: number): Promise<{ bytes: Buffer } | Fail> {
    const at = this.locate(root, name)
    if (!at) return { error: 'no-file' }
    try {
      if ('file' in at) {
        const file = await resolveInside(root.real, at.file)
        return file ? { bytes: await this.readDisk(file, limit) } : { error: 'no-file' }
      }
      const zip = await this.zipArchive(root, at.zip)
      const entry = zip.info(at.entry)
      if (!entry || entry.directory || entry.unreadable) return { error: 'no-file' }
      return { bytes: await zip.read(entry.name, limit) }
    } catch (err) {
      return { error: err instanceof ZipError && err.code === 'too-large' ? 'too-large' : 'no-file' }
    }
  }

  // ---- what the interface asks (the same shapes as SnapshotRegistry's)

  /** A whole file, for a tab. Refuses what is not there and what is over `limit`. */
  async read(id: string, name: string, limit: number): Promise<{ bytes: Buffer } | Fail> {
    const root = this.open.get(id)
    return root ? this.bytes(root, name, limit) : { error: 'no-snapshot' }
  }

  /** `length` bytes of a file of the disk from `offset` (and the file's size), for a view that reads a big file a page at a time. Not for an entry of a ZIP: those are read whole. */
  async range(id: string, name: string, offset: number, length: number): Promise<{ bytes: Buffer; size: number } | Fail> {
    const root = this.open.get(id)
    if (!root) return { error: 'no-snapshot' }
    const file = await this.diskFile(id, name)
    if (!file) return { error: root.kind === 'zip' || name.includes(INNER) ? 'too-large' : 'no-file' }
    let handle: fsp.FileHandle | undefined
    try {
      handle = await fsp.open(file, 'r')
      const { size } = await handle.stat()
      const want = Math.max(0, Math.min(length, size - offset))
      const bytes = Buffer.alloc(want)
      const { bytesRead } = want ? await handle.read(bytes, 0, want, offset) : { bytesRead: 0 }
      return { bytes: bytes.subarray(0, bytesRead), size }
    } catch {
      return { error: 'no-file' }
    } finally {
      await handle?.close()
    }
  }

  /** A file as a stream (to save it, or to hand a copy to another application), whatever its size. */
  async stream(id: string, name: string, range?: ByteRange): Promise<Readable | undefined> {
    const root = this.open.get(id)
    const at = root && this.locate(root, name)
    if (!root || !at) return undefined
    try {
      if ('file' in at) {
        const file = await resolveInside(root.real, at.file)
        const stat = file ? await fsp.stat(file) : undefined
        return file && stat?.isFile() ? fs.createReadStream(file, range ? { start: range.start, end: range.end } : {}) : undefined
      }
      const zip = await this.zipArchive(root, at.zip)
      return await zip.stream(at.entry)
    } catch {
      return undefined
    }
  }

  /** The ZIP at `name` (a file of the root, or an entry of a ZIP in it), opened in memory. */
  async zipAt(id: string, name: string): Promise<ZipArchive | { error: 'no-snapshot' | 'no-file' | 'too-large' | 'not-zip' }> {
    const root = this.open.get(id)
    if (!root) return { error: 'no-snapshot' }
    try {
      return await this.zipArchive(root, name)
    } catch (err) {
      if (err instanceof ZipError) return { error: err.code === 'too-large' ? 'too-large' : err.code === 'missing' ? 'no-file' : 'not-zip' }
      return { error: 'no-file' }
    }
  }

  /** The file of the disk that `name` is, for what is opened from the disk by its path (a `.wsnp`): not an entry of a ZIP, and not in a ZIP root. */
  async diskFile(id: string, name: string): Promise<string | null> {
    const root = this.open.get(id)
    if (!root || root.kind !== 'folder' || name.includes(INNER)) return null
    const file = await resolveInside(root.real, name)
    const stat = file ? await fsp.stat(file).catch(() => undefined) : undefined
    return file && stat?.isFile() ? file : null
  }

  /** The folder of the disk that `name` is (`''` is the root), for pinning it: only in a folder root, and not a folder of a ZIP. */
  async diskDir(id: string, name: string): Promise<string | null> {
    const root = this.open.get(id)
    if (!root || root.kind !== 'folder' || name.includes(INNER)) return null
    const dir = await resolveInside(root.real, name)
    const stat = dir ? await fsp.stat(dir).catch(() => undefined) : undefined
    return dir && stat?.isDirectory() ? dir : null
  }

  /** The file on the disk that holds `name`: the file itself, or the outermost ZIP it is in. For "show in the folder". */
  async diskPath(id: string, name: string): Promise<string | null> {
    const root = this.open.get(id)
    if (!root) return null
    if (root.kind === 'zip') return root.real
    return resolveInside(root.real, partsOf(name)[0])
  }

  // ---- changing the disk (phase 2): only a folder root, never the trash (its items are put back or emptied), never inside a ZIP

  private writable(id: string): OpenRoot | null {
    const root = this.open.get(id)
    return root && root.kind === 'folder' && !root.trash ? root : null
  }

  /** What was in memory of the ZIP files of a root is not what the disk has now. */
  private forgetZips(id: string): void {
    for (const key of [...this.zips.keys()]) if (key.startsWith(`${id}\0`)) this.zips.delete(key)
  }

  private async changed(id: string, done: Promise<OpResult>): Promise<OpResult> {
    const result = await done
    if (result.ok) this.forgetZips(id)
    return result
  }

  /** A new empty file or folder in `parent` of the root. */
  create(id: string, parent: string, name: string, kind: 'file' | 'dir'): Promise<OpResult> {
    const root = this.writable(id)
    return root ? this.changed(id, createEntry(root.real, parent, name, kind)) : Promise.resolve({ ok: false, error: 'unsupported' })
  }

  rename(id: string, name: string, newName: string): Promise<OpResult> {
    const root = this.writable(id)
    return root ? this.changed(id, renameEntry(root.real, name, newName)) : Promise.resolve({ ok: false, error: 'unsupported' })
  }

  move(id: string, name: string, toFolder: string): Promise<OpResult> {
    const root = this.writable(id)
    return root ? this.changed(id, moveEntry(root.real, name, toFolder)) : Promise.resolve({ ok: false, error: 'unsupported' })
  }

  /** To the trash (`trash` is the system's), or for good. */
  remove(id: string, name: string, how: 'trash' | 'forever', trash: (file: string) => Promise<void>): Promise<OpResult> {
    const root = this.writable(id)
    return root ? this.changed(id, removeEntry(root.real, name, how, trash)) : Promise.resolve({ ok: false, error: 'unsupported' })
  }

  // ---- listing

  /** What is directly in `dir`: a folder of the disk, a ZIP file, or a folder of a ZIP. `''` is the root. */
  async list(id: string, dir: string): Promise<ListResult> {
    const root = this.open.get(id)
    if (!root) return { error: 'no-root' }
    try {
      const parts = partsOf(dir)
      if (parts.length > MAX_DEPTH + 1) return { error: 'no-dir' }
      if (root.kind === 'folder' && parts.length === 1) {
        const real = await resolveInside(root.real, parts[0])
        if (!real) return { error: 'denied' }
        const stat = await fsp.stat(real)
        if (stat.isDirectory()) return await this.listDisk(real, parts[0])
        if (stat.isFile() && ZIP_NAME.test(real)) return await this.listZip(root, parts[0], '')
        return { error: 'no-dir' }
      }
      if (root.kind === 'zip' && dir === '') return await this.listZip(root, '', '')
      const at = this.locate(root, dir)
      if (!at || 'file' in at) return { error: 'no-dir' }
      // A folder of a ZIP, or a ZIP inside it (an entry that is a file with a ZIP's name).
      const zip = await this.zipArchive(root, at.zip)
      const inner = at.entry.replace(/\/+$/, '')
      const entry = inner ? zip.info(inner) : undefined
      if (entry && !entry.directory && ZIP_NAME.test(inner)) return await this.listZip(root, dir, '')
      return await this.listZip(root, at.zip, inner ? `${inner}/` : '')
    } catch (err) {
      if (err instanceof ZipError) return { error: err.code === 'too-large' ? 'too-large' : err.code === 'missing' ? 'no-dir' : 'not-zip' }
      const code = (err as NodeJS.ErrnoException).code
      return { error: code === 'EACCES' || code === 'EPERM' ? 'denied' : 'no-dir' }
    }
  }

  private async listDisk(real: string, dir: string): Promise<ListResult> {
    const dirents = await fsp.readdir(real, { withFileTypes: true })
    const truncated = dirents.length > LIST_LIMIT
    const entries: DirEntry[] = []
    const one = async (d: fs.Dirent): Promise<void> => {
      const file = path.join(real, d.name)
      let link = false
      let kind: EntryKind
      let size = 0
      let modified = new Date(0).toISOString()
      try {
        let stat = await fsp.lstat(file)
        if (stat.isSymbolicLink()) {
          link = true
          stat = await fsp.stat(file)
          // A link to somewhere outside the root is listed, but cannot be followed: `resolveInside` refuses it.
        }
        kind = stat.isDirectory() ? 'dir' : WSNP_NAME.test(d.name) ? 'wsnp' : ZIP_NAME.test(d.name) ? 'zip' : 'file'
        size = stat.isDirectory() ? 0 : stat.size
        modified = stat.mtime.toISOString()
      } catch {
        // A broken link, or a file that went while listing: shown as a file, with no size.
        kind = 'file'
      }
      entries.push({ name: d.name, path: dir ? `${dir}/${d.name}` : d.name, kind, size, modified, hidden: isHidden(d.name), ...(link ? { link: true } : {}) })
    }
    const names = dirents.slice(0, LIST_LIMIT)
    for (let i = 0; i < names.length; i += 64) await Promise.all(names.slice(i, i + 64).map(one))
    return { entries: sortEntries(entries), truncated }
  }

  /** The rows of a ZIP at `zipPath` under `prefix` (`''` or `dir/`): the entries are folded into folders by their names. */
  private async listZip(root: OpenRoot, zipPath: string, prefix: string): Promise<ListResult> {
    const zip = await this.zipArchive(root, zipPath)
    const base = zipPath === '' ? '' : `${zipPath}${INNER}`
    const rows = new Map<string, DirEntry>()
    for (const e of zip.entries) {
      if (!e.name.startsWith(prefix) || e.name === prefix) continue
      const rest = e.name.slice(prefix.length)
      const name = rest.split('/')[0]
      if (!name) continue
      const dir = rest.includes('/')
      if (dir) {
        if (!rows.has(name)) rows.set(name, row(base, prefix, name, 'dir', 0, e))
      } else if (!e.directory) rows.set(name, row(base, prefix, name, ZIP_NAME.test(name) ? 'zip' : 'file', e.size, e))
      else if (!rows.has(name)) rows.set(name, row(base, prefix, name, 'dir', 0, e))
    }
    const entries = [...rows.values()]
    const truncated = zip.truncated || entries.length > LIST_LIMIT
    return { entries: sortEntries(entries.slice(0, LIST_LIMIT)), truncated }
  }
}

function row(base: string, prefix: string, name: string, kind: EntryKind, size: number, e: ZipEntryInfo): DirEntry {
  return { name, path: `${base}${prefix}${name}`, kind, size, modified: e.modified, hidden: isHidden(name) }
}
