import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

/** A ZIP inside a snapshot (a file the page saved), read in memory: the list, one entry, or a selection written to disk. */
export interface ZipEntryInfo {
  /** As the ZIP says it (a folder ends with `/`). */
  name: string
  size: number
  compressedSize: number
  directory: boolean
  /** The CRC-32 the ZIP declares for the entry: with the size and date, what an edit checks to know the entry is the one that was read. */
  crc32: number
  /** Not readable here: ZIP-level encryption, a compression method other than stored and DEFLATE, a symbolic link, or a name that could leave the folder it is extracted to. */
  unreadable?: 'encrypted' | 'method' | 'link' | 'name'
  /** ISO 8601, from the entry's own date. */
  modified: string
}

export const ZIP_LIST_LIMIT = 50_000
/** What one extraction may write in all: a ZIP that says it holds more is refused (a "bomb"). */
export const EXTRACT_LIMIT = 8 * 2 ** 30

export class ZipError extends Error {
  readonly code: 'not-zip' | 'too-many' | 'missing' | 'unreadable' | 'too-large' | 'unsafe'
  constructor(code: ZipError['code'], message: string) {
    super(message)
    this.name = 'ZipError'
    this.code = code
  }
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/**
 * The relative path an entry is written under, or null when its name could leave the chosen folder (absolute, a drive, `..`,
 * a backslash, a NUL). Characters Windows cannot have in a name become `_`, so the same ZIP extracts on every system.
 */
export function safeRelative(name: string): string | null {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null
  const parts = name.replace(/\/+$/, '').split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null
  return parts
    .map((p) => {
      const clean = [...p].map((ch) => (ch.charCodeAt(0) < 32 || '<>:"|?*'.includes(ch) ? '_' : ch)).join('').replace(/[. ]+$/, '_')
      return RESERVED.test(clean) ? `_${clean}` : clean
    })
    .join('/')
}

const S_IFMT = 0o170000
const S_IFLNK = 0o120000

export function decodeName(raw: Buffer, flags: number): string {
  const utf8 = (flags & 0x800) !== 0
  if (utf8) return raw.toString('utf8')
  const text = raw.toString('utf8')
  return text.includes('�') ? raw.toString('latin1') : text
}

export interface ZipArchive {
  readonly entries: readonly ZipEntryInfo[]
  /** The list was cut at `ZIP_LIST_LIMIT`. */
  readonly truncated: boolean
  info(name: string): ZipEntryInfo | undefined
  /** The whole entry. Refuses what is over `limit` before reading a byte. */
  read(name: string, limit: number): Promise<Buffer>
  /** The entry as a stream, checked against the size the ZIP declared. */
  stream(name: string): Promise<Readable>
}

function openBuffer(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // Names are read as bytes: yauzl would stop at the first unsafe name, and the list has to show it (and refuse it by itself).
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: false, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) reject(new ZipError('not-zip', `This is not a ZIP file (${err?.message ?? 'unknown error'}).`))
      else resolve(zip)
    })
  })
}

/** Reads the central directory of a ZIP held in memory. */
export async function openZipBuffer(buffer: Buffer): Promise<ZipArchive> {
  const zip = await openBuffer(buffer)
  const infos: ZipEntryInfo[] = []
  const raws = new Map<string, yauzl.Entry>()
  let truncated = false
  await new Promise<void>((resolve, reject) => {
    zip.on('error', (err) => reject(new ZipError('not-zip', `The ZIP directory is damaged (${err.message}).`)))
    zip.on('end', () => resolve())
    zip.on('entry', (raw: yauzl.Entry) => {
      if (infos.length >= ZIP_LIST_LIMIT) {
        truncated = true
        return resolve()
      }
      const name = decodeName(raw.fileName as unknown as Buffer, raw.generalPurposeBitFlag)
      const mode = (raw.externalFileAttributes >>> 16) & S_IFMT
      const directory = name.endsWith('/')
      let unreadable: ZipEntryInfo['unreadable']
      if (raw.isEncrypted()) unreadable = 'encrypted'
      else if (!directory && raw.compressionMethod !== 0 && raw.compressionMethod !== 8) unreadable = 'method'
      else if (mode === S_IFLNK) unreadable = 'link'
      else if (safeRelative(name) === null) unreadable = 'name'
      infos.push({ name, size: raw.uncompressedSize, compressedSize: raw.compressedSize, directory, crc32: raw.crc32, ...(unreadable ? { unreadable } : {}), modified: raw.getLastModDate().toISOString() })
      if (!raws.has(name)) raws.set(name, raw)
      zip.readEntry()
    })
    zip.readEntry()
  })
  return build(zip, infos, raws, truncated)
}

