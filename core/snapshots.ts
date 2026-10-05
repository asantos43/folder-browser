import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConvertError, convertPageKeepZip, isPageKeepZip } from './convert/pagekeep.ts'
import type { Archive, ByteRange } from './archive/reader.ts'
import type { Manifest } from './manifest.ts'
import { serveEntry, type ServeResult } from './serve.ts'
import { MAX_DEPTH, partsOf } from './vpath.ts'
import { openZipBuffer, type ZipArchive, ZipError } from './zip.ts'
import { ZIP_LIMIT } from './filekind.ts'
import { openWsnp, verifyContents, verifySignature, type Issue, type IssueCode, type SignatureInfo } from './validate/index.ts'

/** A snapshot that is open: its archive, its manifest, and the name its files are served under (`wsnp://<id>/`). */
/** What the user is told about a ZIP saved by PageKeep that the viewer converted to show it. */
export interface ConvertedInfo {
  /** The program that wrote the ZIP (`snapshot.json`'s `tool`). */
  tool: string
  /** What the conversion had to remove or could not resolve, in words for the log (at most 50). */
  warnings: string[]
  omitted: number
  /** Facts the ZIP does not record, which the manifest fills with defaults. */
  unrecorded: ('viewport' | 'pixel-ratio' | 'load-whole-page')[]
}

export interface OpenSnapshot {
  /** Unguessable: it is the only thing that keeps one snapshot's page from asking for another's files. */
  id: string
  /** What the user opened: the `.wsnp`, or the PageKeep ZIP it was converted from. */
  path: string
  /** The `.wsnp` archive on disk: `path` itself, or the temporary file the conversion wrote. */
  file: string
  converted?: ConvertedInfo & { dir: string }
  archive: Archive
  manifest: Manifest
  /** `media_type` of every file listed in the manifest. */
  types: ReadonlyMap<string, string>
  /** Whether the manifest is signed, and whether it is what was signed. */
  signature: SignatureInfo
}

export type OpenOutcome =
  | { ok: true; snapshot: OpenSnapshot; already: boolean }
  | { ok: false; path: string; issues: Issue[]; omitted: number }

/** What the interface needs of an open snapshot: plain data, nothing that can read the archive. */
export interface SnapshotInfo {
  id: string
  path: string
  converted?: ConvertedInfo
  manifest: Manifest
  signature: SignatureInfo
  /** Every entry of the archive with its size, for the tree. */
  files: { path: string; size: number; mediaType?: string }[]
}

export function infoOf(snapshot: OpenSnapshot): SnapshotInfo {
  return {
    id: snapshot.id,
    path: snapshot.path,
    ...(snapshot.converted ? { converted: { tool: snapshot.converted.tool, warnings: snapshot.converted.warnings, omitted: snapshot.converted.omitted, unrecorded: snapshot.converted.unrecorded } } : {}),
    manifest: snapshot.manifest,
    signature: snapshot.signature,
    files: snapshot.archive.entries.map((e) => ({ path: e.name, size: e.size, mediaType: snapshot.types.get(e.name) })),
  }
}

/** The open snapshots. A file that is already open is not opened twice: the caller shows the tab it has. */
export class SnapshotRegistry {
  private readonly open = new Map<string, OpenSnapshot>()
  private readonly options: { tempRoot: string; generator: { name: string; version: string } }

  /** `tempRoot` is where a converted ZIP is written while it is open; `generator` is named in what the conversion writes. */
  constructor(options: { tempRoot?: string; generator?: { name: string; version: string } } = {}) {
    this.options = { tempRoot: options.tempRoot ?? os.tmpdir(), generator: options.generator ?? { name: 'Folder Browser', version: '0.0.0' } }
  }
  /** The ZIPs opened inside snapshots (the last few: listing, viewing and extracting ask again and again). */
  private readonly zips = new Map<string, Promise<ZipArchive>>()

  get ids(): string[] {
    return [...this.open.keys()]
  }

  get(id: string): OpenSnapshot | undefined {
    return this.open.get(id)
  }

