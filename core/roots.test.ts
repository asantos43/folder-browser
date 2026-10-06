import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { zipBuffer } from '../fixtures/zip.ts'
import { RootRegistry, type DirEntry, type ListResult } from './roots.ts'

let base: string
let dir: string
let roots: RootRegistry
const names = (r: ListResult) => ('entries' in r ? r.entries.map((e) => e.name) : r.error)
const entries = (r: ListResult): DirEntry[] => {
  if (!('entries' in r)) throw new Error(`listing failed: ${r.error}`)
  return r.entries
}
const text = async (id: string, name: string) => {
  const got = await roots.read(id, name, 2 ** 20)
  return 'bytes' in got ? got.bytes.toString('utf8') : got.error
}

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-roots-'))
  dir = path.join(base, 'work')
  fs.mkdirSync(path.join(dir, 'docs', 'deep'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.git'))
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello')
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1')
  fs.writeFileSync(path.join(dir, 'docs', 'readme.md'), '# hi')
  fs.writeFileSync(path.join(dir, 'docs', 'deep', 'n.json'), '{}')
  const inner = await zipBuffer([{ name: 'in.txt', data: 'inner text' }])
  fs.writeFileSync(path.join(dir, 'pack.zip'), await zipBuffer([{ name: 'src/' }, { name: 'src/main.c', data: 'int main(){}' }, { name: '.hidden', data: 'h' }, { name: 'top.txt', data: 'top' }, { name: 'nested.zip', data: inner }]))
  fs.writeFileSync(path.join(dir, 'page.wsnp'), await zipBuffer([{ name: 'mimetype', data: 'application/vnd.wsnp+zip', store: true }, { name: 'index.html', data: '<p>hi</p>' }]))
  fs.writeFileSync(path.join(base, 'outside.txt'), 'outside')
  roots = new RootRegistry()
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

describe('opening a root', () => {
  it('opens a folder and a ZIP, and not twice', async () => {
    const folder = await roots.openPath(dir)
    expect(folder).toMatchObject({ root: { kind: 'folder', name: 'work', path: dir }, already: false })
    const zip = await roots.openPath(path.join(dir, 'pack.zip'))
    expect(zip).toMatchObject({ root: { kind: 'zip', name: 'pack.zip' }, already: false })
    expect(await roots.openPath(dir)).toMatchObject({ already: true })
    expect('root' in folder && /^r[0-9a-f]{16}$/.test(folder.root.id)).toBe(true)
  })
  it('says why not: a path that is not there, a file that is not a ZIP, a ZIP that is not one', async () => {
    expect(await roots.openPath(path.join(dir, 'none'))).toEqual({ error: 'not-found' })
    expect(await roots.openPath(path.join(dir, 'a.txt'))).toEqual({ error: 'not-supported' })
    fs.writeFileSync(path.join(dir, 'fake.zip'), 'not a zip')
    expect(await roots.openPath(path.join(dir, 'fake.zip'))).toEqual({ error: 'not-zip' })
    expect(roots.ids).toHaveLength(0)
  })
})

describe('listing a folder', () => {
  it('lists a level, folders first, with everything about each row (hidden ones flagged, not left out)', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    const list = entries(await roots.list(root.id, ''))
    expect(list.map((e) => `${e.kind}:${e.name}`)).toEqual(['dir:.git', 'dir:docs', 'file:.env', 'file:a.txt', 'zip:pack.zip', 'wsnp:page.wsnp'])
    expect(list.find((e) => e.name === '.env')).toMatchObject({ hidden: true, size: 8, path: '.env' })
    expect(list.find((e) => e.name === 'a.txt')).toMatchObject({ hidden: false, size: 5 })
    expect(names(await roots.list(root.id, 'docs'))).toEqual(['deep', 'readme.md'])
    expect(entries(await roots.list(root.id, 'docs/deep'))[0].path).toBe('docs/deep/n.json')
  })
  it('refuses a path that leaves the root or is not a folder', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    expect(await roots.list(root.id, '..')).toEqual({ error: 'denied' })
    expect(await roots.list(root.id, 'docs/../..')).toEqual({ error: 'denied' })
    expect(await roots.list(root.id, 'a.txt')).toEqual({ error: 'no-dir' })
    expect(await roots.list(root.id, 'nowhere')).toEqual({ error: 'denied' })
    expect(await roots.list('rnope', '')).toEqual({ error: 'no-root' })
  })
  it.skipIf(process.platform === 'win32')('lists a link that leaves the root but never follows it', async () => {
    fs.symlinkSync(base, path.join(dir, 'up'))
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    expect(entries(await roots.list(root.id, '')).find((e) => e.name === 'up')).toMatchObject({ kind: 'dir', link: true })
    expect(await roots.list(root.id, 'up')).toEqual({ error: 'denied' })
    expect(await roots.read(root.id, 'up/outside.txt', 1000)).toEqual({ error: 'no-file' })
  })
})

