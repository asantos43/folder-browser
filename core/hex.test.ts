import { describe, expect, it } from 'vitest'
import { asciiOf, findInFile, firstRowAt, hexRow, identify, indexOfBytes, offsetLabel, parseHex, parseOffset, scrollMetrics, scrollTopOf } from './hex.ts'

const bytes = (...values: number[]) => Uint8Array.from(values)

describe('hexRow', () => {
  it('gives the offset, the bytes in hex and the text of a row', () => {
    const data = Uint8Array.from([...new TextEncoder().encode('Hello, hex!'), 0x0a, 0, 0x7f, 0xff])
    const row = hexRow(data, 0)
    expect(row.hex.slice(0, 3)).toEqual(['48', '65', '6c'])
    expect(row.ascii).toBe('Hello, hex!....')
    expect(row.hex).toHaveLength(15)
  })
  it('reads a row of a window that starts later in the file', () => {
    const window = bytes(1, 2, 3, 4)
    expect(hexRow(window, 0x1002, 0x1000, 2).hex).toEqual(['03', '04'])
    expect(hexRow(window, 0x1004, 0x1000).hex).toEqual([])
  })
  it('draws only printable ASCII', () => {
    expect([0x1f, 0x20, 0x7e, 0x7f, 0x80].map(asciiOf)).toEqual(['.', ' ', '~', '.', '.'])
  })
})

describe('offsetLabel', () => {
  it('pads to 8 digits, 12 for a file over 4 GiB', () => {
    expect(offsetLabel(0x1f40, 100)).toBe('00001f40')
    expect(offsetLabel(0x1f40, 2 ** 33)).toBe('000000001f40')
  })
})

describe('parseHex', () => {
  it('accepts the usual ways of writing bytes', () => {
    expect([...parseHex('4d 5a')!]).toEqual([0x4d, 0x5a])
    expect([...parseHex('4D5A')!]).toEqual([0x4d, 0x5a])
    expect([...parseHex('0x4d, 0x5a')!]).toEqual([0x4d, 0x5a])
    expect([...parseHex('7f:45:4c:46')!]).toEqual([0x7f, 0x45, 0x4c, 0x46])
  })
  it('refuses what is not whole bytes in hex', () => {
    for (const text of ['', '4', '4d5', 'zz', '4d 5g']) expect(parseHex(text)).toBeNull()
  })
})

describe('parseOffset', () => {
  it('reads hex, 0x hex, and #decimal', () => {
    expect(parseOffset('1f40')).toBe(0x1f40)
    expect(parseOffset(' 0x1F40 ')).toBe(0x1f40)
    expect(parseOffset('#8000')).toBe(8000)
  })
  it('refuses the rest', () => {
    for (const text of ['', 'xyz', '#12a', '-1', '1234567890abc']) expect(parseOffset(text)).toBeNull()
  })
})

describe('indexOfBytes', () => {
  const hay = bytes(1, 2, 3, 1, 2, 3, 4)
  it('finds forwards and backwards', () => {
    expect(indexOfBytes(hay, bytes(1, 2, 3))).toBe(0)
    expect(indexOfBytes(hay, bytes(1, 2, 3), 1)).toBe(3)
    expect(indexOfBytes(hay, bytes(1, 2, 3), 3, true)).toBe(0)
    expect(indexOfBytes(hay, bytes(1, 2, 3), 7, true)).toBe(3)
  })
  it('says -1 when there is nothing, or nothing to look for', () => {
    expect(indexOfBytes(hay, bytes(9))).toBe(-1)
    expect(indexOfBytes(hay, bytes())).toBe(-1)
    expect(indexOfBytes(hay, bytes(3, 4, 5), 0)).toBe(-1)
  })
})

