import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writePageKeepZip, writeRichWsnp, writeSampleWsnp } from '../fixtures/build.ts'
import { writeZip } from './archive/writer.ts'
import { infoOf, SnapshotRegistry } from './snapshots.ts'

let dir: string
let sample: string
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-registry-'))
  sample = path.join(dir, 'sample.wsnp')
  await writeSampleWsnp(sample)
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('SnapshotRegistry', () => {
  it('opens a file, gives it an unguessable id, and answers for its files', async () => {
    const registry = new SnapshotRegistry()
    const outcome = await registry.openPath(sample)
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.issues))
    expect(outcome.already).toBe(false)
    expect(outcome.snapshot.id).toMatch(/^s[0-9a-f]{16}$/)
    const page = await registry.serve(outcome.snapshot.id, '/')
    expect(page.status).toBe(200)
    expect(page.headers['content-type']).toBe('text/html')
    expect(page.headers['content-security-policy']).toContain('sandbox allow-scripts')
    expect((await registry.serve(outcome.snapshot.id, '/mimetype')).status).toBe(404)
    await registry.closeAll()
  })
  it('does not open the same file twice even when it is asked twice at once (a click and a double click): the second gets the snapshot of the first', async () => {
    const registry = new SnapshotRegistry()
    const [a, b, c] = await Promise.all([registry.openPath(sample), registry.openPath(sample), registry.openPath(sample)])
    if (!a.ok || !b.ok || !c.ok) throw new Error('did not open')
    expect(registry.ids).toHaveLength(1)
    expect([a.already, b.already, c.already]).toEqual([false, true, true])
    expect(new Set([a.snapshot.id, b.snapshot.id, c.snapshot.id]).size).toBe(1)
    await registry.closeAll()
    // After it is closed it opens again, as a new one.
    const later = await registry.openPath(sample)
    expect(later.ok && later.already).toBe(false)
    await registry.closeAll()
  })
  it('does not open the same file twice, and gives two files two ids', async () => {
    const registry = new SnapshotRegistry()
    const first = await registry.openPath(sample)
    const again = await registry.openPath(sample)
    if (!first.ok || !again.ok) throw new Error('did not open')
    expect(again.already).toBe(true)
    expect(again.snapshot.id).toBe(first.snapshot.id)
    const copy = path.join(dir, 'copy.wsnp')
    fs.copyFileSync(sample, copy)
    const other = await registry.openPath(copy)
    if (!other.ok) throw new Error('did not open')
    expect(other.snapshot.id).not.toBe(first.snapshot.id)
    expect(registry.ids).toHaveLength(2)
    await registry.closeAll()
  })
  it('refuses with the issues and keeps nothing open', async () => {
    const registry = new SnapshotRegistry()
    const bad = path.join(dir, 'bad.wsnp')
    fs.writeFileSync(bad, 'this is not a zip file at all, only text that is long enough to be scanned')
    const outcome = await registry.openPath(bad)
    expect(outcome).toMatchObject({ ok: false, path: bad, issues: [{ code: 'not-zip' }] })
    expect(registry.ids).toEqual([])
  })
  it('refuses a request for a snapshot that is not open (or was closed)', async () => {
    const registry = new SnapshotRegistry()
    const outcome = await registry.openPath(sample)
    if (!outcome.ok) throw new Error('did not open')
    const { id } = outcome.snapshot
    await registry.close(id)
    expect((await registry.serve(id, '/')).status).toBe(403)
    expect(await registry.read(id, 'index.html', 1000)).toEqual({ error: 'no-snapshot' })
    expect(registry.has(id)).toBe(false)
  })
  it('reads a whole file for a tab, within a limit, and streams any file for Save As', async () => {
    const registry = new SnapshotRegistry()
    const outcome = await registry.openPath(sample)
    if (!outcome.ok) throw new Error('did not open')
    const { id } = outcome.snapshot
    const css = await registry.read(id, 'assets/styles/site.css', 1000)
    expect('bytes' in css && css.bytes.toString()).toContain('h2{color')
    expect(await registry.read(id, 'assets/styles/site.css', 5)).toEqual({ error: 'too-large' })
    expect(await registry.read(id, 'nope.txt', 1000)).toEqual({ error: 'no-file' })
    const stream = await registry.stream(id, 'assets/images/logo.png')
    expect(Buffer.concat(await Array.fromAsync(stream!)).length).toBeGreaterThan(50)
    expect(await registry.stream(id, 'nope.png')).toBeUndefined()
    await registry.closeAll()
  })
  it('describes a snapshot for the interface without handing it the archive', async () => {
    const registry = new SnapshotRegistry()
    const outcome = await registry.openPath(sample)
    if (!outcome.ok) throw new Error('did not open')
    const info = infoOf(outcome.snapshot)
    expect(Object.keys(info).sort()).toEqual(['files', 'id', 'manifest', 'path', 'signature'])
    expect(info.signature).toEqual({ state: 'unsigned' })
    expect(info.files.map((f) => f.path)).toContain('assets/fonts/f.woff2')
    expect(info.files.find((f) => f.path === 'index.html')?.mediaType).toBe('text/html')
    expect(JSON.stringify(info)).not.toContain('archive')
    await registry.closeAll()
  })
})

