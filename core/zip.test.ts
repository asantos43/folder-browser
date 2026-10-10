import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renameInZip, zipBuffer } from '../fixtures/zip.ts'
import { expandSelection, extractEntries, extractToFile, openZipBuffer, safeRelative, ZipError } from './zip.ts'

let dir: string
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnp-zip-'))))
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const sample = () =>
  zipBuffer([
    { name: 'docs/' },
    { name: 'docs/readme.txt', data: 'hello meadow' },
    { name: 'docs/deep/data.json', data: '{"a":1}' },
    { name: 'top.txt', data: 'top', store: true },
  ])

describe('safeRelative', () => {
  it.each(['../a', 'a/../b', '/abs', 'C:/x', 'C:\\x', 'a\\b', '', 'a//b', './a', 'a\0b'])('refuses %j', (name) => expect(safeRelative(name)).toBeNull())
  it('keeps an ordinary path, drops the slash of a folder, and makes Windows-unsafe characters safe', () => {
    expect(safeRelative('docs/readme.txt')).toBe('docs/readme.txt')
    expect(safeRelative('docs/')).toBe('docs')
    expect(safeRelative('x/a:b/c?.txt')).toBe('x/a_b/c_.txt')
    expect(safeRelative('CON.txt')).toBe('_CON.txt')
    expect(safeRelative('name.')).toBe('name_')
  })
})

describe('openZipBuffer', () => {
  it('lists files and folders with sizes, in the ZIP order, with their dates', async () => {
    const zip = await openZipBuffer(await sample())
    expect(zip.entries.map((e) => e.name)).toEqual(['docs/', 'docs/readme.txt', 'docs/deep/data.json', 'top.txt'])
    expect(zip.entries[0].directory).toBe(true)
    expect(zip.entries[1]).toMatchObject({ size: 12, directory: false, modified: '2026-09-29T12:00:00.000Z' })
    expect(zip.truncated).toBe(false)
  })

  it('reads an entry whole, stored or DEFLATE, and refuses one over the limit before reading it', async () => {
    const zip = await openZipBuffer(await sample())
    expect((await zip.read('docs/readme.txt', 1000)).toString()).toBe('hello meadow')
    expect((await zip.read('top.txt', 1000)).toString()).toBe('top')
    await expect(zip.read('docs/readme.txt', 5)).rejects.toMatchObject({ code: 'too-large' })
    await expect(zip.read('nope', 10)).rejects.toMatchObject({ code: 'missing' })
    await expect(zip.read('docs/', 10)).rejects.toMatchObject({ code: 'unreadable' })
  })

  it('says it is not a ZIP when it is not', async () => {
    await expect(openZipBuffer(Buffer.from('not a zip at all'))).rejects.toMatchObject({ name: 'ZipError', code: 'not-zip' })
  })

  it('lists an empty ZIP', async () => {
    const zip = await openZipBuffer(Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]))
    expect(zip.entries).toEqual([])
  })

  it('lists a name that could leave the folder, and marks it unreadable instead of failing the whole ZIP', async () => {
    const hostile = renameInZip(await zipBuffer([{ name: 'xx/evil.txt', data: 'x' }, { name: 'ok.txt', data: 'ok' }]), 'xx/evil.txt', '../evil.txt')
    const zip = await openZipBuffer(hostile)
    expect(zip.entries.map((e) => [e.name, e.unreadable])).toEqual([['../evil.txt', 'name'], ['ok.txt', undefined]])
    await expect(zip.read('../evil.txt', 100)).rejects.toBeInstanceOf(ZipError)
  })

  it('marks a symbolic link, and does not follow it', async () => {
    const zip = await openZipBuffer(await zipBuffer([{ name: 'link', data: '/etc/passwd', symlink: true }, { name: 'f.txt', data: 'f' }]))
    expect(zip.entries[0].unreadable).toBe('link')
    expect(zip.entries[1].unreadable).toBeUndefined()
  })

  it('catches an entry that is not the size the ZIP declares', async () => {
    const good = await zipBuffer([{ name: 'a.txt', data: 'abcdef', store: true }])
    // The central directory and the local header both hold the size: make the directory say 3 while 6 bytes are stored.
    const bad = Buffer.from(good)
    const central = bad.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    bad.writeUInt32LE(3, central + 24)
    const opened = await openZipBuffer(bad).then(
      (zip) => zip,
      (err: unknown) => err as Error,
    )
    if (opened instanceof Error) return void expect(opened).toBeInstanceOf(ZipError)
    await expect(opened.read('a.txt', 100)).rejects.toThrow()
  })
})

