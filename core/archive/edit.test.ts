import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { zipBuffer, type ZipItem } from '../../fixtures/zip.ts'
import { openZipBuffer } from '../zip.ts'
import { editZip, type ZipOp } from './edit.ts'

let dir: string
const at = (name: string) => path.join(dir, name)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-zipedit-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const make = async (name: string, items: ZipItem[]) => {
  fs.writeFileSync(at(name), await zipBuffer(items))
  return at(name)
}
const sample = (): Promise<string> =>
  make('a.zip', [
    { name: 'readme.txt', data: 'hello' },
    { name: 'docs/', },
    { name: 'docs/a.md', data: '# a' },
    { name: 'docs/deep/n.json', data: '{}' },
    { name: 'img/dot.bin', data: Buffer.from([1, 2, 3, 0]), store: true },
    { name: 'empty/' },
  ])

/** The ZIP as the viewer reads it: names with the size, and the text of the files. */
const read = async (file: string) => {
  const zip = await openZipBuffer(fs.readFileSync(file))
  const files: Record<string, string> = {}
  for (const entry of zip.entries) if (!entry.directory) files[entry.name] = (await zip.read(entry.name, 1 << 23)).toString('latin1')
  return { names: zip.entries.map((e) => e.name), files, zip }
}
const leftovers = () => fs.readdirSync(dir).filter((n) => n.endsWith('.fbtmp'))
const ok = (names: string[]) => ({ ok: true, names })
const fail = (error: string) => ({ ok: false, error })