describe('a ZIP in a folder', () => {
  it('opens as a folder, also inside itself, and the hidden entries are flagged', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    const top = entries(await roots.list(root.id, 'pack.zip'))
    expect(top.map((e) => `${e.kind}:${e.name}`)).toEqual(['dir:src', 'file:.hidden', 'zip:nested.zip', 'file:top.txt'])
    expect(top.find((e) => e.name === '.hidden')?.hidden).toBe(true)
    expect(top.find((e) => e.name === 'src')?.path).toBe('pack.zip!/src')
    expect(names(await roots.list(root.id, 'pack.zip!/src'))).toEqual(['main.c'])
    expect(entries(await roots.list(root.id, 'pack.zip!/nested.zip'))[0]).toMatchObject({ name: 'in.txt', path: 'pack.zip!/nested.zip!/in.txt' })
  })
  it('reads a file of the folder, of the ZIP, and of the ZIP in the ZIP', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    expect(await text(root.id, 'a.txt')).toBe('hello')
    expect(await text(root.id, 'pack.zip!/src/main.c')).toBe('int main(){}')
    expect(await text(root.id, 'pack.zip!/nested.zip!/in.txt')).toBe('inner text')
    expect(await text(root.id, 'pack.zip!/none.txt')).toBe('no-file')
    expect(await text(root.id, '../outside.txt')).toBe('no-file')
  })
  it('streams the same, with a range for a file of the disk', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    const read = async (s: NodeJS.ReadableStream | undefined) => {
      const chunks: Buffer[] = []
      for await (const c of s!) chunks.push(c as Buffer)
      return Buffer.concat(chunks).toString('utf8')
    }
    expect(await read(await roots.stream(root.id, 'a.txt'))).toBe('hello')
    expect(await read(await roots.stream(root.id, 'a.txt', { start: 1, end: 3 }))).toBe('ell')
    expect(await read(await roots.stream(root.id, 'pack.zip!/top.txt'))).toBe('top')
    expect(await roots.stream(root.id, '../outside.txt')).toBeUndefined()
  })
  it('reads a window of a file of the disk, with the size of the file, and refuses what is not one', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    const got = await roots.range(root.id, 'a.txt', 1, 3)
    expect('bytes' in got && [got.bytes.toString('utf8'), got.size]).toEqual(['ell', 5])
    const past = await roots.range(root.id, 'a.txt', 4, 100)
    expect('bytes' in past && past.bytes.toString('utf8')).toBe('o')
    expect(await roots.range(root.id, 'a.txt', 99, 10)).toMatchObject({ size: 5 })
    expect(await roots.range(root.id, '../outside.txt', 0, 10)).toEqual({ error: 'no-file' })
    expect(await roots.range(root.id, 'pack.zip!/top.txt', 0, 10)).toEqual({ error: 'too-large' })
    expect(await roots.range('nope', 'a.txt', 0, 10)).toEqual({ error: 'no-snapshot' })
  })
  it('hands the ZIP itself for a listing and an extraction', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    const zip = await roots.zipAt(root.id, 'pack.zip')
    expect('entries' in zip && zip.entries.map((e) => e.name)).toContain('src/main.c')
    expect(await roots.zipAt(root.id, 'a.txt')).toEqual({ error: 'not-zip' })
  })
  it('refuses to read over the limit', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    expect(await roots.read(root.id, 'a.txt', 3)).toEqual({ error: 'too-large' })
  })
})