describe('identify', () => {
  it('reads an ELF header', () => {
    const head = new Uint8Array(64)
    head.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])
    head[16] = 3 // shared object
    head[18] = 62 // x86-64
    expect(identify(head)).toEqual({ format: 'ELF', description: 'ELF 64-bit LSB shared object, x86-64' })
  })
  it('reads a PE header, through the offset the DOS header gives', () => {
    const head = new Uint8Array(512)
    head.set([0x4d, 0x5a])
    head[0x3c] = 0x80
    head.set([0x50, 0x45, 0, 0], 0x80)
    head[0x84] = 0x64
    head[0x85] = 0x86 // x86-64
    head[0x96] = 0x22 // characteristics: executable image (0x0002) | large address aware... bit 0x2000 clear: not a DLL
    head[0x98] = 0x0b
    head[0x99] = 0x02 // PE32+
    head[0x98 + 68] = 3 // console
    expect(identify(head)).toEqual({ format: 'PE', description: 'PE32+ executable, x86-64, console' })
    head[0x97] = 0x20 // DLL bit
    expect(identify(head)?.description).toContain('DLL')
  })
  it('says a file that only starts with MZ is a DOS program', () => {
    expect(identify(bytes(0x4d, 0x5a, 0, 0, 0))?.description).toBe('MS-DOS executable')
  })
  it('tells a Java class from a universal Mach-O binary', () => {
    expect(identify(bytes(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52))).toEqual({ format: 'Java', description: 'Java class file, version 52.0' })
    expect(identify(bytes(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2))?.format).toBe('Mach-O')
  })
  it('knows the common signatures, and a shebang', () => {
    expect(identify(bytes(0x50, 0x4b, 3, 4))?.format).toBe('ZIP')
    expect(identify(bytes(0x1f, 0x8b, 8, 0))?.format).toBe('gzip')
    expect(identify(new TextEncoder().encode('#!/bin/sh\necho'))?.description).toBe('Script, interpreter /bin/sh')
  })
  it('says nothing about bytes it does not know', () => {
    expect(identify(bytes(1, 2, 3, 4, 5))).toBeNull()
    expect(identify(bytes(1, 2))).toBeNull()
  })
})

describe('findInFile', () => {
  // A file of 300 bytes of 0, with a few marks; read in blocks the way the view does.
  const file = new Uint8Array(300)
  for (const at of [0, 100, 205, 296]) file.set([7, 8, 9, 10], at)
  const read = async (offset: number, length: number) => file.slice(offset, offset + length)
  const needle = bytes(7, 8, 9, 10)
  const find = (from: number, backwards = false) => findInFile(read, file.length, needle, from, backwards)
  it('walks forward from a place, and wraps round the end once', async () => {
    expect(await find(-1)).toBe(0)
    expect(await find(0)).toBe(100)
    expect(await find(100)).toBe(205)
    expect(await find(205)).toBe(296)
    expect(await find(296)).toBe(0)
  })
  it('walks backward, and wraps round the start once', async () => {
    expect(await find(file.length, true)).toBe(296)
    expect(await find(296, true)).toBe(205)
    expect(await find(100, true)).toBe(0)
    expect(await find(0, true)).toBe(296)
  })
  it('finds nothing in a file without it, and for a needle that is empty or too long', async () => {
    expect(await findInFile(read, 300, bytes(1, 2, 3), -1, false)).toBe(-1)
    expect(await findInFile(read, 300, bytes(), -1, false)).toBe(-1)
    expect(await findInFile(read, 3, bytes(1, 2, 3, 4), -1, false)).toBe(-1)
  })
  it('gives up when it is told to stop', async () => {
    expect(await findInFile(read, 300, needle, -1, false, () => true)).toBe(-1)
  })
  it('sees a match that crosses the cut between two blocks', async () => {
    const size = 2 ** 20 + 100
    const big = new Uint8Array(size)
    big.set([1, 2, 3, 4], 2 ** 20 - 2)
    const reader = async (offset: number, length: number) => big.slice(offset, offset + length)
    expect(await findInFile(reader, size, bytes(1, 2, 3, 4), -1, false)).toBe(2 ** 20 - 2)
    expect(await findInFile(reader, size, bytes(1, 2, 3, 4), size, true)).toBe(2 ** 20 - 2)
  })
})

describe('scrolling a file of any length', () => {
  it('maps a scroll position to a row and back, as it is', () => {
    const m = scrollMetrics(16 * 1000, 20, 400)
    expect(m.scaled).toBe(false)
    expect(m.rows).toBe(1000)
    expect(firstRowAt(m, 0)).toBe(0)
    expect(firstRowAt(m, 205)).toBe(10)
    expect(scrollTopOf(m, 10)).toBe(200)
  })
  it('scales the scroll for a file with more rows than a browser can scroll', () => {
    const m = scrollMetrics(2 ** 32, 20, 400)
    expect(m.scaled).toBe(true)
    expect(m.height).toBeLessThan(20 * m.rows)
    expect(firstRowAt(m, 0)).toBe(0)
    expect(firstRowAt(m, m.height - m.viewHeight)).toBe(m.rows - 20)
    const row = 123_456_789
    expect(Math.abs(firstRowAt(m, scrollTopOf(m, row)) - row)).toBeLessThan(40)
  })
  it('has one row for an empty file', () => {
    expect(scrollMetrics(0, 20, 400).rows).toBe(1)
  })
})
