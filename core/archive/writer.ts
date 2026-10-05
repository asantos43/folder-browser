import fs from 'node:fs'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'

export interface WriteEntry {
  name: string
  /** A stream needs `size` (its exact length in bytes) so the entry has no data descriptor. */
  data: Buffer | string | Readable
  size?: number
  /** DEFLATE the entry. Streams are always stored. Default: false. */
  compress?: boolean
}

// A fixed date keeps the files reproducible.
const MTIME = new Date(Date.UTC(2026, 8, 29, 12, 0, 0))

/**
 * Writes a ZIP as a stream, entries in the order given (so `mimetype` can be first), without
 * ZIP64 and without holding the entries' bytes in memory when they are streams.
 */
export async function writeZip(path: string, entries: WriteEntry[]): Promise<void> {
  const zip = new yazl.ZipFile()
  for (const entry of entries) {
    if (typeof entry.data === 'string' || Buffer.isBuffer(entry.data)) {
      const bytes = typeof entry.data === 'string' ? Buffer.from(entry.data) : entry.data
      zip.addBuffer(bytes, entry.name, { compress: entry.compress ?? false, mtime: MTIME })
    } else {
      if (entry.size === undefined) throw new Error(`${entry.name}: a stream entry needs its size`)
      zip.addReadStream(entry.data, entry.name, { compress: false, size: entry.size, mtime: MTIME })
    }
  }
  zip.end()
  await pipeline(zip.outputStream, fs.createWriteStream(path))
}
