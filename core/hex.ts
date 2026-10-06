/** Pure helpers of the hex view: rows of bytes, search patterns, and what a file's first bytes say it is. Nothing here reads a file or runs anything in it. */

/** Bytes in a row of the view (as `xxd` and `hexdump -C` do). */
export const HEX_WIDTH = 16

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/** The two hex digits of a byte. */
export const hexByte = (byte: number): string => HEX[byte & 255]

/** A byte as it is drawn in the text column: itself when printable ASCII, a dot otherwise. */
export const asciiOf = (byte: number): string => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.')

/** The offset column: 8 digits, or 12 once a file is over 4 GiB, so that the column keeps one width. */
export function offsetLabel(offset: number, total: number): string {
  return offset.toString(16).padStart(total > 0xffffffff ? 12 : 8, '0')
}

export interface HexRow {
  offset: number
  /** One entry per byte of the row (fewer in the last row). */
  hex: string[]
  /** The text column of the same bytes. */
  ascii: string
}

/** The row that starts at `offset` in `bytes`, which holds the file from `base` on. */
export function hexRow(bytes: Uint8Array, offset: number, base = 0, width = HEX_WIDTH): HexRow {
  const from = offset - base
  const slice = bytes.subarray(Math.max(0, from), Math.max(0, from) + width)
  const hex: string[] = []
  let ascii = ''
  for (const byte of slice) {
    hex.push(hexByte(byte))
    ascii += asciiOf(byte)
  }
  return { offset, hex, ascii }
}