describe('a ZIP as the root', () => {
  it('lists from its top, and reads and nests the same way', async () => {
    const { root } = (await roots.openPath(path.join(dir, 'pack.zip'))) as { root: { id: string } }
    expect(names(await roots.list(root.id, ''))).toEqual(['src', '.hidden', 'nested.zip', 'top.txt'])
    expect(entries(await roots.list(root.id, 'src'))[0].path).toBe('src/main.c')
    expect(entries(await roots.list(root.id, 'nested.zip'))[0].path).toBe('nested.zip!/in.txt')
    expect(await text(root.id, 'src/main.c')).toBe('int main(){}')
    expect(await text(root.id, 'nested.zip!/in.txt')).toBe('inner text')
    expect(await roots.diskPath(root.id, 'src/main.c')).toBe(fs.realpathSync(path.join(dir, 'pack.zip')))
  })
})

describe('a .wsnp', () => {
  it('is its own kind on the disk (a ZIP in disguise), and only on the disk', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    expect(entries(await roots.list(root.id, '')).find((e) => e.name === 'page.wsnp')).toMatchObject({ kind: 'wsnp', path: 'page.wsnp' })
    const inZip = await zipBuffer([{ name: 'in.wsnp', data: 'x' }])
    fs.writeFileSync(path.join(dir, 'holder.zip'), inZip)
    expect(entries(await roots.list(root.id, 'holder.zip'))[0]).toMatchObject({ name: 'in.wsnp', kind: 'file' })
  })
  it('reads as a ZIP when asked, and names its file on the disk only for a folder root and a plain path', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    const zip = await roots.zipAt(root.id, 'page.wsnp')
    expect('entries' in zip && zip.entries.map((e) => e.name)).toEqual(['mimetype', 'index.html'])
    expect(await roots.diskFile(root.id, 'page.wsnp')).toBe(path.join(fs.realpathSync(dir), 'page.wsnp'))
    expect(await roots.diskFile(root.id, 'pack.zip!/top.txt')).toBeNull()
    expect(await roots.diskFile(root.id, 'docs')).toBeNull()
    expect(await roots.diskFile(root.id, '../outside.txt')).toBeNull()
    const zipRoot = (await roots.openPath(path.join(dir, 'pack.zip'))) as { root: { id: string } }
    expect(await roots.diskFile(zipRoot.root.id, 'top.txt')).toBeNull()
  })
})

describe('what the side bar needs of a root', () => {
  it('names a folder of the disk to pin, and not a file, a folder of a ZIP, a ZIP root or what leaves the root', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    const real = fs.realpathSync(dir)
    expect(await roots.diskDir(root.id, '')).toBe(real)
    expect(await roots.diskDir(root.id, 'docs/deep')).toBe(path.join(real, 'docs', 'deep'))
    expect(await roots.diskDir(root.id, 'a.txt')).toBeNull()
    expect(await roots.diskDir(root.id, 'pack.zip!/src')).toBeNull()
    expect(await roots.diskDir(root.id, '../')).toBeNull()
    const zip = (await roots.openPath(path.join(dir, 'pack.zip'))) as { root: { id: string } }
    expect(await roots.diskDir(zip.root.id, '')).toBeNull()
  })
  it('keeps a root as the trash, also when it was opened before', async () => {
    const first = (await roots.openPath(dir)) as { root: { id: string; trash?: boolean } }
    expect(first.root.trash).toBeUndefined()
    const again = (await roots.openPath(dir, { trash: true })) as { root: { trash?: boolean }; already: boolean }
    expect(again).toMatchObject({ already: true, root: { trash: true } })
    expect(roots.info(first.root.id)?.trash).toBe(true)
  })
})