describe('a ZIP inside a snapshot', () => {
  const read = async (registry: SnapshotRegistry, id: string, name: string) => {
    const got = await registry.read(id, name, 1 << 20)
    return 'bytes' in got ? got.bytes.toString() : got
  }

  it('lists it, reads an entry of it, and an entry of a ZIP in it, by the path ZIP!/entry', async () => {
    const rich = path.join(dir, 'rich.wsnp')
    await writeRichWsnp(rich)
    const registry = new SnapshotRegistry()
    const outcome = await registry.openPath(rich)
    if (!outcome.ok) throw new Error('did not open')
    const id = outcome.snapshot.id
    const zip = await registry.zipAt(id, 'assets/files/bundle.zip')
    if ('error' in zip) throw new Error(zip.error)
    expect(zip.entries.map((e) => e.name)).toEqual(['docs/', 'docs/readme.txt', 'docs/data.json', 'img/', 'img/dot.png', 'top.txt', 'nested.zip'])
    expect(await read(registry, id, 'assets/files/bundle.zip!/top.txt')).toBe('top level file\n')
    expect(await read(registry, id, 'assets/files/bundle.zip!/nested.zip!/deep.txt')).toBe('a file in a ZIP in a ZIP')
    expect(await read(registry, id, 'assets/files/bundle.zip!/nope.txt')).toEqual({ error: 'no-file' })
    expect(await read(registry, id, 'assets/files/bundle.zip!/docs/')).toEqual({ error: 'no-file' })
    expect(await read(registry, id, 'assets/images/logo.png!/x')).toEqual({ error: 'no-file' })
    const nested = await registry.zipAt(id, 'assets/files/bundle.zip!/nested.zip')
    if ('error' in nested) throw new Error(nested.error)
    expect(nested.entries.map((e) => e.name)).toEqual(['deep.txt'])
    await registry.closeAll()
  })

  it('streams an entry, refuses one over the limit, and says a file that is not a ZIP is not one', async () => {
    const rich = path.join(dir, 'rich2.wsnp')
    await writeRichWsnp(rich)
    const registry = new SnapshotRegistry()
    const outcome = await registry.openPath(rich)
    if (!outcome.ok) throw new Error('did not open')
    const id = outcome.snapshot.id
    const stream = await registry.stream(id, 'assets/files/bundle.zip!/docs/readme.txt')
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).toString()).toContain('ferry leaves at noon')
    expect(await registry.read(id, 'assets/files/bundle.zip!/docs/readme.txt', 5)).toEqual({ error: 'too-large' })
    expect(await registry.stream(id, 'assets/files/bundle.zip!/nope')).toBeUndefined()
    expect(await registry.zipAt(id, 'assets/files/data.json')).toEqual({ error: 'not-zip' })
    expect(await registry.zipAt(id, 'assets/files/missing.zip')).toEqual({ error: 'no-file' })
    await registry.closeAll()
    expect(await registry.zipAt(id, 'assets/files/bundle.zip')).toEqual({ error: 'no-snapshot' })
  })
})

describe('a ZIP saved by PageKeep', () => {
  it('opens converted: shown as a snapshot of the original path, with what the conversion did, in a temporary folder that goes away with it', async () => {
    const temp = fs.mkdtempSync(path.join(dir, 'temp-'))
    const zip = path.join(dir, 'old-style.zip')
    await writePageKeepZip(zip, { old: true })
    const before = fs.readFileSync(zip)
    const registry = new SnapshotRegistry({ tempRoot: temp })
    const outcome = await registry.openPath(zip)
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.issues))
    const info = infoOf(outcome.snapshot)
    expect(info.path).toBe(zip)
    expect(info.converted).toMatchObject({ tool: 'Page Snapshot 1.0.0', unrecorded: ['viewport', 'pixel-ratio', 'load-whole-page'] })
    expect(info.manifest.title).toBe('Harbor news')
    expect(info.files.map((f) => f.path)).toContain('assets/images/logo-1qg48nw.png')
    const page = await registry.serve(outcome.snapshot.id, '/')
    expect(page.status).toBe(200)
    expect(fs.readdirSync(temp)).toHaveLength(1)
    // The same file opened again is the same snapshot.
    const again = await registry.openPath(zip)
    expect(again.ok && again.already).toBe(true)
    expect(await registry.checkedConversion(outcome.snapshot.id)).toEqual({ file: outcome.snapshot.file })
    await registry.close(outcome.snapshot.id)
    expect(fs.readdirSync(temp)).toHaveLength(0)
    expect(fs.readFileSync(zip).equals(before)).toBe(true)
  })

  it('says why a ZIP that looks like PageKeep’s cannot be converted, and leaves nothing behind', async () => {
    const temp = fs.mkdtempSync(path.join(dir, 'temp-'))
    const zip = path.join(dir, 'no-source.zip')
    await writeZip(zip, [{ name: 'index.html', data: '<p>hi</p>' }, { name: 'snapshot.json', data: '{"title":"x"}' }])
    const registry = new SnapshotRegistry({ tempRoot: temp })
    const outcome = await registry.openPath(zip)
    expect(outcome).toMatchObject({ ok: false, issues: [{ code: 'convert-no-source' }] })
    expect(fs.readdirSync(temp)).toHaveLength(0)
  })

  it('an ordinary .wsnp has nothing to save as .wsnp', async () => {
    const registry = new SnapshotRegistry()
    const outcome = await registry.openPath(sample)
    if (!outcome.ok) throw new Error('did not open')
    expect(infoOf(outcome.snapshot).converted).toBeUndefined()
    expect(await registry.checkedConversion(outcome.snapshot.id)).toEqual({ error: 'not-converted' })
    await registry.closeAll()
  })
})