describe('editZip', () => {
  it('creates a file and a folder, keeping every other entry as it was', async () => {
    const file = await sample()
    expect(await editZip(file, [], [{ op: 'create', name: 'docs/new.txt', data: Buffer.from('new') }, { op: 'mkdir', name: 'docs/sub' }])).toEqual(ok(['docs/new.txt', 'docs/sub']))
    const { names, files } = await read(file)
    expect(names).toEqual(['readme.txt', 'docs/', 'docs/a.md', 'docs/deep/n.json', 'img/dot.bin', 'empty/', 'docs/new.txt', 'docs/sub/'])
    expect(files).toEqual({ 'readme.txt': 'hello', 'docs/a.md': '# a', 'docs/deep/n.json': '{}', 'img/dot.bin': '\u0001\u0002\u0003\u0000', 'docs/new.txt': 'new' })
    expect(leftovers()).toEqual([])
  })

  it('keeps the method, the date and the mode of the entries it copies', async () => {
    const file = await sample()
    const before = (await read(file)).zip
    await editZip(file, [], [{ op: 'create', name: 'z.txt' }])
    const after = (await read(file)).zip
    for (const name of ['readme.txt', 'img/dot.bin']) {
      expect(after.info(name)).toMatchObject({ size: before.info(name)!.size, crc32: before.info(name)!.crc32, modified: before.info(name)!.modified })
    }
    // The stored one is still stored (a stored entry is as long as it is compressed).
    expect(after.info('img/dot.bin')!.compressedSize).toBe(4)
  })

  it('never replaces a name that is taken, by a file, a folder or a name under it', async () => {
    const file = await sample()
    const before = fs.readFileSync(file)
    expect(await editZip(file, [], [{ op: 'create', name: 'readme.txt' }])).toEqual(fail('exists'))
    expect(await editZip(file, [], [{ op: 'mkdir', name: 'docs' }])).toEqual(fail('exists'))
    expect(await editZip(file, [], [{ op: 'mkdir', name: 'docs/deep' }])).toEqual(fail('exists'))
    expect(await editZip(file, [], [{ op: 'create', name: 'readme.txt/x' }])).toEqual(fail('not-folder'))
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    expect(leftovers()).toEqual([])
  })

  it('does all the operations or none: a bad one leaves the ZIP as it was', async () => {
    const file = await sample()
    const before = fs.readFileSync(file)
    expect(await editZip(file, [], [{ op: 'create', name: 'ok.txt' }, { op: 'remove', name: 'nope' }])).toEqual(fail('not-found'))
    expect(fs.readFileSync(file).equals(before)).toBe(true)
  })

  it('refuses names that are not names', async () => {
    const file = await sample()
    for (const name of ['', '../x', 'a/../x', '/x', 'a//b', 'a\\b', 'a/', 'x\0y']) expect(await editZip(file, [], [{ op: 'create', name }])).toEqual(fail('invalid-name'))
    expect(await editZip(file, [], [{ op: 'mkdir', name: '.' }])).toEqual(fail('invalid-name'))
  })

  it('replaces a file, and says so when the entry is not the one that was read', async () => {
    const file = await sample()
    const info = (await read(file)).zip.info('readme.txt')!
    const base = { size: info.size, crc32: info.crc32 }
    expect(await editZip(file, [], [{ op: 'replace', name: 'readme.txt', data: Buffer.from('changed text'), base }])).toEqual(ok(['readme.txt']))
    expect((await read(file)).files['readme.txt']).toBe('changed text')
    // The base is now stale.
    expect(await editZip(file, [], [{ op: 'replace', name: 'readme.txt', data: Buffer.from('again'), base }])).toEqual(fail('changed'))
    expect((await read(file)).files['readme.txt']).toBe('changed text')
    expect(await editZip(file, [], [{ op: 'replace', name: 'docs', data: Buffer.from('x') }])).toEqual(fail('not-found'))
  })

  it('removes a file, and a folder with everything in it; an emptied folder stays', async () => {
    const file = await sample()
    expect(await editZip(file, [], [{ op: 'remove', name: 'docs/deep' }, { op: 'remove', name: 'img/dot.bin' }])).toEqual(ok(['docs/deep', 'img/dot.bin']))
    const { names } = await read(file)
    expect(names).toEqual(['readme.txt', 'docs/', 'docs/a.md', 'empty/', 'img/'])
    expect(await editZip(file, [], [{ op: 'remove', name: 'docs' }])).toEqual(ok(['docs']))
    expect((await read(file)).names).toEqual(['readme.txt', 'empty/', 'img/'])
  })

  it('renames and moves a file and a folder, with what is in it, in their place', async () => {
    const file = await sample()
    expect(await editZip(file, [], [{ op: 'move', from: 'readme.txt', to: 'README.txt' }, { op: 'move', from: 'docs', to: 'papers' }, { op: 'move', from: 'img/dot.bin', to: 'empty/dot.bin' }])).toEqual(ok(['README.txt', 'papers', 'empty/dot.bin']))
    const { names, files } = await read(file)
    expect(names).toEqual(['README.txt', 'papers/', 'papers/a.md', 'papers/deep/n.json', 'empty/dot.bin', 'empty/', 'img/'])
    expect(files['papers/deep/n.json']).toBe('{}')
    expect(files['README.txt']).toBe('hello')
  })

  it('refuses to move onto a taken name, to the same place, or a folder into itself', async () => {
    const file = await sample()
    expect(await editZip(file, [], [{ op: 'move', from: 'readme.txt', to: 'docs' }])).toEqual(fail('exists'))
    expect(await editZip(file, [], [{ op: 'move', from: 'readme.txt', to: 'readme.txt' }])).toEqual(fail('same-place'))
    expect(await editZip(file, [], [{ op: 'move', from: 'docs', to: 'docs/deep/docs' }])).toEqual(fail('into-itself'))
    expect(await editZip(file, [], [{ op: 'move', from: 'nope', to: 'x' }])).toEqual(fail('not-found'))
    expect(await editZip(file, [], [{ op: 'move', from: 'docs', to: 'readme.txt/docs' }])).toEqual(fail('not-folder'))
  })

  it('copies under a numbered name when the name is taken, never replacing', async () => {
    const file = await sample()
    expect(await editZip(file, [], [{ op: 'copy', from: 'readme.txt', toFolder: '' }, { op: 'copy', from: 'readme.txt', toFolder: '' }, { op: 'copy', from: 'docs', toFolder: '' }, { op: 'copy', from: 'docs/a.md', toFolder: 'empty' }])).toEqual(
      ok(['readme (2).txt', 'readme (3).txt', 'docs (2)', 'empty/a.md']),
    )
    const { files } = await read(file)
    expect(files['readme (2).txt']).toBe('hello')
    expect(files['docs (2)/deep/n.json']).toBe('{}')
    expect(files['empty/a.md']).toBe('# a')
    expect(files['readme.txt']).toBe('hello')
    expect(await editZip(file, [], [{ op: 'copy', from: 'docs', toFolder: 'docs/deep' }])).toEqual(fail('into-itself'))
  })

  it('writes a ZIP the viewer reads again whatever the order of the operations', async () => {
    const file = await sample()
    const ops: ZipOp[] = [{ op: 'create', name: 'x/y/z.txt', data: Buffer.from('z') }, { op: 'move', from: 'x', to: 'w' }, { op: 'copy', from: 'w/y', toFolder: '' }]
    expect(await editZip(file, [], ops)).toEqual(ok(['x/y/z.txt', 'w', 'y']))
    expect((await read(file)).files['y/z.txt']).toBe('z')
  })

  it('changes a ZIP inside a ZIP, and puts it back in its own', async () => {
    const inner = await zipBuffer([{ name: 'in.txt', data: 'inner' }])
    const middle = await zipBuffer([{ name: 'deep.zip', data: inner, store: true }, { name: 'm.txt', data: 'middle' }])
    const file = await make('outer.zip', [{ name: 'top.txt', data: 'top' }, { name: 'dir/mid.zip', data: middle }])
    expect(await editZip(file, ['dir/mid.zip', 'deep.zip'], [{ op: 'replace', name: 'in.txt', data: Buffer.from('INNER!') }, { op: 'create', name: 'more.txt', data: Buffer.from('more') }])).toEqual(ok(['in.txt', 'more.txt']))
    const outer = await read(file)
    expect(outer.names).toEqual(['top.txt', 'dir/mid.zip'])
    expect(outer.files['top.txt']).toBe('top')
    const mid = await openZipBuffer(await outer.zip.read('dir/mid.zip', 1 << 22))
    expect((await mid.read('m.txt', 100)).toString()).toBe('middle')
    const deep = await openZipBuffer(await mid.read('deep.zip', 1 << 20))
    expect(deep.entries.map((e) => e.name)).toEqual(['in.txt', 'more.txt'])
    expect((await deep.read('in.txt', 100)).toString()).toBe('INNER!')
    expect(leftovers()).toEqual([])
  })

  it('leaves the outer ZIP alone when the change inside fails, and when the inner entry is not a ZIP', async () => {
    const middle = await zipBuffer([{ name: 'm.txt', data: 'middle' }])
    const file = await make('outer.zip', [{ name: 'mid.zip', data: middle }, { name: 'plain.txt', data: 'not a zip' }])
    const before = fs.readFileSync(file)
    expect(await editZip(file, ['mid.zip'], [{ op: 'remove', name: 'nope.txt' }])).toEqual(fail('not-found'))
    expect(await editZip(file, ['plain.txt'], [{ op: 'create', name: 'x' }])).toEqual(fail('read-only'))
    expect(await editZip(file, ['gone.zip'], [{ op: 'create', name: 'x' }])).toEqual(fail('not-found'))
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    expect(leftovers()).toEqual([])
  })

  it('keeps the permissions of the ZIP', async () => {
    const file = await sample()
    fs.chmodSync(file, 0o640)
    await editZip(file, [], [{ op: 'create', name: 'a' }])
    expect(fs.statSync(file).mode & 0o777).toBe(0o640)
  })
})

