import fs from 'node:fs'
import { PassThrough, Readable, Transform } from 'node:stream'
import yauzl from 'yauzl'

/** Why an archive was refused; `code` is stable, `message` is for people. */
export class ArchiveError extends Error {
  readonly code: 'not-zip' | 'zip64' | 'encrypted' | 'method' | 'unsafe-path' | 'missing-entry' | 'range'

  constructor(code: ArchiveError['code'], message: string) {
    super(message)
    this.name = 'ArchiveError'
    this.code = code
  }
}

export interface ArchiveEntry {
  name: string
  /** 0 = stored, 8 = DEFLATE: the only methods a .wsnp may use. */
  method: 0 | 8
  /** Uncompressed size. */
  size: number
  compressedSize: number
  crc32: number
}

/** A byte range of an uncompressed entry: `start` inclusive, `end` exclusive. */
export interface ByteRange {
  start: number
  end: number
}

export interface Archive {
  readonly path: string
  /** Every entry, in central directory order. */
  readonly entries: readonly ArchiveEntry[]
  get(name: string): ArchiveEntry | undefined
  /** The whole entry, decompressed. */
  read(name: string): Promise<Buffer>
  /**
   * The entry as a stream. With a range, only stored entries are cut without reading the rest;
   * a DEFLATE entry has to be decompressed from its start, so its range is cut from the whole.
   */
  stream(name: string, range?: ByteRange): Promise<Readable>
  close(): Promise<void>
}

const EOCD = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50

/** A ZIP64 archive is refused by the format (FORMAT.md section 2): look for its end-of-directory markers. */
export function assertNotZip64(path: string): void {
  const fd = fs.openSync(path, 'r')
  const buf = Buffer.alloc(0xffff + 22 + 20)
  let read: number
  try {
    const size = fs.fstatSync(fd).size
    read = fs.readSync(fd, buf, 0, Math.min(size, buf.length), Math.max(0, size - buf.length))
  } finally {
    fs.closeSync(fd)
  }
  buf.fill(0, read)
  let at = -1
  for (let i = read - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      at = i
      break
    }
  }
  if (at < 0) throw new ArchiveError('not-zip', 'This is not a ZIP file (no end of central directory).')
  const locator = at >= 20 && buf.readUInt32LE(at - 20) === ZIP64_LOCATOR
  const saturated = buf.readUInt16LE(at + 10) === 0xffff || buf.readUInt32LE(at + 16) === 0xffffffff
  if (locator || saturated) throw new ArchiveError('zip64', 'ZIP64 archives are not allowed in a .wsnp.')
}

// yauzl opens the file itself and closes it when the last stream of the archive is done: nothing
// here closes a descriptor, so a stream still being read is never cut and a number is never closed twice.
function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // Sizes are validated once the directory is read (see openArchive): for an encrypted stored
    // entry yauzl would otherwise fail with a size mismatch before we can say why.
    yauzl.open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: false }, (err, zip) => {
      if (err || !zip) reject(new ArchiveError('not-zip', `Cannot read ${path} as a ZIP file: ${err?.message ?? 'unknown error'}`))
      else resolve(zip)
    })
  })
}

/** yauzl reports every problem as a plain Error: sort them into the codes people can be told about. */
function fromYauzl(err: Error): ArchiveError {
  if (/encrypt/i.test(err.message)) return new ArchiveError('encrypted', 'The file uses ZIP-level encryption, which is not allowed.')
  if (/relative path|absolute path|invalid characters/i.test(err.message)) return new ArchiveError('unsafe-path', `An entry has an unsafe name (${err.message}).`)
  return new ArchiveError('not-zip', `The ZIP directory is damaged (${err.message}).`)
}

function collectEntries(zip: yauzl.ZipFile): Promise<Map<string, { info: ArchiveEntry; raw: yauzl.Entry }>> {
  return new Promise((resolve, reject) => {
    const found = new Map<string, { info: ArchiveEntry; raw: yauzl.Entry }>()
    zip.on('error', (err) => reject(fromYauzl(err)))
    zip.on('end', () => resolve(found))
    zip.on('entry', (raw: yauzl.Entry) => {
      if (raw.isEncrypted()) return reject(new ArchiveError('encrypted', `${raw.fileName} uses ZIP-level encryption, which is not allowed.`))
      if (raw.compressionMethod !== 0 && raw.compressionMethod !== 8) {
        return reject(new ArchiveError('method', `${raw.fileName} uses compression method ${raw.compressionMethod}; only stored and DEFLATE are allowed.`))
      }
      if (!raw.fileName.endsWith('/')) {
        found.set(raw.fileName, {
          raw,
          info: {
            name: raw.fileName,
            method: raw.compressionMethod as 0 | 8,
            size: raw.uncompressedSize,
            compressedSize: raw.compressedSize,
            crc32: raw.crc32,
          },
        })
      }
      zip.readEntry()
    })
    zip.readEntry()
  })
}

