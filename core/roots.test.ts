import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { zipBuffer } from '../fixtures/zip.ts'
import { FILE_LIMIT, RootRegistry, type DirEntry, type ListResult } from './roots.ts'

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
  it('copies a file or a folder in a folder root, numbered when the name is taken', async () => {
    const { root } = (await roots.openPath(dir)) as { root: { id: string } }
    expect(await roots.copy(root.id, 'a.txt', 'docs')).toEqual({ ok: true, path: 'docs/a.txt' })
    expect(await roots.copy(root.id, 'a.txt', '')).toEqual({ ok: true, path: 'a (2).txt' })
    expect(fs.readFileSync(path.join(dir, 'a (2).txt'), 'utf8')).toBe('hello')
  })
  it('refuses in a root that is not open, and in the trash', async () => {
    expect(await roots.rename('nope', 'a.txt', 'b.txt')).toEqual({ ok: false, error: 'unsupported' })
    const trash = (await roots.openPath(dir, { trash: true })) as { root: { id: string } }
    expect(await roots.remove(trash.root.id, 'a.txt', 'forever', none)).toEqual({ ok: false, error: 'unsupported' })
    expect(fs.existsSync(path.join(dir, 'a.txt'))).toBe(true)
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

describe('changing a ZIP (phase 5)', () => {
  const none = async () => {}
  const open = async (target = dir) => ((await roots.openPath(target)) as { root: { id: string } }).root.id
  const zipOf = async (id: string, at: string) => {
    const zip = await roots.zipAt(id, at)
    if (!('entries' in zip)) throw new Error(`no zip: ${zip.error}`)
    return zip
  }
  const listed = async (id: string, at: string) => entries(await roots.list(id, at)).map((e) => `${e.kind}:${e.path}`)

  it('creates a file and a folder at the top of a ZIP and in one of its folders, with the paths the tree uses', async () => {
    const id = await open()
    expect(await roots.create(id, 'pack.zip', 'new.txt', 'file')).toEqual({ ok: true, path: 'pack.zip!/new.txt' })
    expect(await roots.create(id, 'pack.zip!/src', 'util.c', 'file')).toEqual({ ok: true, path: 'pack.zip!/src/util.c' })
    expect(await roots.create(id, 'pack.zip!/src', 'inc', 'dir')).toEqual({ ok: true, path: 'pack.zip!/src/inc' })
    expect(await listed(id, 'pack.zip')).toContain('file:pack.zip!/new.txt')
    expect(await listed(id, 'pack.zip!/src')).toEqual(['dir:pack.zip!/src/inc', 'file:pack.zip!/src/main.c', 'file:pack.zip!/src/util.c'])
    expect(await text(id, 'pack.zip!/new.txt')).toBe('')
    expect(await text(id, 'pack.zip!/src/main.c')).toBe('int main(){}')
  })

  it('renames and moves files and folders inside a ZIP, with what is in them', async () => {
    const id = await open()
    expect(await roots.rename(id, 'pack.zip!/top.txt', 'first.txt')).toEqual({ ok: true, path: 'pack.zip!/first.txt' })
    expect(await roots.rename(id, 'pack.zip!/src', 'code')).toEqual({ ok: true, path: 'pack.zip!/code' })
    expect(await roots.rename(id, 'pack.zip!/code/main.c', 'app.c')).toEqual({ ok: true, path: 'pack.zip!/code/app.c' })
    expect(await roots.move(id, 'pack.zip!/first.txt', 'pack.zip!/code')).toEqual({ ok: true, path: 'pack.zip!/code/first.txt' })
    expect(await roots.move(id, 'pack.zip!/code/app.c', 'pack.zip')).toEqual({ ok: true, path: 'pack.zip!/app.c' })
    expect(await text(id, 'pack.zip!/app.c')).toBe('int main(){}')
    expect(await text(id, 'pack.zip!/code/first.txt')).toBe('top')
    expect(await text(id, 'pack.zip!/src/main.c')).toBe('no-file')
    // Nothing is replaced, nothing goes into itself, and the same place is not a move.
    expect(await roots.rename(id, 'pack.zip!/app.c', 'code')).toEqual({ ok: false, error: 'exists' })
    expect(await roots.move(id, 'pack.zip!/code', 'pack.zip!/code')).toEqual({ ok: false, error: 'into-itself' })
    expect(await roots.move(id, 'pack.zip!/code/first.txt', 'pack.zip!/code')).toEqual({ ok: false, error: 'same-place' })
    expect(await roots.rename(id, 'pack.zip!/app.c', 'a/b')).toEqual({ ok: false, error: 'invalid-name' })
  })

  it('copies inside a ZIP under a numbered name, and removes only for good', async () => {
    const id = await open()
    expect(await roots.copy(id, 'pack.zip!/top.txt', 'pack.zip')).toEqual({ ok: true, path: 'pack.zip!/top (2).txt' })
    expect(await roots.copy(id, 'pack.zip!/src', 'pack.zip')).toEqual({ ok: true, path: 'pack.zip!/src (2)' })
    expect(await text(id, 'pack.zip!/src (2)/main.c')).toBe('int main(){}')
    // The trash has no ZIP entries: the caller is told so, and asks for a permanent delete.
    expect(await roots.remove(id, 'pack.zip!/top.txt', 'trash', none)).toEqual({ ok: false, error: 'trash-failed' })
    expect(await text(id, 'pack.zip!/top.txt')).toBe('top')
    expect(await roots.remove(id, 'pack.zip!/top.txt', 'forever', none)).toEqual({ ok: true, path: 'pack.zip!/top.txt' })
    expect(await roots.remove(id, 'pack.zip!/src', 'forever', none)).toEqual({ ok: true, path: 'pack.zip!/src' })
    expect(await listed(id, 'pack.zip')).toEqual(['dir:pack.zip!/src (2)', 'file:pack.zip!/.hidden', 'zip:pack.zip!/nested.zip', 'file:pack.zip!/top (2).txt'])
    expect(await roots.remove(id, 'pack.zip!/gone', 'forever', none)).toEqual({ ok: false, error: 'not-found' })
  })

  it('changes a ZIP inside a ZIP, and the ZIP file keeps its own entries', async () => {
    const id = await open()
    expect(await roots.create(id, 'pack.zip!/nested.zip', 'more.txt', 'file')).toEqual({ ok: true, path: 'pack.zip!/nested.zip!/more.txt' })
    expect(await roots.rename(id, 'pack.zip!/nested.zip!/in.txt', 'inner.txt')).toEqual({ ok: true, path: 'pack.zip!/nested.zip!/inner.txt' })
    expect(await listed(id, 'pack.zip!/nested.zip')).toEqual(['file:pack.zip!/nested.zip!/inner.txt', 'file:pack.zip!/nested.zip!/more.txt'])
    expect(await text(id, 'pack.zip!/nested.zip!/inner.txt')).toBe('inner text')
    expect(await text(id, 'pack.zip!/top.txt')).toBe('top')
    expect(await roots.move(id, 'pack.zip!/nested.zip!/more.txt', 'pack.zip!/nested.zip')).toEqual({ ok: false, error: 'same-place' })
  })

  it('changes a ZIP that is the root, and a ZIP in it', async () => {
    const id = await open(path.join(dir, 'pack.zip'))
    expect(await roots.create(id, '', 'a.txt', 'file')).toEqual({ ok: true, path: 'a.txt' })
    expect(await roots.create(id, 'src', 'b.txt', 'file')).toEqual({ ok: true, path: 'src/b.txt' })
    expect(await roots.create(id, 'nested.zip', 'c.txt', 'file')).toEqual({ ok: true, path: 'nested.zip!/c.txt' })
    expect(await roots.rename(id, 'top.txt', 'first.txt')).toEqual({ ok: true, path: 'first.txt' })
    expect(await roots.move(id, 'first.txt', 'src')).toEqual({ ok: true, path: 'src/first.txt' })
    expect(await roots.rename(id, 'nested.zip!/c.txt', 'd.txt')).toEqual({ ok: true, path: 'nested.zip!/d.txt' })
    expect(await roots.remove(id, 'a.txt', 'forever', none)).toEqual({ ok: true, path: 'a.txt' })
    expect(await listed(id, 'src')).toEqual(['file:src/b.txt', 'file:src/first.txt', 'file:src/main.c'])
    expect(await listed(id, 'nested.zip')).toEqual(['file:nested.zip!/d.txt', 'file:nested.zip!/in.txt'])
    // The file on the disk is the one that changed.
    expect(fs.readFileSync(path.join(dir, 'pack.zip')).length).toBeGreaterThan(0)
    expect((await zipOf(id, '')).entries.map((e) => e.name)).not.toContain('a.txt')
  })

  it('moves nothing between the disk and a ZIP, or between two ZIPs', async () => {
    const id = await open()
    fs.writeFileSync(path.join(dir, 'second.zip'), await zipBuffer([{ name: 'x.txt', data: 'x' }]))
    expect(await roots.move(id, 'a.txt', 'pack.zip')).toEqual({ ok: false, error: 'unsupported' })
    expect(await roots.move(id, 'pack.zip!/top.txt', 'docs')).toEqual({ ok: false, error: 'unsupported' })
    expect(await roots.move(id, 'pack.zip!/top.txt', 'second.zip')).toEqual({ ok: false, error: 'unsupported' })
    expect(await roots.copy(id, 'pack.zip!/top.txt', 'second.zip')).toEqual({ ok: false, error: 'unsupported' })
    expect(await roots.copy(id, 'a.txt', 'pack.zip')).toEqual({ ok: false, error: 'unsupported' })
    expect(await text(id, 'pack.zip!/top.txt')).toBe('top')
    expect(fs.existsSync(path.join(dir, 'a.txt'))).toBe(true)
  })

  it('refuses a path that leaves the root, a symbolic link to a ZIP outside it, a folder that is not there, and the root of a ZIP root as an item', async () => {
    const id = await open()
    fs.writeFileSync(path.join(base, 'outside.zip'), await zipBuffer([{ name: 'o.txt', data: 'o' }]))
    fs.symlinkSync(path.join(base, 'outside.zip'), path.join(dir, 'link.zip'))
    const before = fs.readFileSync(path.join(base, 'outside.zip'))
    expect(await roots.create(id, '../outside.zip', 'x.txt', 'file')).toMatchObject({ ok: false })
    expect(await roots.create(id, 'link.zip', 'x.txt', 'file')).toMatchObject({ ok: false })
    expect(await roots.rename(id, '../outside.zip!/o.txt', 'p.txt')).toEqual({ ok: false, error: 'not-found' })
    expect(await roots.rename(id, 'link.zip!/o.txt', 'p.txt')).toEqual({ ok: false, error: 'not-found' })
    expect(fs.readFileSync(path.join(base, 'outside.zip')).equals(before)).toBe(true)
    expect(await roots.create(id, 'pack.zip!/nope', 'x.txt', 'file')).toEqual({ ok: false, error: 'not-found' })
    expect(await roots.create(id, 'pack.zip!/top.txt', 'x.txt', 'file')).toEqual({ ok: false, error: 'not-folder' })
    const zipRoot = await open(path.join(dir, 'pack.zip'))
    expect(await roots.rename(zipRoot, '', 'x')).toEqual({ ok: false, error: 'unsupported' })
  })

  it('does not change a ZIP in the trash, or one that cannot be written back', async () => {
    const bytes = await zipBuffer([{ name: 'a.txt', data: 'aaaa'.repeat(30) }])
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8)
    fs.writeFileSync(path.join(dir, 'locked.zip'), bytes)
    const id = await open()
    expect(await roots.create(id, 'locked.zip', 'x.txt', 'file')).toMatchObject({ ok: false })
    const trash = (await roots.openPath(dir, { trash: true })) as { root: { id: string } }
    expect(await roots.create(trash.root.id, 'pack.zip', 'x.txt', 'file')).toEqual({ ok: false, error: 'unsupported' })
    expect(await roots.remove(trash.root.id, 'pack.zip!/top.txt', 'forever', none)).toEqual({ ok: false, error: 'unsupported' })
  })

  it('does changes to one ZIP one after the other, so that none is lost', async () => {
    const id = await open()
    const made = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((n) => roots.create(id, 'pack.zip', `${n}.txt`, 'file')))
    expect(made.every((r) => r.ok)).toBe(true)
    const have = (await zipOf(id, 'pack.zip')).entries.map((e) => e.name)
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) expect(have).toContain(`${n}.txt`)
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.fbtmp'))).toEqual([])
  })
})