/** The bytes a hex search means: `4d 5a`, `4D5A`, `0x4d,0x5a`. Null when the text is not whole bytes in hex. */
export function parseHex(text: string): Uint8Array | null {
  const digits = text.replace(/0x/gi, '').replace(/[\s,:-]+/g, '')
  if (digits.length === 0 || digits.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(digits)) return null
  const bytes = new Uint8Array(digits.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/** The offset a "go to" box means: `1f40`, `0x1f40`, or a decimal with a leading `#` (`#8000`). Null when it is neither. */
export function parseOffset(text: string): number | null {
  const value = text.trim()
  if (/^#\d+$/.test(value)) return Number(value.slice(1))
  const digits = value.replace(/^0x/i, '')
  if (!/^[0-9a-f]+$/i.test(digits) || digits.length > 12) return null
  return Number.parseInt(digits, 16)
}

/** The first place of `needle` in `hay` at or after `from` (`-1` when there is none). With `backwards`, the last place that starts before `from`. */
export function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0, backwards = false): number {
  if (needle.length === 0 || needle.length > hay.length) return -1
  const last = hay.length - needle.length
  const matches = (at: number): boolean => {
    for (let i = 0; i < needle.length; i++) if (hay[at + i] !== needle[i]) return false
    return true
  }
  if (backwards) {
    for (let at = Math.min(from - 1, last); at >= 0; at--) if (matches(at)) return at
    return -1
  }
  for (let at = Math.max(0, from); at <= last; at++) if (matches(at)) return at
  return -1
}

export interface Identity {
  /** A short family name: `ELF`, `PE`, `Mach-O`, `ZIP`… */
  format: string
  /** What `file` would say, in a line. */
  description: string
}

const startsWith = (b: Uint8Array, magic: number[], at = 0): boolean => magic.every((byte, i) => b[at + i] === byte)
const u16 = (b: Uint8Array, at: number, little: boolean): number => (at + 2 <= b.length ? (little ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1]) : 0)
const u32 = (b: Uint8Array, at: number, little: boolean): number =>
  at + 4 <= b.length ? (little ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0 : ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0) : 0

const ELF_TYPES: Record<number, string> = { 1: 'relocatable object', 2: 'executable', 3: 'shared object', 4: 'core dump' }
const ELF_MACHINES: Record<number, string> = { 3: 'x86', 8: 'MIPS', 20: 'PowerPC', 21: 'PowerPC64', 40: 'ARM', 62: 'x86-64', 183: 'AArch64', 243: 'RISC-V', 22: 'S390' }
const PE_MACHINES: Record<number, string> = { 0x14c: 'x86', 0x8664: 'x86-64', 0x1c0: 'ARM', 0x1c4: 'ARM Thumb-2', 0xaa64: 'ARM64', 0x200: 'IA-64' }
const PE_SUBSYSTEMS: Record<number, string> = { 1: 'native', 2: 'GUI', 3: 'console', 9: 'Windows CE GUI', 10: 'EFI application' }
const MACHO_CPUS: Record<number, string> = { 7: 'x86', 0x01000007: 'x86-64', 12: 'ARM', 0x0100000c: 'ARM64', 18: 'PowerPC', 0x01000012: 'PowerPC64' }
const MACHO_TYPES: Record<number, string> = { 1: 'object', 2: 'executable', 3: 'fixed VM library', 4: 'core dump', 5: 'preloaded executable', 6: 'dynamic library', 7: 'dynamic linker', 8: 'bundle' }

function elf(b: Uint8Array): Identity {
  const bits = b[4] === 2 ? 64 : 32
  const little = b[5] !== 2
  const kind = ELF_TYPES[u16(b, 16, little)] ?? 'file'
  const machine = ELF_MACHINES[u16(b, 18, little)] ?? `machine ${u16(b, 18, little)}`
  return { format: 'ELF', description: `ELF ${bits}-bit ${little ? 'LSB' : 'MSB'} ${kind}, ${machine}` }
}

function pe(b: Uint8Array): Identity {
  // The DOS header's `e_lfanew` (at 0x3c) says where "PE\0\0" is: a file that only starts with MZ is a DOS program.
  const at = u32(b, 0x3c, true)
  if (at < 64 || !startsWith(b, [0x50, 0x45, 0, 0], at)) return { format: 'MZ', description: 'MS-DOS executable' }
  const machine = PE_MACHINES[u16(b, at + 4, true)] ?? `machine 0x${u16(b, at + 4, true).toString(16)}`
  const characteristics = u16(b, at + 22, true)
  const optional = at + 24
  const plus = u16(b, optional, true) === 0x20b
  const subsystem = PE_SUBSYSTEMS[u16(b, optional + 68, true)]
  const kind = characteristics & 0x2000 ? 'DLL' : 'executable'
  return { format: 'PE', description: `PE${plus ? '32+' : '32'} ${kind}, ${machine}${subsystem ? `, ${subsystem}` : ''}` }
}

function macho(b: Uint8Array, little: boolean, bits: 32 | 64): Identity {
  const cpu = MACHO_CPUS[u32(b, 4, little)] ?? 'unknown CPU'
  const kind = MACHO_TYPES[u32(b, 12, little)] ?? 'file'
  return { format: 'Mach-O', description: `Mach-O ${bits}-bit ${kind}, ${cpu}` }
}

/**
 * What the first bytes of a file say it is, when they say. Only the signature and the header's own fields are read: this never runs the file. `head` is the start of the
 * file (a few KiB are enough; the PE header is found by the offset the DOS header gives, so it needs the start to reach that far).
 */
export function identify(head: Uint8Array): Identity | null {
  const b = head
  if (b.length < 4) return null
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return elf(b)
  if (startsWith(b, [0x4d, 0x5a])) return pe(b)
  if (startsWith(b, [0xfe, 0xed, 0xfa, 0xce])) return macho(b, false, 32)
  if (startsWith(b, [0xfe, 0xed, 0xfa, 0xcf])) return macho(b, false, 64)
  if (startsWith(b, [0xce, 0xfa, 0xed, 0xfe])) return macho(b, true, 32)
  if (startsWith(b, [0xcf, 0xfa, 0xed, 0xfe])) return macho(b, true, 64)
  if (startsWith(b, [0xca, 0xfe, 0xba, 0xbe])) {
    // A Java class and a universal Mach-O binary start alike: a class has a major version of 45 or more where a universal binary has the count of its parts.
    const count = u32(b, 4, false)
    return u16(b, 6, false) >= 45 ? { format: 'Java', description: `Java class file, version ${u16(b, 6, false)}.${u16(b, 4, false)}` } : { format: 'Mach-O', description: `Mach-O universal binary, ${count} architectures` }
  }
  if (startsWith(b, [0x50, 0x4b, 3, 4]) || startsWith(b, [0x50, 0x4b, 5, 6])) return { format: 'ZIP', description: 'ZIP archive' }
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46])) return { format: 'PDF', description: 'PDF document' }
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return { format: 'PNG', description: 'PNG image' }
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { format: 'JPEG', description: 'JPEG image' }
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return { format: 'GIF', description: 'GIF image' }
  if (startsWith(b, [0x1f, 0x8b])) return { format: 'gzip', description: 'gzip compressed data' }
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { format: '7z', description: '7-Zip archive' }
  if (startsWith(b, [0x52, 0x61, 0x72, 0x21])) return { format: 'RAR', description: 'RAR archive' }
  if (startsWith(b, [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66])) return { format: 'SQLite', description: 'SQLite 3 database' }
  if (startsWith(b, [0x00, 0x61, 0x73, 0x6d])) return { format: 'WebAssembly', description: 'WebAssembly module' }
  if (startsWith(b, [0x23, 0x21])) {
    const line = new TextDecoder().decode(b.subarray(2, Math.min(b.length, 128))).split('\n')[0].trim()
    return { format: 'script', description: `Script, interpreter ${line || '(none)'}` }
  }
  return null
}