describe('what is read-only', () => {
  const refused = async (bytes: Buffer, name = 'bad.zip') => {
    const file = at(name)
    fs.writeFileSync(file, bytes)
    expect(await editZip(file, [], [{ op: 'create', name: 'x.txt' }])).toEqual(fail('read-only'))
    expect(fs.readFileSync(file).equals(bytes)).toBe(true)
    expect(leftovers()).toEqual([])
  }

  it('refuses a file that is not a ZIP', async () => refused(Buffer.from('plain text, not a zip')))

  it('refuses a ZIP with a name that could leave the folder, or with two of one name', async () => {
    const dots = await zipBuffer([{ name: 'a/xx/b.txt', data: 'b' }])
    const renamed = Buffer.from(dots)
    for (let i = renamed.indexOf('a/xx/b.txt'); i >= 0; i = renamed.indexOf('a/xx/b.txt', i + 1)) renamed.write('a/../b.txt', i)
    await refused(renamed)
    const twice = await zipBuffer([{ name: 'one.txt', data: '1' }, { name: 'two.txt', data: '2' }])
    const same = Buffer.from(twice)
    for (let i = same.indexOf('two.txt'); i >= 0; i = same.indexOf('two.txt', i + 1)) same.write('one.txt', i)
    await refused(same, 'dup.zip')
  })

  it('refuses a ZIP with an encrypted entry or a method that is not stored or DEFLATE', async () => {
    const base = await zipBuffer([{ name: 'a.txt', data: 'aaaa'.repeat(50) }])
    const central = base.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    const encrypted = Buffer.from(base)
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8)
    await refused(encrypted)
    const method = Buffer.from(base)
    method.writeUInt16LE(12, central + 10)
    await refused(method, 'method.zip')
  })

  it('refuses a ZIP64 archive', async () => {
    const base = await zipBuffer([{ name: 'a.txt', data: 'a' }])
    const eocd = base.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    const zip64 = Buffer.from(base)
    zip64.writeUInt16LE(0xffff, eocd + 10)
    await refused(zip64)
  })

  it('does not change a symbolic link entry', async () => {
    const file = await make('link.zip', [{ name: 'l', data: 'target', symlink: true }])
    expect(await editZip(file, [], [{ op: 'replace', name: 'l', data: Buffer.from('x') }])).toEqual(fail('read-only'))
  })
})

describe('sizes', () => {
  it('copies a big entry as a stream and the result is the same bytes', async () => {
    const big = Buffer.alloc(3 * 2 ** 20)
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff
    const file = await make('big.zip', [{ name: 'big.bin', data: big }, { name: 'small.txt', data: 's' }])
    await editZip(file, [], [{ op: 'move', from: 'small.txt', to: 'tiny.txt' }])
    const { zip } = await read(file)
    expect(zlib.crc32(await zip.read('big.bin', 1 << 23))).toBe(zlib.crc32(big))
  })
})
