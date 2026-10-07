import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import type { Readable } from 'node:stream'
import path from 'node:path'
import { editZip, zipIsWritable, type ZipEditResult, type ZipOp } from './archive/edit.ts'
import type { ByteRange } from './archive/reader.ts'
import { ZIP_LIMIT } from './filekind.ts'
import { isHidden } from './fs/hidden.ts'
import { resolveInside } from './fs/guard.ts'
import { decodeForEdit, EDIT_LIMIT, encodeEdited, readBytesForEdit, readForEdit, SAVE_LIMIT, saveEdited, saveEditedBytes, type EditBytesOpen, type EditOpen, type EditSave, type FileVersion, type LineEnding } from './fs/edit.ts'
import { nameProblem } from './fs/names.ts'
import { copyEntry, createEntry, moveEntry, removeEntry, renameEntry, type OpError, type OpResult } from './fs/ops.ts'
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

/** Every file of a root, for Go to File: relative paths (`docs/a.txt`, in a ZIP root the entries' names), cut at `FILE_LIMIT`. */
export type FileListResult = { paths: string[]; truncated: boolean } | { error: 'no-root' | 'not-zip' | 'too-large' | 'denied' }

export type ListResult = { entries: DirEntry[]; truncated: boolean } | { error: 'no-root' | 'no-dir' | 'denied' | 'too-large' | 'not-zip' }
export type OpenRootResult = { root: RootInfo; already: boolean } | { error: 'not-found' | 'not-supported' | 'too-large' | 'not-zip' | 'denied' }
/** The same words as the snapshots' registry, so the callers do not tell the two apart. */
type Fail = { error: 'no-snapshot' | 'no-file' | 'too-large' }

/** The most files `listFiles` returns, and the folders that are not looked into (a folder of that kind has more files than a person looks for by name). */
export const FILE_LIMIT = 50_000
const NOT_INDEXED = new Set(['node_modules', '.git', '.hg', '.svn'])
/** The most rows one listing returns: a folder with more is cut, and says so. */
export const LIST_LIMIT = 20_000
const ZIP_NAME = /\.zip$/i
const WSNP_NAME = /\.wsnp$/i

interface OpenRoot extends RootInfo {
  /** The real path (symbolic links resolved), the one every file is checked to be inside. */
  real: string
}

/** Where a path in a ZIP is, for changing it: `file` is the ZIP file of the disk, `chain` the ZIPs inside it to open one from the other, `entry` the path inside the innermost (`''` is its top). */
interface ZipSpot {
  file: string
  chain: string[]
  entry: string
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

  // ---- changing the disk (phase 2) and the ZIPs (phase 5): never the trash (its items are put back or emptied)

  private writable(id: string): OpenRoot | null {
    const root = this.open.get(id)
    return root && root.kind === 'folder' && !root.trash ? root : null
  }

  /** What was in memory of the ZIP files was not what the disk has now. */
  private forgetZips(): void {
    this.zips.clear()
  }

  private async changed(done: Promise<OpResult>): Promise<OpResult> {
    const result = await done
    if (result.ok) this.forgetZips()
    return result
  }