describe('expandSelection', () => {
  it('a folder means everything under it, a file means itself, and nothing is taken twice', async () => {
    const zip = await openZipBuffer(await sample())
    expect(expandSelection(zip.entries, ['docs/']).map((e) => e.name)).toEqual(['docs/', 'docs/readme.txt', 'docs/deep/data.json'])
    expect(expandSelection(zip.entries, ['top.txt', 'docs/readme.txt', 'top.txt']).map((e) => e.name)).toEqual(['top.txt', 'docs/readme.txt'])
    expect(expandSelection(zip.entries, ['doc']).length).toBe(0)
  })
})

describe('extractEntries', () => {
  it('writes each entry at its own path under the folder, with folders', async () => {
    const zip = await openZipBuffer(await sample())
    const report = await extractEntries(zip, zip.entries, dir)
    expect(report).toMatchObject({ extracted: 3, skipped: [] })
    expect(fs.readFileSync(path.join(dir, 'docs/readme.txt'), 'utf8')).toBe('hello meadow')
    expect(fs.readFileSync(path.join(dir, 'docs/deep/data.json'), 'utf8')).toBe('{"a":1}')
    expect(fs.readFileSync(path.join(dir, 'top.txt'), 'utf8')).toBe('top')
  })

  it('never overwrites: a file that is there keeps its content and the new one is numbered', async () => {
    fs.writeFileSync(path.join(dir, 'top.txt'), 'mine')
    const zip = await openZipBuffer(await sample())
    await extractEntries(zip, expandSelection(zip.entries, ['top.txt']), dir)
    expect(fs.readFileSync(path.join(dir, 'top.txt'), 'utf8')).toBe('mine')
    expect(fs.readFileSync(path.join(dir, 'top (2).txt'), 'utf8')).toBe('top')
  })

  it('writes nothing outside the folder for a hostile name, links or unreadable entries, and reports them', async () => {
    const hostile = renameInZip(await zipBuffer([{ name: 'xx/evil.txt', data: 'x' }, { name: 'ln', data: 'target', symlink: true }, { name: 'fine.txt', data: 'fine' }]), 'xx/evil.txt', '../evil.txt')
    const inside = path.join(dir, 'out')
    fs.mkdirSync(inside)
    const zip = await openZipBuffer(hostile)
    const report = await extractEntries(zip, zip.entries, inside)
    expect(report.extracted).toBe(1)
    expect(report.skipped.map((s) => s.name).sort()).toEqual(['../evil.txt', 'ln'])
    expect(fs.existsSync(path.join(dir, 'evil.txt'))).toBe(false)
    expect(fs.readdirSync(inside)).toEqual(['fine.txt'])
  })

  it('refuses a ZIP that declares more than the limit, before writing anything', async () => {
    const zip = await openZipBuffer(await sample())
    await expect(extractEntries(zip, zip.entries, dir, 10)).rejects.toMatchObject({ code: 'too-large' })
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('writes one entry to the file the user picked', async () => {
    const zip = await openZipBuffer(await sample())
    const target = path.join(dir, 'picked.txt')
    await extractToFile(zip, 'docs/readme.txt', target)
    expect(fs.readFileSync(target, 'utf8')).toBe('hello meadow')
  })
})