/** Reads `length` bytes from `offset` (fewer at the end of the file). */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>

const SEARCH_BLOCK = 2 ** 20

/**
 * The offset of the next (or, `backwards`, the previous) place of `needle` in a file of `size` bytes that `read` gives a block at a time: the first one that starts after
 * (before) `from`, wrapping round the end of the file once. `-1` when there is none, or when `stopped()` says the search is not wanted any more.
 */
export async function findInFile(read: ByteReader, size: number, needle: Uint8Array, from: number, backwards: boolean, stopped: () => boolean = () => false): Promise<number> {
  const n = needle.length
  if (n === 0 || n > size) return -1
  const last = size - n
  // The places a match can start, in the order they are looked at: after `from` to the end, then the start up to `from` (the other way round, backwards).
  const spans: [number, number][] = backwards ? [[0, Math.min(last, from - 1)], [Math.max(0, from), last]] : [[Math.max(0, from + 1), last], [0, Math.min(last, from)]]
  for (const [lo, hi] of spans) {
    if (lo > hi) continue
    // Blocks overlap by a needle less a byte, so that a match across a cut is seen once, whole.
    if (backwards) {
      let end = hi + n
      for (;;) {
        if (stopped()) return -1
        const start = Math.max(lo, end - SEARCH_BLOCK)
        const block = await read(start, end - start)
        const at = indexOfBytes(block, needle, block.length, true)
        if (at >= 0) return start + at
        if (start === lo) break
        end = start + n - 1
      }
    } else {
      let start = lo
      for (;;) {
        if (stopped()) return -1
        const end = Math.min(hi + n, start + SEARCH_BLOCK)
        const block = await read(start, end - start)
        const at = indexOfBytes(block, needle, 0)
        if (at >= 0) return start + at
        if (end === hi + n) break
        start = end - n + 1
      }
    }
  }
  return -1
}

export interface ScrollMetrics {
  rows: number
  rowHeight: number
  viewHeight: number
  /** The height of the scrolled area: the rows' own, until a file is so long that a browser would not make an area that tall; then it is scaled. */
  height: number
  scaled: boolean
}

/** Browsers refuse elements taller than a few tens of millions of pixels; a 4 GiB file has 268 million rows. */
const MAX_SCROLL_HEIGHT = 8_000_000

export function scrollMetrics(size: number, rowHeight: number, viewHeight: number): ScrollMetrics {
  const rows = Math.max(1, Math.ceil(size / HEX_WIDTH))
  const full = rows * rowHeight
  return { rows, rowHeight, viewHeight, height: Math.min(full, MAX_SCROLL_HEIGHT), scaled: full > MAX_SCROLL_HEIGHT }
}

const fitting = (m: ScrollMetrics): number => Math.max(1, Math.floor(m.viewHeight / m.rowHeight))

/** The first row to draw for a scroll position. */
export function firstRowAt(m: ScrollMetrics, scrollTop: number): number {
  if (!m.scaled) return Math.max(0, Math.min(m.rows - 1, Math.floor(scrollTop / m.rowHeight)))
  const room = Math.max(1, m.height - m.viewHeight)
  return Math.round(Math.max(0, Math.min(1, scrollTop / room)) * Math.max(0, m.rows - fitting(m)))
}

/** The scroll position that has `row` at the top: what firstRowAt turns back into it. */
export function scrollTopOf(m: ScrollMetrics, row: number): number {
  if (!m.scaled) return row * m.rowHeight
  const span = Math.max(1, m.rows - fitting(m))
  return Math.round(Math.max(0, Math.min(1, row / span)) * Math.max(0, m.height - m.viewHeight))
}