function build(zip: yauzl.ZipFile, infos: ZipEntryInfo[], raws: Map<string, yauzl.Entry>, truncated: boolean): ZipArchive {
  const byName = new Map(infos.map((i) => [i.name, i]))
  const open = (name: string): Promise<Readable> => {
    const info = byName.get(name)
    const raw = raws.get(name)
    if (!info || !raw) return Promise.reject(new ZipError('missing', `The ZIP has no entry named ${name}.`))
    if (info.directory) return Promise.reject(new ZipError('unreadable', `${name} is a folder.`))
    if (info.unreadable) return Promise.reject(new ZipError('unreadable', `${name} cannot be read (${info.unreadable}).`))
    return new Promise((resolve, reject) => {
      zip.openReadStream(raw, (err, stream) => (err || !stream ? reject(new ZipError('unreadable', err?.message ?? 'The entry cannot be read.')) : resolve(stream)))
    })
  }
  return {
    entries: infos,
    truncated,
    info: (name) => byName.get(name),
    async read(name, limit) {
      const info = byName.get(name)
      if (info && info.size > limit) throw new ZipError('too-large', `${name} is too large to open here.`)
      const stream = await open(name)
      const chunks: Buffer[] = []
      let total = 0
      for await (const chunk of stream) {
        total += (chunk as Buffer).length
        if (total > limit) {
          stream.destroy()
          throw new ZipError('too-large', `${name} is too large to open here.`)
        }
        chunks.push(chunk as Buffer)
      }
      return Buffer.concat(chunks)
    },
    stream: open,
  }
}

/** The entries a selection means: a name is a file, or a folder and everything under it. Folders alone are kept only when empty. */
export function expandSelection(entries: readonly ZipEntryInfo[], names: readonly string[]): ZipEntryInfo[] {
  const chosen = new Set<string>()
  const picked: ZipEntryInfo[] = []
  for (const name of names) {
    for (const entry of entries) {
      const inside = entry.name === name || (name.endsWith('/') && entry.name.startsWith(name))
      if (inside && !chosen.has(entry.name)) {
        chosen.add(entry.name)
        picked.push(entry)
      }
    }
  }
  return picked
}

export interface ExtractReport {
  extracted: number
  bytes: number
  /** Entries that were not written, and why. */
  skipped: { name: string; reason: string }[]
}

const free = async (target: string): Promise<{ target: string; handle: fs.promises.FileHandle }> => {
  const { dir, name, ext } = path.parse(target)
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? target : path.join(dir, `${name} (${n})${ext}`)
    try {
      return { target: candidate, handle: await fs.promises.open(candidate, 'wx') }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new ZipError('unsafe', `Too many files named ${name} already exist.`)
}

/** Stops a stream that delivers more than it may (a ZIP that lies about its sizes). */
const cap = (left: { bytes: number }) =>
  new Transform({
    transform(chunk: Buffer, _enc, done) {
      left.bytes -= chunk.length
      if (left.bytes < 0) done(new ZipError('too-large', 'The ZIP holds more than the viewer extracts at once.'))
      else done(null, chunk)
    },
  })

/**
 * Writes entries under `folder`, each at its own relative path, never outside it and never over a file that is there (the new one
 * gets " (2)"). Links and unreadable entries are skipped and reported. A ZIP that declares more than `EXTRACT_LIMIT` is refused at once.
 */
export async function extractEntries(archive: ZipArchive, picked: readonly ZipEntryInfo[], folder: string, limit = EXTRACT_LIMIT): Promise<ExtractReport> {
  const declared = picked.reduce((sum, e) => sum + (e.directory ? 0 : e.size), 0)
  if (declared > limit) throw new ZipError('too-large', 'The ZIP holds more than the viewer extracts at once.')
  const root = path.resolve(folder)
  const report: ExtractReport = { extracted: 0, bytes: 0, skipped: [] }
  const left = { bytes: limit }
  for (const entry of picked) {
    const relative = safeRelative(entry.name)
    if (entry.unreadable || relative === null) {
      report.skipped.push({ name: entry.name, reason: entry.unreadable ?? 'name' })
      continue
    }
    const target = path.resolve(root, ...relative.split('/'))
    if (target !== root && !target.startsWith(root + path.sep)) {
      report.skipped.push({ name: entry.name, reason: 'name' })
      continue
    }
    try {
      if (entry.directory) {
        await fs.promises.mkdir(target, { recursive: true })
        continue
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      const source = await archive.stream(entry.name)
      const { target: written, handle } = await free(target)
      try {
        await pipeline(source, cap(left), handle.createWriteStream())
      } catch (err) {
        await fs.promises.rm(written, { force: true })
        throw err
      }
      report.extracted++
      report.bytes += entry.size
    } catch (err) {
      if (err instanceof ZipError && err.code === 'too-large') throw err
      report.skipped.push({ name: entry.name, reason: (err as Error).message })
    }
  }
  return report
}

/** One entry written to a file the user picked (overwriting it: the save dialog asked). */
export async function extractToFile(archive: ZipArchive, name: string, file: string): Promise<void> {
  await pipeline(await archive.stream(name), fs.createWriteStream(file))
}
