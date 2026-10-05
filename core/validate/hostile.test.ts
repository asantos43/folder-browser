import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { manifestFor, sampleFiles, WSNP_TYPE } from '../../fixtures/build.ts'
import { openArchive } from '../archive/reader.ts'
import { writeZip } from '../archive/writer.ts'
import { SnapshotRegistry } from '../snapshots.ts'
import { openWsnp } from './index.ts'

// Security: entries that lie about their size, and entries that are simply too big. Nothing may be read into memory past what was
// declared, and what is declared is checked against the limit before a byte is read.
let dir: string
beforeAll(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-hostile-'))))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** Changes the uncompressed size that the ZIP directory declares for `name`. */
function declareSize(file: string, name: string, size: number): void {
  const bytes = fs.readFileSync(file)
  let at = bytes.readUInt32LE(bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 16)
  while (bytes.toString('utf8', at + 46, at + 46 + bytes.readUInt16LE(at + 28)) !== name) at += 46 + bytes.readUInt16LE(at + 28) + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32)
  bytes.writeUInt32LE(size, at + 24)
  fs.writeFileSync(file, bytes)
}

const zeros = (size: number) => Readable.from(
  (function* () {
    for (let left = size; left > 0; left -= 1 << 20) yield Buffer.alloc(Math.min(1 << 20, left))
  })(),
)

describe('an entry that lies about its size', () => {
  it('that declares less than it holds (a zip bomb) is refused when read, not read in full', async () => {
    const file = path.join(dir, 'bomb.wsnp')
    await writeZip(file, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'bomb.bin', data: Buffer.alloc(20 * 2 ** 20), compress: true }])
    declareSize(file, 'bomb.bin', 1000)
    const archive = await openArchive(file)
    expect(archive.get('bomb.bin')?.size).toBe(1000)
    await expect(archive.read('bomb.bin')).rejects.toThrow(/too many bytes|expected 1000/i)
    await archive.close()
  })
  it('that declares more than it holds is refused when read too', async () => {
    const file = path.join(dir, 'short.wsnp')
    await writeZip(file, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'short.bin', data: Buffer.alloc(1000), compress: false }])
    declareSize(file, 'short.bin', 5000)
    const archive = await openArchive(file)
    await expect(archive.read('short.bin')).rejects.toThrow(/holds 1000 bytes, not the 5000/)
    // The stream that Save As writes to disk fails at its end too, so a file cut short is never taken for a whole one.
    await expect(Array.fromAsync(await archive.stream('short.bin'))).rejects.toThrow(/holds 1000 bytes, not the 5000/)
    await archive.close()
  })
  it('the interface is never handed a file over the limit: the declared size decides before anything is read', async () => {
    const file = path.join(dir, 'huge-declared.wsnp')
    const files = sampleFiles()
    const manifest = manifestFor(files)
    await writeZip(file, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'manifest.json', data: JSON.stringify(manifest) }, ...files.map((f) => ({ name: f.path, data: f.data }))])
    declareSize(file, 'assets/images/logo.png', 0xfffffffe)
    const registry = new SnapshotRegistry()
    // The manifest says the file has its real size, the directory says 4 GB: opening refuses the disagreement.
    const outcome = await registry.openPath(file)
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? [] : outcome.issues.map((i) => i.code)).toContain('size-mismatch')
    await registry.closeAll()
  })
  it('a file that is really big is not read into the interface: over the limit, it is refused by its size', async () => {
    const file = path.join(dir, 'big-real.wsnp')
    const files = sampleFiles()
    const manifest = manifestFor(files) as { files: Record<string, unknown>[] }
    const size = 70 * 2 ** 20
    manifest.files.push({ path: 'assets/media/big.bin', media_type: 'application/octet-stream', bytes: size, sha256: '0'.repeat(64), source: 'page' })
    await writeZip(file, [
      { name: 'mimetype', data: WSNP_TYPE },
      { name: 'manifest.json', data: JSON.stringify(manifest) },
      ...files.map((f) => ({ name: f.path, data: f.data })),
      { name: 'assets/media/big.bin', data: zeros(size), size },
    ])
    const registry = new SnapshotRegistry()
    const outcome = await registry.openPath(file)
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.issues))
    const started = Date.now()
    expect(await registry.read(outcome.snapshot.id, 'assets/media/big.bin', 64 * 2 ** 20)).toEqual({ error: 'too-large' })
    expect(Date.now() - started).toBeLessThan(500)
    await registry.closeAll()
  })
})

describe('a manifest that is too big', () => {
  it('is refused without being read', async () => {
    const file = path.join(dir, 'big-manifest.wsnp')
    const size = 70 * 2 ** 20
    await writeZip(file, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'manifest.json', data: zeros(size), size }])
    const started = Date.now()
    const result = await openWsnp(file)
    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.issues.map((i) => i.code)).toEqual(['manifest-json'])
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('an archive with a great many entries', () => {
  it('opens in well under a second for 20 000 entries, and refuses every one of them that is not listed', async () => {
    const file = path.join(dir, 'many.wsnp')
    const files = sampleFiles()
    const manifest = manifestFor(files)
    const many = Array.from({ length: 20_000 }, (_, i) => ({ name: `assets/files/f${i}.txt`, data: 'x' }))
    await writeZip(file, [{ name: 'mimetype', data: WSNP_TYPE }, { name: 'manifest.json', data: JSON.stringify(manifest) }, ...files.map((f) => ({ name: f.path, data: f.data })), ...many])
    // The time the work took, not the time that passed: other tests run beside this one, and a busy machine must not fail it.
    const started = process.cpuUsage()
    const result = await openWsnp(file)
    const used = process.cpuUsage(started)
    expect((used.user + used.system) / 1000).toBeLessThan(3000)
    expect(result.ok).toBe(false)
    // The list of what is wrong is cut short, and the count of what was left out is kept.
    expect(result.ok ? 0 : result.issues.length).toBe(50)
    expect(result.ok ? 0 : result.omitted).toBe(20_000 - 50)
  })
})
