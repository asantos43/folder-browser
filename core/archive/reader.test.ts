import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeSampleWsnp, WSNP_TYPE } from '../../fixtures/build.ts'
import { ArchiveError, openArchive } from './reader.ts'
import { writeZip } from './writer.ts'

let dir: string
let sample: string

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-archive-'))
  sample = path.join(dir, 'sample.wsnp')
  await writeSampleWsnp(sample)
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const bytesOf = async (stream: AsyncIterable<Buffer>) => Buffer.concat(await Array.fromAsync(stream))

/** Copies the sample and lets `edit` change its bytes. */
function corrupted(name: string, edit: (bytes: Buffer) => void): string {
  const bytes = fs.readFileSync(sample)
  edit(bytes)
  const file = path.join(dir, name)
  fs.writeFileSync(file, bytes)
  return file
}

const refused = async (file: string) => {
  const err = await openArchive(file).then(() => null, (e: unknown) => e)
  expect(err).toBeInstanceOf(ArchiveError)
  return (err as ArchiveError).code
}

describe('openArchive', () => {
  it('lists the entries by the central directory, mimetype first', async () => {
    const archive = await openArchive(sample)
    expect(archive.entries.map((e) => e.name).slice(0, 3)).toEqual(['mimetype', 'manifest.json', 'index.html'])
    expect(archive.get('mimetype')).toMatchObject({ method: 0, size: WSNP_TYPE.length })
    expect(archive.get('assets/styles/site.css')?.method).toBe(8)
    await archive.close()
  })

  it('writes the media type where FORMAT.md section 3 says (byte 38, name length 8, no extra field)', () => {
    const bytes = fs.readFileSync(sample)
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50)
    expect(bytes.readUInt16LE(8)).toBe(0)
    expect(bytes.readUInt16LE(26)).toBe(8)
    expect(bytes.readUInt16LE(28)).toBe(0)
    expect(bytes.toString('latin1', 30, 38)).toBe('mimetype')
    expect(bytes.toString('latin1', 38, 38 + WSNP_TYPE.length)).toBe(WSNP_TYPE)
  })

  it('reads a stored entry and a DEFLATE entry', async () => {
    const archive = await openArchive(sample)
    expect((await archive.read('mimetype')).toString()).toBe(WSNP_TYPE)
    expect((await archive.read('assets/styles/site.css')).toString()).toContain('rgb(0,128,128)')
    await archive.close()
  })

  it('cuts a byte range of a stored entry and of a DEFLATE entry', async () => {
    const archive = await openArchive(sample)
    expect((await bytesOf(await archive.stream('mimetype', { start: 12, end: 16 }))).toString()).toBe('vnd.')
    const css = (await archive.read('assets/styles/site.css')).toString()
    expect((await bytesOf(await archive.stream('assets/styles/site.css', { start: 0, end: 2 }))).toString()).toBe(css.slice(0, 2))
    await archive.close()
  })

  it('closes each file once: opening and closing many archives never hits another one\'s descriptor', async () => {
    for (let i = 0; i < 150; i++) {
      const a = await openArchive(sample)
      const stream = await a.stream('assets/styles/site.css') // still unread when the archive is closed
      await a.close()
      const b = await openArchive(sample)
      expect((await bytesOf(stream)).toString()).toContain('rgb(0,128,128)') // the stream outlives close()
      expect((await b.read('mimetype')).toString()).toBe(WSNP_TYPE)
      await b.close()
    }
  })

  it('refuses a range outside the entry and an entry that is not there', async () => {
    const archive = await openArchive(sample)
    await expect(archive.stream('mimetype', { start: 0, end: 999 })).rejects.toMatchObject({ code: 'range' })
    await expect(archive.read('nope.txt')).rejects.toMatchObject({ code: 'missing-entry' })
    await archive.close()
  })

  it('refuses what is not a ZIP', async () => {
    const file = path.join(dir, 'text.wsnp')
    fs.writeFileSync(file, 'this is not a zip file at all, only text that is long enough to be scanned')
    expect(await refused(file)).toBe('not-zip')
  })

  it('refuses ZIP64 (saturated end-of-directory counters)', async () => {
    const file = corrupted('zip64.wsnp', (bytes) => {
      const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
      bytes.writeUInt16LE(0xffff, eocd + 10)
    })
    expect(await refused(file)).toBe('zip64')
  })

  it('refuses ZIP-level encryption', async () => {
    const file = corrupted('encrypted.wsnp', (bytes) => {
      const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
      bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8)
    })
    expect(await refused(file)).toBe('encrypted')
  })

  it('refuses a compression method other than stored or DEFLATE', async () => {
    const file = corrupted('method.wsnp', (bytes) => {
      const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
      bytes.writeUInt16LE(12, central + 10)
    })
    expect(await refused(file)).toBe('method')
  })

  it('fails a read whose data does not match the size the directory declares', async () => {
    const file = corrupted('size.wsnp', (bytes) => {
      // Walk the central directory to index.html and declare one byte more than there is.
      let at = bytes.readUInt32LE(bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 16)
      while (bytes.toString('utf8', at + 46, at + 46 + bytes.readUInt16LE(at + 28)) !== 'index.html') {
        at += 46 + bytes.readUInt16LE(at + 28) + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32)
      }
      bytes.writeUInt32LE(bytes.readUInt32LE(at + 24) + 1, at + 24)
    })
    const archive = await openArchive(file)
    await expect(archive.read('index.html')).rejects.toThrow(/expected 384|not enough bytes|size/i)
    await archive.close()
  })

  it('refuses a path that leaves the archive', async () => {
    const file = path.join(dir, 'evil.wsnp')
    // The writer refuses such a name, so write a harmless one of the same length and patch it.
    await writeZip(file, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'aa/evil.txt', data: 'x' }])
    const bytes = fs.readFileSync(file)
    for (let at = bytes.indexOf('aa/evil.txt'); at >= 0; at = bytes.indexOf('aa/evil.txt', at + 1)) bytes.write('../evil.txt', at)
    fs.writeFileSync(file, bytes)
    expect(await refused(file)).toBe('unsafe-path')
  })
})