describe('closing', () => {
  it('forgets the root, so its id answers nothing', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    await roots.close(root.id)
    expect(roots.has(root.id)).toBe(false)
    expect(await roots.read(root.id, 'a.txt', 100)).toEqual({ error: 'no-snapshot' })
  })
  it('names the disk path of a file, or of the ZIP that holds it', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    expect(await roots.diskPath(root.id, 'docs/readme.md')).toBe(path.join(fs.realpathSync(dir), 'docs', 'readme.md'))
    expect(await roots.diskPath(root.id, 'pack.zip!/src/main.c')).toBe(path.join(fs.realpathSync(dir), 'pack.zip'))
    expect(await roots.diskPath(root.id, '../outside.txt')).toBeNull()
  })
})

describe('changing the disk', () => {
  const none = async () => {}
  it('creates, renames, moves and removes in a folder root, with paths relative to it', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    expect(await roots.create(root.id, 'docs', 'new.txt', 'file')).toEqual({ ok: true, path: 'docs/new.txt' })
    expect(await roots.rename(root.id, 'docs/new.txt', 'old.txt')).toEqual({ ok: true, path: 'docs/old.txt' })
    expect(await roots.move(root.id, 'docs/old.txt', '')).toEqual({ ok: true, path: 'old.txt' })
    expect(await roots.remove(root.id, 'old.txt', 'forever', none)).toEqual({ ok: true, path: 'old.txt' })
    expect(fs.existsSync(path.join(dir, 'old.txt'))).toBe(false)
  })
  it('copies a file or a folder in a folder root, numbered when the name is taken, and refuses in a ZIP root', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    expect(await roots.copy(root.id, 'a.txt', 'docs')).toEqual({ ok: true, path: 'docs/a.txt' })
    expect(await roots.copy(root.id, 'a.txt', '')).toEqual({ ok: true, path: 'a (2).txt' })
    expect(fs.readFileSync(path.join(dir, 'a (2).txt'), 'utf8')).toBe('hello')
    const zipRoot = (await roots.openPath(path.join(dir, 'pack.zip'))) as { root: { id: string } }
    expect(await roots.copy(zipRoot.root.id, 'top.txt', '')).toEqual({ ok: false, error: 'unsupported' })
  })
  it('refuses in a ZIP root, in a root that is not open, and in the trash', async () => {
    const zipRoot = (await roots.openPath(path.join(dir, 'pack.zip'))) as { root: { id: string } }
    expect(await roots.create(zipRoot.root.id, '', 'x.txt', 'file')).toEqual({ ok: false, error: 'unsupported' })
    expect(await roots.rename('nope', 'a.txt', 'b.txt')).toEqual({ ok: false, error: 'unsupported' })
    const trash = (await roots.openPath(dir, { trash: true })) as { root: { id: string } }
    expect(await roots.remove(trash.root.id, 'a.txt', 'forever', none)).toEqual({ ok: false, error: 'unsupported' })
    expect(fs.existsSync(path.join(dir, 'a.txt'))).toBe(true)
  })
  it('refuses inside a ZIP of a folder root', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    expect(await roots.rename(root.id, 'pack.zip!/top.txt', 'x.txt')).toEqual({ ok: false, error: 'unsupported' })
    expect(await roots.remove(root.id, 'pack.zip!/src', 'forever', none)).toEqual({ ok: false, error: 'unsupported' })
  })
  it('lets go of a ZIP read before, so that one renamed and replaced is read again', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    expect(await text(root.id, 'pack.zip!/top.txt')).toBe('top')
    fs.writeFileSync(path.join(dir, 'other.zip'), await zipBuffer([{ name: 'top.txt', data: 'changed' }]))
    expect(await roots.remove(root.id, 'pack.zip', 'forever', none)).toMatchObject({ ok: true })
    expect(await roots.rename(root.id, 'other.zip', 'pack.zip')).toMatchObject({ ok: true })
    expect(await text(root.id, 'pack.zip!/top.txt')).toBe('changed')
  })
})