  has(id: string): boolean {
    return this.open.has(id)
  }

  async openPath(path: string): Promise<OpenOutcome> {
    for (const snapshot of this.open.values()) if (snapshot.path === path) return { ok: true, snapshot, already: true }
    const converted = (await isPageKeepZip(path)) ? await this.convert(path) : undefined
    if (converted && !converted.ok) return { ok: false, path, issues: converted.issues, omitted: 0 }
    const file = converted?.ok ? converted.file : path
    const result = await openWsnp(file)
    if (!result.ok) {
      if (converted?.ok) await fs.rm(converted.info.dir, { recursive: true, force: true })
      return { ok: false, path, issues: result.issues, omitted: result.omitted }
    }
    const snapshot: OpenSnapshot = {
      id: `s${crypto.randomBytes(8).toString('hex')}`,
      path,
      file,
      ...(converted?.ok ? { converted: converted.info } : {}),
      archive: result.archive,
      manifest: result.manifest,
      types: new Map(result.manifest.files.map((f) => [f.path, f.media_type])),
      signature: await verifySignature(result.archive),
    }
    this.open.set(snapshot.id, snapshot)
    return { ok: true, snapshot, already: false }
  }

  /** A ZIP saved by PageKeep, converted to a `.wsnp` in a temporary folder of its own (docs/PAGEKEEP-ZIP.md). The original is never changed. */
  private async convert(zipPath: string): Promise<{ ok: true; file: string; info: ConvertedInfo & { dir: string } } | { ok: false; issues: Issue[] }> {
    const dir = await fs.mkdtemp(path.join(this.options.tempRoot, 'wsnp-converted-'))
    const file = path.join(dir, `${path.basename(zipPath, path.extname(zipPath)).slice(0, 80) || 'snapshot'}.wsnp`)
    try {
      const report = await convertPageKeepZip(zipPath, file, { generator: this.options.generator })
      const from = report.manifest.converted_from as { tool?: string } | undefined
      return { ok: true, file, info: { dir, tool: from?.tool ?? 'unknown', warnings: report.warnings.slice(0, 50), omitted: Math.max(0, report.warnings.length - 50), unrecorded: ['viewport', 'pixel-ratio', 'load-whole-page'] } }
    } catch (err) {
      await fs.rm(dir, { recursive: true, force: true })
      const code: IssueCode = err instanceof ConvertError ? (err.code === 'no-source-url' ? 'convert-no-source' : err.code === 'unreadable' ? 'convert-unreadable' : err.code === 'too-large' ? 'convert-too-large' : 'convert-failed') : 'convert-failed'
      return { ok: false, issues: [{ code, detail: (err as Error).message }] }
    }
  }

  /**
   * The converted file, after the checks of FORMAT.md section 10 (structure, every file's SHA-256, the page scans): only a file that
   * passes is ever delivered. Returns its path in the temporary folder, or what failed.
   */
  async checkedConversion(id: string): Promise<{ file: string } | { error: 'no-snapshot' | 'not-converted' } | { problems: Issue[] }> {
    const snapshot = this.open.get(id)
    if (!snapshot) return { error: 'no-snapshot' }
    if (!snapshot.converted) return { error: 'not-converted' }
    const report = await verifyContents(snapshot.archive, snapshot.manifest)
    return report.problems.length ? { problems: report.problems.slice(0, 10) } : { file: snapshot.file }
  }

