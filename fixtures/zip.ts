import zlib from 'node:zlib'
import yazl from 'yazl'

export interface ZipItem {
  name: string
  data?: Buffer | string
  /** Stored instead of DEFLATE. */
  store?: boolean
  /** The entry is a symbolic link (Unix mode in the ZIP directory). */
  symlink?: boolean
}

const MTIME = new Date(Date.UTC(2026, 8, 29, 12, 0, 0))

/** A ZIP in memory, for the tests (an inner ZIP of a snapshot, or one with hostile names). Names are written as given. */
export function zipBuffer(items: ZipItem[]): Promise<Buffer> {
  const zip = new yazl.ZipFile()
  for (const item of items) {
    const options = { mtime: MTIME, compress: !item.store, ...(item.symlink ? { mode: 0o120777 } : {}) }
    if (item.name.endsWith('/')) zip.addEmptyDirectory(item.name, { mtime: MTIME })
    else zip.addBuffer(Buffer.from(item.data ?? ''), item.name, options)
  }
  zip.end()
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)
  })
}

/** Renames an entry in place, in both places a ZIP says its name (the new name must be as long as the old one). Lets a test make names that yazl refuses to write. */
export function renameInZip(zip: Buffer, from: string, to: string): Buffer {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) throw new Error('the names must be as long')
  const out = Buffer.from(zip)
  const a = Buffer.from(from)
  const b = Buffer.from(to)
  for (let at = out.indexOf(a); at >= 0; at = out.indexOf(a, at + 1)) b.copy(out, at)
  return out
}

/** A ZIP made at once, every entry stored (no compression): for fixtures that are built when the module loads. */
export function zipSync(items: { name: string; data?: Buffer | string }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  // 2026-09-29 12:00:00 in DOS date and time.
  const time = 12 << 11
  const date = ((2026 - 1980) << 9) | (9 << 5) | 29
  for (const item of items) {
    const name = Buffer.from(item.name)
    const data = Buffer.from(item.data ?? '')
    const crc = zlib.crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(item.name.endsWith('/') ? 0x10 : 0, 38)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, data)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(items.length, 8)
  end.writeUInt16LE(items.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