/**
 * yauzl must not destroy an entry's stream while one of its reads is queued (the entries of a file
 * read through one shared queue): that read then runs on a stream already cleaned up and throws in
 * a file callback, where nothing can catch it. It took the main process down when a page cancelled
 * a media request ("Cannot read properties of null (reading 'fd')"). So each reader gets a stream
 * of its own: when it is cancelled before the end, the entry's stream is detached, read to its end
 * and dropped, and closes by itself.
 */
function cancellable(source: Readable): Readable {
  const own = new PassThrough()
  source.on('error', (err) => own.destroy(err)) // kept after detaching: a late error is not left unhandled
  source.pipe(own)
  own.on('close', () => {
    if (source.readableEnded || source.destroyed) return
    source.unpipe(own)
    source.on('data', () => {})
    source.resume()
  })
  return own
}

/**
 * Opens a ZIP by its central directory only: nothing but the directory is read, and every entry is
 * read later by position, so a file of gigabytes never has to fit in memory or be unzipped to disk.
 */
export async function openArchive(path: string): Promise<Archive> {
  assertNotZip64(path)
  let zip: yauzl.ZipFile | undefined
  try {
    zip = await openZip(path)
    const found = await collectEntries(zip)
    // From here on every stream checks the size it was declared with (a public field of yauzl's ZipFile).
    ;(zip as unknown as { validateEntrySizes: boolean }).validateEntrySizes = true
    const opened = zip
    const named = (name: string) => {
      const item = found.get(name)
      if (!item) throw new ArchiveError('missing-entry', `The file has no entry named ${name}.`)
      return item
    }
    const open = (raw: yauzl.Entry, options: yauzl.ZipFileOptions): Promise<Readable> =>
      new Promise((resolve, reject) => {
        opened.openReadStream(raw, options, (err, stream) => (err || !stream ? reject(err) : resolve(cancellable(stream))))
      })

    const readWhole = async (name: string): Promise<Buffer> => {
      const chunks: Buffer[] = []
      for await (const chunk of await open(named(name).raw, {})) chunks.push(chunk as Buffer)
      const whole = Buffer.concat(chunks)
      // What the directory declares is what there must be: a stored entry can be cut short without yauzl noticing.
      if (whole.length !== named(name).info.size) throw new ArchiveError('range', `${name} holds ${whole.length} bytes, not the ${named(name).info.size} its directory declares.`)
      return whole
    }
    /** A stream that fails at its end when it was not exactly the declared size. */
    const sizeChecked = (source: Readable, name: string, expected: number): Readable => {
      let seen = 0
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          seen += chunk.length
          done(seen > expected ? new ArchiveError('range', `${name} holds more than the ${expected} bytes its directory declares.`) : null, chunk)
        },
        flush(done) {
          done(seen === expected ? null : new ArchiveError('range', `${name} holds ${seen} bytes, not the ${expected} its directory declares.`))
        },
      })
      source.on('error', (err) => counter.destroy(err))
      return source.pipe(counter)
    }

    return {
      path,
      entries: [...found.values()].map((item) => item.info),
      get: (name) => found.get(name)?.info,
      read: readWhole,
      async stream(name, range) {
        const { raw, info } = named(name)
        if (!range) return sizeChecked(await open(raw, {}), name, info.size)
        if (range.start < 0 || range.end > info.size || range.start > range.end) {
          throw new ArchiveError('range', `Bytes ${range.start}-${range.end} are outside ${name} (${info.size} bytes).`)
        }
        if (info.method === 0) return open(raw, { start: range.start, end: range.end })
        return Readable.from((await readWhole(name)).subarray(range.start, range.end))
      },
      async close() {
        opened.close()
      },
    }
  } catch (err) {
    zip?.close()
    throw err
  }
}