  async close(id: string): Promise<void> {
    const snapshot = this.open.get(id)
    if (!snapshot) return
    this.open.delete(id)
    for (const key of [...this.zips.keys()]) if (key.startsWith(`${id}\0`)) this.zips.delete(key)
    await snapshot.archive.close()
    if (snapshot.converted) await fs.rm(snapshot.converted.dir, { recursive: true, force: true })
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.ids.map((id) => this.close(id)))
  }

  /** The answer to a request for a file of snapshot `id`, with the policy of FORMAT.md section 10 and the `sandbox` directive. */
  async serve(id: string, urlPath: string, range?: string | null): Promise<ServeResult> {
    const snapshot = this.open.get(id)
    if (!snapshot) return { status: 403, headers: {}, body: null }
    return serveEntry(snapshot.archive, urlPath, { range }, { types: snapshot.types, entry: snapshot.manifest.pages[0].entry, sandbox: true })
  }

  /**
   * The ZIP at `path` (a file of the snapshot, or an entry of a ZIP in it), opened in memory. Kept for the next call: a listing, then a view,
   * then an extraction all use the same.
   */
  async zipAt(id: string, path: string): Promise<ZipArchive | { error: 'no-snapshot' | 'no-file' | 'too-large' | 'not-zip' }> {
    const snapshot = this.open.get(id)
    if (!snapshot) return { error: 'no-snapshot' }
    const key = `${id}\0${path}`
    let zip = this.zips.get(key)
    if (!zip) {
      const loading = this.bytesOf(snapshot, path, ZIP_LIMIT).then((got) => {
        if ('error' in got) throw new ZipError(got.error === 'too-large' ? 'too-large' : 'missing', got.error)
        return openZipBuffer(got.bytes)
      })
      this.zips.set(key, loading)
      // Only the last two stay (each holds its bytes in memory); one that failed is not kept.
      for (const old of [...this.zips.keys()].slice(0, -2)) this.zips.delete(old)
      loading.catch(() => this.zips.get(key) === loading && this.zips.delete(key))
      zip = loading
    }
    try {
      return await zip
    } catch (err) {
      if (err instanceof ZipError) return { error: err.code === 'too-large' ? 'too-large' : err.code === 'missing' ? 'no-file' : 'not-zip' }
      throw err
    }
  }

  /** The bytes of a file of the snapshot or of an entry in a ZIP in it, at most `limit`. */
  private async bytesOf(snapshot: OpenSnapshot, path: string, limit: number): Promise<{ bytes: Buffer } | { error: 'no-file' | 'too-large' }> {
    const direct = snapshot.archive.get(path)
    if (direct) return direct.size > limit ? { error: 'too-large' } : { bytes: await snapshot.archive.read(path) }
    const parts = partsOf(path)
    if (parts.length < 2 || parts.length > MAX_DEPTH + 1 || parts.some((p) => !p)) return { error: 'no-file' }
    // The ZIP that holds the last part is the path without it.
    const zip = await this.zipAt(snapshot.id, parts.slice(0, -1).join('!/'))
    if ('error' in zip) return { error: zip.error === 'too-large' ? 'too-large' : 'no-file' }
    const entry = zip.info(parts.at(-1)!)
    if (!entry || entry.directory || entry.unreadable) return { error: 'no-file' }
    try {
      return { bytes: await zip.read(entry.name, limit) }
    } catch (err) {
      if (err instanceof ZipError && err.code === 'too-large') return { error: 'too-large' }
      return { error: 'no-file' }
    }
  }

  /** A whole file, for a tab. Refuses what is not in the archive and what is over `limit`. */
  async read(id: string, name: string, limit: number): Promise<{ bytes: Buffer } | { error: 'no-snapshot' | 'no-file' | 'too-large' }> {
    const snapshot = this.open.get(id)
    if (!snapshot) return { error: 'no-snapshot' }
    return this.bytesOf(snapshot, name, limit)
  }

  /** A file as a stream (to save it to disk), whatever its size. An entry of a ZIP is streamed from the ZIP held in memory. */
  async stream(id: string, name: string, range?: ByteRange) {
    const snapshot = this.open.get(id)
    if (!snapshot) return undefined
    if (snapshot.archive.get(name)) return snapshot.archive.stream(name, range)
    const parts = partsOf(name)
    if (parts.length < 2 || parts.length > MAX_DEPTH + 1) return undefined
    const zip = await this.zipAt(id, parts.slice(0, -1).join('!/'))
    if ('error' in zip) return undefined
    return zip.stream(parts.at(-1)!).catch(() => undefined)
  }
}