describe('editing a text file of a ZIP', () => {
  const open = async (target = dir) => ((await roots.openPath(target)) as { root: { id: string } }).root.id

  it('reads the text with a version that says which entry it was, and saves it back with the new version', async () => {
    const id = await open()
    const opened = await roots.edit(id, 'pack.zip!/top.txt')
    expect(opened).toMatchObject({ ok: true, text: 'top', eol: 'lf', bom: false, version: { size: 3 } })
    if (!opened.ok) return
    expect(typeof opened.version.crc32).toBe('number')
    const saved = await roots.saveEdit(id, 'pack.zip!/top.txt', 'top, changed\nline 2', opened.version, { eol: 'lf', bom: false })
    expect(saved).toMatchObject({ ok: true, version: { size: 19 } })
    expect(await text(id, 'pack.zip!/top.txt')).toBe('top, changed\nline 2')
    expect(await text(id, 'pack.zip!/src/main.c')).toBe('int main(){}')
    // What save said the entry is like is what opening it says now.
    const again = await roots.edit(id, 'pack.zip!/top.txt')
    expect(again.ok && saved.ok && again.version).toEqual(saved.ok && saved.version)
  })

  it('keeps the line endings and the byte order mark, as a file of a folder does', async () => {
    fs.writeFileSync(path.join(dir, 'crlf.zip'), await zipBuffer([{ name: 'w.txt', data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\nb\r\n')]) }]))
    const id = await open()
    const opened = await roots.edit(id, 'crlf.zip!/w.txt')
    expect(opened).toMatchObject({ ok: true, text: 'a\nb\n', eol: 'crlf', bom: true })
    if (!opened.ok) return
    await roots.saveEdit(id, 'crlf.zip!/w.txt', 'a\nb\nc\n', opened.version, { eol: opened.eol, bom: opened.bom })
    const got = await roots.read(id, 'crlf.zip!/w.txt', 100)
    expect('bytes' in got && [...got.bytes]).toEqual([0xef, 0xbb, 0xbf, ...Buffer.from('a\r\nb\r\nc\r\n')])
  })

  it('says the entry changed when it is not the one that was read, unless the user chose to overwrite; another entry changing is not a conflict', async () => {
    const id = await open()
    const opened = await roots.edit(id, 'pack.zip!/top.txt')
    if (!opened.ok) throw new Error('not open')
    // Someone else writes the same entry (here: another save), and another entry changes too.
    expect(await roots.saveEdit(id, 'pack.zip!/top.txt', 'theirs', opened.version, { eol: 'lf', bom: false })).toMatchObject({ ok: true })
    expect(await roots.saveEdit(id, 'pack.zip!/top.txt', 'mine', opened.version, { eol: 'lf', bom: false })).toEqual({ ok: false, error: 'changed' })
    expect(await text(id, 'pack.zip!/top.txt')).toBe('theirs')
    expect(await roots.saveEdit(id, 'pack.zip!/top.txt', 'mine', opened.version, { eol: 'lf', bom: false, overwrite: true })).toMatchObject({ ok: true })
    expect(await text(id, 'pack.zip!/top.txt')).toBe('mine')
    const other = await roots.edit(id, 'pack.zip!/src/main.c')
    if (!other.ok) throw new Error('not open')
    expect(await roots.create(id, 'pack.zip', 'x.txt', 'file')).toMatchObject({ ok: true })
    expect(await roots.saveEdit(id, 'pack.zip!/src/main.c', 'int main(){return 0;}', other.version, { eol: 'lf', bom: false })).toMatchObject({ ok: true })
  })

  it('edits a file of a ZIP in a ZIP, and of a ZIP that is the root', async () => {
    const id = await open()
    const inner = await roots.edit(id, 'pack.zip!/nested.zip!/in.txt')
    expect(inner).toMatchObject({ ok: true, text: 'inner text' })
    if (!inner.ok) return
    expect(await roots.saveEdit(id, 'pack.zip!/nested.zip!/in.txt', 'inner edited', inner.version, { eol: 'lf', bom: false })).toMatchObject({ ok: true })
    expect(await text(id, 'pack.zip!/nested.zip!/in.txt')).toBe('inner edited')
    const zipRoot = await open(path.join(dir, 'pack.zip'))
    const top = await roots.edit(zipRoot, 'top.txt')
    if (!top.ok) throw new Error('not open')
    expect(await roots.saveEdit(zipRoot, 'top.txt', 'root edit', top.version, { eol: 'lf', bom: false })).toMatchObject({ ok: true })
    expect(await text(zipRoot, 'top.txt')).toBe('root edit')
  })

  it('refuses what is not a text to edit, a folder, what is not there, a ZIP that is read-only, and the trash', async () => {
    fs.writeFileSync(path.join(dir, 'mixed.zip'), await zipBuffer([{ name: 'bin.dat', data: Buffer.from([1, 0, 2]) }, { name: 'latin.txt', data: Buffer.from([0x63, 0x61, 0x66, 0xe9]) }, { name: 'dir/' }]))
    const id = await open()
    expect(await roots.edit(id, 'mixed.zip!/bin.dat')).toEqual({ ok: false, error: 'not-text' })
    expect(await roots.edit(id, 'mixed.zip!/latin.txt')).toEqual({ ok: false, error: 'not-utf8' })
    expect(await roots.edit(id, 'mixed.zip!/dir')).toEqual({ ok: false, error: 'no-file' })
    expect(await roots.edit(id, 'mixed.zip!/nope.txt')).toEqual({ ok: false, error: 'no-file' })
    expect(await roots.edit(id, 'nowhere.zip!/a.txt')).toEqual({ ok: false, error: 'no-file' })
    expect(await roots.saveEdit(id, 'mixed.zip!/nope.txt', 'x', { mtimeMs: 0, size: 0, crc32: 0 }, { eol: 'lf', bom: false, overwrite: true })).toEqual({ ok: false, error: 'no-file' })
    const bytes = await zipBuffer([{ name: 'a.txt', data: 'aaaa'.repeat(30) }])
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8)
    fs.writeFileSync(path.join(dir, 'locked.zip'), bytes)
    expect(await roots.edit(id, 'locked.zip!/a.txt')).toEqual({ ok: false, error: 'read-only' })
    const trash = (await roots.openPath(dir, { trash: true })) as { root: { id: string } }
    expect(await roots.edit(trash.root.id, 'pack.zip!/top.txt')).toEqual({ ok: false, error: 'unsupported' })
  })

  it('does not edit the bytes of an entry of a ZIP (the hexadecimal view is for files of a folder)', async () => {
    const id = await open()
    expect(await roots.editBytes(id, 'pack.zip!/top.txt')).toEqual({ ok: false, error: 'unsupported' })
  })
})

describe('listFiles (every file of a root, for Go to File)', () => {
  const open = async (target = dir) => ((await roots.openPath(target)) as { root: { id: string } }).root.id
  const paths = async (id: string, hidden = false) => {
    const got = await roots.listFiles(id, hidden)
    if (!('paths' in got)) throw new Error(`listing failed: ${got.error}`)
    return got
  }

  it('lists the files of a folder at every depth, the ones near the top first, as paths relative to the root; the ZIP file is a file, not opened', async () => {
    const got = await paths(await open())
    expect(got.truncated).toBe(false)
    expect(got.paths).toEqual(['a.txt', 'pack.zip', 'page.wsnp', 'docs/readme.md', 'docs/deep/n.json'])
  })

  it('leaves out the files and folders that start with a dot unless asked, and never looks into node_modules or .git', async () => {
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'x')
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref')
    fs.mkdirSync(path.join(dir, '.config'))
    fs.writeFileSync(path.join(dir, '.config', 'app.json'), '{}')
    const id = await open()
    expect((await paths(id)).paths).not.toEqual(expect.arrayContaining(['.env']))
    const all = (await paths(id, true)).paths
    expect(all).toEqual(expect.arrayContaining(['.env', '.config/app.json']))
    expect(all.some((p) => p.startsWith('node_modules/') || p.startsWith('.git/'))).toBe(false)
  })

  it('does not follow a symbolic link to a folder (nor out of the root), but lists a link to a file', async () => {
    fs.symlinkSync(base, path.join(dir, 'escape'))
    fs.symlinkSync(path.join(dir, 'a.txt'), path.join(dir, 'link.txt'))
    const got = (await paths(await open())).paths
    expect(got.some((p) => p.startsWith('escape/'))).toBe(false)
    expect(got).toContain('link.txt')
    expect(got).not.toContain('outside.txt')
  })

  it('gives the entries of a ZIP root, without the folders and without the hidden ones unless asked', async () => {
    const id = await open(path.join(dir, 'pack.zip'))
    const got = await paths(id)
    expect(got.paths.sort()).toEqual(['nested.zip', 'src/main.c', 'top.txt'])
    expect((await paths(id, true)).paths).toContain('.hidden')
  })

  it('is cut at the limit, and says so, and says why when it cannot', async () => {
    expect(FILE_LIMIT).toBe(50_000)
    expect(await roots.listFiles('nope', false)).toEqual({ error: 'no-root' })
    await roots.close('x')
  })
})