  /** Changes to one ZIP file go one after the other: each reads the file as the one before left it. */
  private readonly queues = new Map<string, Promise<unknown>>()
  private queued<T>(file: string, task: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(file) ?? Promise.resolve()).then(task, task)
    const tail = run.then(() => undefined, () => undefined)
    this.queues.set(file, tail)
    void tail.then(() => this.queues.get(file) === tail && this.queues.delete(file))
    return run
  }

  /**
   * Where a path is, when it is in a ZIP. `item` is a file or folder to be changed (an entry of a ZIP, or an entry of a ZIP in it): `null` when it is of the disk. `container` is a
   * place to put things in: the top of a ZIP (a ZIP file of the disk, the root of a ZIP root, an entry that is a ZIP) or a folder of one; `null` when it is a folder of the disk.
   * `file` is the real ZIP file of the disk, `chain` the entries to open one inside the other from it, and `entry` the path inside the innermost ZIP (`''` for its top).
   */
  private async zipSpot(root: OpenRoot, name: string, as: 'item' | 'container'): Promise<ZipSpot | null | { error: OpError }> {
    const parts = partsOf(name)
    if (parts.length > MAX_DEPTH + 1) return { error: 'not-found' }
    let file: string
    let rest: string[]
    if (root.kind === 'zip') {
      file = root.real
      rest = name === '' ? [] : parts
    } else if (parts.length === 1) {
      if (as === 'item') return null
      const real = name === '' ? null : await resolveInside(root.real, name)
      const stat = real ? await fsp.stat(real).catch(() => null) : null
      if (!real || !stat?.isFile() || !ZIP_NAME.test(real)) return null
      return { file: real, chain: [], entry: '' }
    } else {
      const real = await resolveInside(root.real, parts[0])
      const stat = real ? await fsp.stat(real).catch(() => null) : null
      if (!real || !stat?.isFile() || !ZIP_NAME.test(real)) return { error: 'not-found' }
      file = real
      rest = parts.slice(1)
    }
    if (as === 'item') return rest.length ? { file, chain: rest.slice(0, -1), entry: rest.at(-1)! } : { error: 'unsupported' }
    if (!rest.length) return { file, chain: [], entry: '' }
    // The last part is a ZIP inside (its top), or a folder of the ZIP that holds it.
    const last = rest.at(-1)!
    const holder = (root.kind === 'zip' ? rest.slice(0, -1) : [parts[0], ...rest.slice(0, -1)]).join(INNER)
    const archive = await this.zipArchive(root, holder).catch(() => null)
    if (!archive) return { error: 'not-found' }
    const info = archive.info(last)
    if (info && !info.directory && ZIP_NAME.test(last)) return { file, chain: rest, entry: '' }
    const found = archive.entries.some((e) => e.name === `${last}/` || e.name.startsWith(`${last}/`))
    if (!found) return { error: info ? 'not-folder' : 'not-found' }
    return { file, chain: rest.slice(0, -1), entry: last }
  }

  /** The same ZIP: the file and the chain of ZIPs inside it. */
  private sameZip(a: ZipSpot, b: ZipSpot): boolean {
    return a.file === b.file && a.chain.length === b.chain.length && a.chain.every((part, i) => part === b.chain[i])
  }

  private async zipChange(spot: ZipSpot, ops: ZipOp[]): Promise<ZipEditResult> {
    const result = await this.queued(spot.file, () => editZip(spot.file, spot.chain, ops))
    if (result.ok) this.forgetZips()
    return result
  }

  /** What `zipChange` said, as the answer of an operation whose result is `path`. */
  private opResult(result: ZipEditResult, path: (names: string[]) => string): OpResult {
    return result.ok ? { ok: true, path: path(result.names) } : { ok: false, error: result.error }
  }

  /** The path of `name` in the container `at` (`parent` is the path the interface knows it by). */
  private childPath(parent: string, at: ZipSpot, name: string): string {
    return at.entry === '' ? (parent === '' ? name : `${parent}${INNER}${name}`) : `${parent}/${name}`
  }

  /** The root for a change: any root that is not the trash. */
  private changeable(id: string): OpenRoot | null {
    const root = this.open.get(id)
    return root && !root.trash ? root : null
  }

  /** A new empty file or folder in `parent` of the root. */
  async create(id: string, parent: string, name: string, kind: 'file' | 'dir'): Promise<OpResult> {
    const root = this.changeable(id)
    if (!root) return { ok: false, error: 'unsupported' }
    const spot = await this.zipSpot(root, parent, 'container')
    if (spot && 'error' in spot) return { ok: false, error: spot.error }
    if (spot) {
      if (nameProblem(name, 'linux')) return { ok: false, error: 'invalid-name' }
      const full = spot.entry === '' ? name : `${spot.entry}/${name}`
      return this.opResult(await this.zipChange(spot, [kind === 'dir' ? { op: 'mkdir', name: full } : { op: 'create', name: full }]), () => this.childPath(parent, spot, name))
    }
    const disk = this.writable(id)
    return disk ? this.changed(createEntry(disk.real, parent, name, kind)) : { ok: false, error: 'unsupported' }
  }

  async rename(id: string, name: string, newName: string): Promise<OpResult> {
    const root = this.changeable(id)
    if (!root) return { ok: false, error: 'unsupported' }
    const spot = await this.zipSpot(root, name, 'item')
    if (spot && 'error' in spot) return { ok: false, error: spot.error }
    if (spot) {
      if (nameProblem(newName, 'linux')) return { ok: false, error: 'invalid-name' }
      const to = [...spot.entry.split('/').slice(0, -1), newName].join('/')
      return this.opResult(await this.zipChange(spot, [{ op: 'move', from: spot.entry, to }]), () => name.slice(0, name.length - spot.entry.length) + to)
    }
    const disk = this.writable(id)
    return disk ? this.changed(renameEntry(disk.real, name, newName)) : { ok: false, error: 'unsupported' }
  }

  async move(id: string, name: string, toFolder: string): Promise<OpResult> {
    const root = this.changeable(id)
    if (!root) return { ok: false, error: 'unsupported' }
    const from = await this.zipSpot(root, name, 'item')
    const into = await this.zipSpot(root, toFolder, 'container')
    if (from && 'error' in from) return { ok: false, error: from.error }
    if (into && 'error' in into) return { ok: false, error: into.error }
    if (from || into) {
      // Between the disk and a ZIP, or from one ZIP to another, nothing is moved (yet).
      if (!from || !into || !this.sameZip(from, into)) return { ok: false, error: 'unsupported' }
      const base = from.entry.split('/').at(-1)!
      const to = into.entry === '' ? base : `${into.entry}/${base}`
      return this.opResult(await this.zipChange(from, [{ op: 'move', from: from.entry, to }]), () => this.childPath(toFolder, into, base))
    }
    const disk = this.writable(id)
    return disk ? this.changed(moveEntry(disk.real, name, toFolder)) : { ok: false, error: 'unsupported' }
  }

  /** A copy in a folder of the root (numbered when the name is taken: nothing is replaced). */
  async copy(id: string, name: string, toFolder: string): Promise<OpResult> {
    const root = this.changeable(id)
    if (!root) return { ok: false, error: 'unsupported' }
    const from = await this.zipSpot(root, name, 'item')
    const into = await this.zipSpot(root, toFolder, 'container')
    if (from && 'error' in from) return { ok: false, error: from.error }
    if (into && 'error' in into) return { ok: false, error: into.error }
    if (from || into) {
      if (!from || !into || !this.sameZip(from, into)) return { ok: false, error: 'unsupported' }
      return this.opResult(await this.zipChange(from, [{ op: 'copy', from: from.entry, toFolder: into.entry }]), (names) => this.childPath(toFolder, into, names[0].split('/').at(-1)!))
    }
    const disk = this.writable(id)
    return disk ? this.changed(copyEntry(disk.real, name, toFolder)) : { ok: false, error: 'unsupported' }
  }

  /** To the trash (`trash` is the system's), or for good. An entry of a ZIP has no trash: it is only removed for good (`trash-failed` for the trash, so that the caller asks). */
  async remove(id: string, name: string, how: 'trash' | 'forever', trash: (file: string) => Promise<void>): Promise<OpResult> {
    const root = this.changeable(id)
    if (!root) return { ok: false, error: 'unsupported' }
    const spot = await this.zipSpot(root, name, 'item')
    if (spot && 'error' in spot) return { ok: false, error: spot.error }
    if (spot) return how === 'trash' ? { ok: false, error: 'trash-failed' } : this.opResult(await this.zipChange(spot, [{ op: 'remove', name: spot.entry }]), () => name)
    const disk = this.writable(id)
    return disk ? this.changed(removeEntry(disk.real, name, how, trash)) : { ok: false, error: 'unsupported' }
  }

  /** The text of a file in a ZIP, read again from the disk (not from what was kept), and what the entry was like. */
  private async editZipEntry(root: OpenRoot, name: string, spot: ZipSpot): Promise<EditOpen> {
    if (!(await zipIsWritable(spot.file))) return { ok: false, error: 'read-only' }
    this.forgetZips()
    const archive = await this.zipArchive(root, partsOf(name).slice(0, -1).join(INNER)).catch(() => null)
    const info = archive?.info(spot.entry)
    if (!archive || !info || info.directory) return { ok: false, error: 'no-file' }
    if (info.unreadable) return { ok: false, error: 'unsupported' }
    if (info.size > EDIT_LIMIT) return { ok: false, error: 'too-large' }
    let bytes: Buffer
    try {
      bytes = await archive.read(info.name, EDIT_LIMIT)
    } catch {
      return { ok: false, error: 'no-file' }
    }
    const decoded = decodeForEdit(bytes)
    return 'error' in decoded ? { ok: false, error: decoded.error } : { ok: true, ...decoded, version: { mtimeMs: Date.parse(info.modified), size: info.size, crc32: info.crc32 } }
  }

  /** A file to be edited: its text and what it was like (a file of a folder or an entry of a ZIP; not in the trash, nor a snapshot). */
  async edit(id: string, name: string): Promise<EditOpen> {
    const root = this.changeable(id)
    if (!root) return { ok: false, error: 'unsupported' }
    const spot = await this.zipSpot(root, name, 'item')
    if (spot && 'error' in spot) return { ok: false, error: 'no-file' }
    if (spot) return this.editZipEntry(root, name, spot)
    const disk = this.writable(id)
    return disk ? readForEdit(disk.real, name) : { ok: false, error: 'unsupported' }
  }

  /** The edited text of a file, written whole and atomically (and only if what was read is still there, unless `overwrite`). */
  async saveEdit(id: string, name: string, text: string, base: FileVersion, options: { eol: LineEnding; bom: boolean; overwrite?: boolean }): Promise<EditSave> {
    const root = this.changeable(id)
    if (!root) return { ok: false, error: 'unsupported' }
    const spot = await this.zipSpot(root, name, 'item')
    if (spot && 'error' in spot) return { ok: false, error: 'no-file' }
    if (spot) {
      const data = encodeEdited(text, options)
      if (data.length > SAVE_LIMIT) return { ok: false, error: 'too-large' }
      const checked = options.overwrite !== true && base.crc32 !== undefined ? { base: { size: base.size, crc32: base.crc32 } } : {}
      const result = await this.zipChange(spot, [{ op: 'replace', name: spot.entry, data, ...checked }])
      if (!result.ok) return { ok: false, error: result.error === 'not-found' ? 'no-file' : result.error === 'changed' || result.error === 'denied' || result.error === 'too-large' || result.error === 'read-only' ? result.error : 'failed' }
      const archive = await this.zipArchive(root, partsOf(name).slice(0, -1).join(INNER)).catch(() => null)
      const info = archive?.info(spot.entry)
      return info ? { ok: true, version: { mtimeMs: Date.parse(info.modified), size: info.size, crc32: info.crc32 } } : { ok: false, error: 'failed' }
    }
    const disk = this.writable(id)
    return disk ? saveEdited(disk.real, name, text, base, options) : { ok: false, error: 'unsupported' }
  }

  /** A file of a folder root to be edited as bytes (the hexadecimal view): all of them, up to 16 MiB. */
  editBytes(id: string, name: string): Promise<EditBytesOpen> {
    const root = this.writable(id)
    return root ? readBytesForEdit(root.real, name) : Promise.resolve({ ok: false, error: 'unsupported' })
  }

  saveEditBytes(id: string, name: string, bytes: Uint8Array, base: FileVersion, overwrite: boolean): Promise<EditSave> {
    const root = this.writable(id)
    return root ? saveEditedBytes(root.real, name, bytes, base, overwrite) : Promise.resolve({ ok: false, error: 'unsupported' })
  }

  // ---- every file of a root, by name (Go to File)

  /**
   * The paths of the files of a root, found breadth first so that the files near the top come first when the list is cut. A folder of the disk is walked (not through a symbolic link, and
   * not into `node_modules` or `.git`; the files and folders that start with a dot only with `hidden`); a ZIP root gives its entries; a ZIP file in a folder is not opened (it is a file
   * here, and is found by its name).
   */
  async listFiles(id: string, hidden = false): Promise<FileListResult> {
    const root = this.open.get(id)
    if (!root) return { error: 'no-root' }
    const paths: string[] = []
    if (root.kind === 'zip') {
      try {
        const zip = await this.zipArchive(root, '')
        for (const entry of zip.entries) {
          if (entry.directory || entry.unreadable) continue
          if (!hidden && entry.name.split('/').some(isHidden)) continue
          if (paths.length >= FILE_LIMIT) return { paths, truncated: true }
          paths.push(entry.name)
        }
        return { paths, truncated: zip.truncated }
      } catch (err) {
        return { error: err instanceof ZipError && err.code === 'too-large' ? 'too-large' : 'not-zip' }
      }
    }
    const queue: { real: string; relative: string }[] = [{ real: root.real, relative: '' }]
    try {
      for (let next = 0; next < queue.length; next++) {
        const { real, relative } = queue[next]
        let dirents: fs.Dirent[]
        try {
          dirents = await fsp.readdir(real, { withFileTypes: true })
        } catch (err) {
          // The root itself that cannot be read is said; a folder inside that cannot is left out.
          if (next === 0) return { error: (err as NodeJS.ErrnoException).code === 'EACCES' ? 'denied' : 'no-root' }
          continue
        }
        for (const d of dirents) {
          if (!hidden && isHidden(d.name)) continue
          const path_ = relative ? `${relative}/${d.name}` : d.name
          if (d.isDirectory()) {
            if (!NOT_INDEXED.has(d.name)) queue.push({ real: path.join(real, d.name), relative: path_ })
          } else if (d.isFile() || d.isSymbolicLink()) {
            if (paths.length >= FILE_LIMIT) return { paths, truncated: true }
            paths.push(path_)
          }
        }
      }
    } catch {
      return { error: 'denied' }
    }
    return { paths, truncated: false }
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
