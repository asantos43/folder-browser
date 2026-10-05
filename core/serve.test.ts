import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeSampleWsnp } from '../fixtures/build.ts'
import { openArchive, type Archive } from './archive/reader.ts'
import { parseRange, serveEntry, SNAPSHOT_CSP } from './serve.ts'

let dir: string
let archive: Archive
let types: Map<string, string>

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-serve-'))
  const file = path.join(dir, 'sample.wsnp')
  const manifest = (await writeSampleWsnp(file)) as { files: { path: string; media_type: string }[] }
  types = new Map(manifest.files.map((f) => [f.path, f.media_type]))
  archive = await openArchive(file)
})
afterAll(async () => {
  await archive.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const text = async (body: unknown) => Buffer.concat(await Array.fromAsync(body as AsyncIterable<Buffer>)).toString()

describe('parseRange', () => {
  it.each([
    ['bytes=0-4', 100, { start: 0, end: 5 }],
    ['bytes=90-', 100, { start: 90, end: 100 }],
    ['bytes=-10', 100, { start: 90, end: 100 }],
    ['bytes=50-999', 100, { start: 50, end: 100 }],
  ])('%s of %i bytes', (header, size, expected) => expect(parseRange(header, size)).toEqual(expected))

  it('is unsatisfiable past the end, and ignores what it does not understand', () => {
    expect(parseRange('bytes=100-', 100)).toBeNull()
    expect(parseRange('bytes=-0', 100)).toBeNull()
    expect(parseRange('bytes=0-1,5-6', 100)).toBe('ignore')
    expect(parseRange('items=0-1', 100)).toBe('ignore')
  })
})

describe('serveEntry', () => {
  it('serves the page for "/" with the policy and the manifest type', async () => {
    const res = await serveEntry(archive, '/', {}, { types })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/html')
    expect(res.headers['content-security-policy']).toBe(SNAPSHOT_CSP)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(await text(res.body)).toContain('<h2 id="item">')
  })

  it('uses the manifest media type over the extension', async () => {
    const custom = new Map(types).set('assets/styles/site.css', 'text/x-custom')
    expect((await serveEntry(archive, '/assets/styles/site.css', {}, { types: custom })).headers['content-type']).toBe('text/x-custom')
    expect((await serveEntry(archive, '/assets/styles/site.css')).headers['content-type']).toBe('text/css')
  })

  it('hides mimetype and answers 404 for what is not there', async () => {
    expect((await serveEntry(archive, '/mimetype')).status).toBe(404)
    expect((await serveEntry(archive, '/nope.png')).status).toBe(404)
    expect((await serveEntry(archive, '/%E0%A4%A')).status).toBe(400)
  })

  it('answers a byte range with 206, a suffix range, and 416 past the end', async () => {
    const whole = await text((await serveEntry(archive, '/assets/styles/site.css')).body)
    const part = await serveEntry(archive, '/assets/styles/site.css', { range: 'bytes=3-8' })
    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 3-8/${whole.length}`)
    expect(part.headers['content-length']).toBe('6')
    expect(await text(part.body)).toBe(whole.slice(3, 9))
    expect(await text((await serveEntry(archive, '/assets/styles/site.css', { range: 'bytes=-4' })).body)).toBe(whole.slice(-4))
    const past = await serveEntry(archive, '/assets/styles/site.css', { range: `bytes=${whole.length}-` })
    expect(past.status).toBe(416)
    expect(past.headers['content-range']).toBe(`bytes */${whole.length}`)
  })

  it('adds the sandbox directive for an opaque origin when asked', async () => {
    const res = await serveEntry(archive, '/', {}, { types, sandbox: true })
    expect(res.headers['content-security-policy']).toBe(`sandbox allow-scripts; ${SNAPSHOT_CSP}`)
  })
})
